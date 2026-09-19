/* ═══════════════════════════════════════════════════════════
   appel.js — conversation entièrement orale

   Un appel, au sens téléphonique : on parle, on se tait, la
   réponse arrive à voix haute, et l'écoute reprend. Aucun
   clavier, aucun bouton entre deux tours.

   La boucle alterne strictement écoute et parole, jamais les
   deux ensemble : le micro entendrait la voix de synthèse et se
   répondrait à lui-même. C'est la contrainte qui dicte toute la
   mécanique ci-dessous.

   La fin d'un tour se devine au silence. Trop court, on coupe
   la parole de quelqu'un qui réfléchit ; trop long, la
   conversation traîne. Une seconde et demie tient l'équilibre,
   et le réglage reste ouvert par appelant.
   ═══════════════════════════════════════════════════════════ */

import { Voix, Dictee, dicteeSupportee } from './speech.js';
import { t } from './i18n.js';
import { echappe } from './ui.js';

const SILENCE_DEFAUT = 1500;

/** @typedef {'ecoute'|'reflexion'|'parole'|'fini'} Etat */

export class Appel {
  /**
   * @param {object} o
   * @param {(texte:string)=>Promise<string|null>} o.repondre
   *        Reçoit le tour de parole, rend la réponse à dire.
   *        `null` raccroche (plus rien à dire).
   * @param {string}   [o.langue]     code de voix, « fr-FR »
   * @param {number}   [o.silence]    millisecondes de silence closant un tour
   * @param {string}   [o.ouverture]  phrase dite avant la première écoute
   * @param {(etat:Etat, detail?:string)=>void} [o.onEtat]
   * @param {(role:'moi'|'lui', texte:string)=>void} [o.onTour]
   */
  constructor({ repondre, langue = 'fr-FR', silence = SILENCE_DEFAUT,
                ouverture = '', onEtat, onTour } = {}) {
    this.repondre = repondre;
    this.langue = langue;
    this.silence = silence;
    this.ouverture = ouverture;
    this.onEtat = onEtat || (() => {});
    this.onTour = onTour || (() => {});

    this.actif = false;
    this.etat = 'fini';
    this.dictee = null;
    this.minuteur = null;
    this.tampon = '';
  }

  static disponible() { return dicteeSupportee && Voix.supporte; }

  async demarrer() {
    if (this.actif || !Appel.disponible()) return false;
    this.actif = true;
    if (this.ouverture) await this.dire(this.ouverture);
    if (this.actif) this.ecouter();
    return true;
  }

  raccrocher() {
    this.actif = false;
    clearTimeout(this.minuteur);
    this.dictee?.arreter();
    this.dictee = null;
    Voix.stop();
    this.changer('fini');
  }

  changer(etat, detail = '') {
    this.etat = etat;
    this.onEtat(etat, detail);
  }

  /** Dit un texte et attend la fin, micro coupé. */
  dire(texte) {
    return new Promise(resolve => {
      if (!texte) return resolve();
      this.changer('parole', texte);
      Voix.parler(texte, { langue: this.langue, onFin: resolve });
    });
  }

  ecouter() {
    if (!this.actif) return;
    this.tampon = '';
    this.changer('ecoute');

    this.dictee = new Dictee({
      langue: this.langue,
      onDefinitif: segment => {
        this.tampon = (this.tampon ? this.tampon + ' ' : '') + segment;
        this.armerSilence();
      },
      onProvisoire: texte => {
        this.changer('ecoute', texte);
        // Tant que la parole continue, le tour n'est pas fini.
        if (texte) this.armerSilence();
      },
      onErreur: message => {
        /* « Aucune parole détectée » n'est pas une panne : c'est
           quelqu'un qui réfléchit. On relance l'écoute. */
        if (/parole/i.test(message)) return this.relancerEcoute();
        this.changer('fini', message);
        this.raccrocher();
      },
      onFin: () => { if (this.actif && this.etat === 'ecoute') this.relancerEcoute(); }
    });

    this.dictee.demarrer();
  }

  relancerEcoute() {
    if (!this.actif || this.etat !== 'ecoute') return;
    // Une relance immédiate échoue sur certains moteurs : on laisse respirer.
    setTimeout(() => { if (this.actif && this.etat === 'ecoute') this.dictee?.demarrer(); }, 250);
  }

  armerSilence() {
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.cloreLeTour(), this.silence);
  }

  async cloreLeTour() {
    const texte = this.tampon.trim();
    if (!this.actif || !texte) return;

    this.dictee?.arreter();
    this.dictee = null;
    this.tampon = '';
    this.onTour('moi', texte);
    this.changer('reflexion');

    let reponse = null;
    try { reponse = await this.repondre(texte); }
    catch { reponse = t('appel.erreur', "Je n'ai pas pu répondre. On reprend ?"); }

    if (!this.actif) return;
    if (reponse === null) return this.raccrocher();

    this.onTour('lui', reponse);
    await this.dire(reponse);
    if (this.actif) this.ecouter();
  }
}

/* ═══════════════════════════════════════════════════════════
   Le panneau d'appel

   Construit en JavaScript : ni le coach ni le simulateur n'ont
   à porter ce balisage, et les deux obtiennent exactement la
   même interface.
   ═══════════════════════════════════════════════════════════ */

const ONDE = n => `<span class="onde block w-1 rounded-full bg-iris" style="animation-delay:${n * 0.12}s"></span>`;

/**
 * Ouvre le panneau et pilote un appel.
 * @returns {{appel: Appel, fermer: Function}|null}
 */
export function ouvrirAppel({ titre, sousTitre = '', ...options }) {
  if (!Appel.disponible()) return null;

  const panneau = document.createElement('div');
  panneau.id = 'panneau-appel';
  /* Trois exigences qui se contredisent facilement : la carte reste
     compacte, elle est centrée, et elle demeure entièrement atteignable
     sur un écran trop court.

     « flex » seul ne suffit pas : align-items vaut « stretch » par
     défaut, et la carte s'étire sur toute la hauteur — invisible dans
     Chromium, flagrant dans Safari, qui l'a étirée d'un bord à l'autre
     de l'iPad.

     D'où ce montage : le panneau défile, une enveloppe interne d'au
     moins une hauteur d'écran centre la carte tant que la place suffit,
     et grandit au-delà plutôt que de rogner le haut. */
  panneau.className = 'modale fixed inset-0 z-[60] overflow-y-auto bg-ink/90 backdrop-blur';
  panneau.setAttribute('role', 'dialog');
  panneau.setAttribute('aria-modal', 'true');
  panneau.setAttribute('aria-label', titre);

  panneau.innerHTML = `
    <div class="flex min-h-full items-center justify-center p-4">
    <div class="entree w-full max-w-sm rounded-3xl border border-line bg-surface p-6 text-center shadow-carte">
      <p class="font-display text-base font-extrabold">${echappe(titre)}</p>
      ${sousTitre ? `<p class="mt-1 text-xs text-muted">${echappe(sousTitre)}</p>` : ''}

      <div class="mt-5 flex h-10 items-center justify-center gap-1.5" aria-hidden="true">
        ${[0, 1, 2, 3, 4].map(ONDE).join('')}
      </div>

      <p id="appel-etat" class="mt-4 text-sm font-medium" role="status">${echappe(t('appel.connexion', 'Connexion…'))}</p>
      <p id="appel-apercu" class="mt-2 min-h-[2.5rem] text-xs italic leading-relaxed text-muted"></p>

      <!-- Ce bouton ne met pas fin à l'oral : il repasse à l'écrit, à la
           même question, sans rien perdre. Il s'appelait « Raccrocher »,
           ce qui se lit « j'arrête tout » — on ne le trouvait donc pas
           quand on cherchait comment revenir. -->
      <button id="appel-raccrocher" type="button"
        class="mt-5 inline-flex items-center gap-2 rounded-xl bg-inverse px-5 py-2.5 font-display text-sm font-bold text-sur-inverse transition hover:opacity-90">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
        </svg>
        <span>${echappe(t('appel.repasser_ecrit', "Repasser à l'écrit"))}</span>
      </button>
    </div>
    </div>`;

  document.body.appendChild(panneau);
  document.body.style.overflow = 'hidden';

  const etatEl = panneau.querySelector('#appel-etat');
  const apercuEl = panneau.querySelector('#appel-apercu');

  const LIBELLES = {
    ecoute: () => t('appel.ecoute', 'Je vous écoute…'),
    reflexion: () => t('appel.reflexion', 'Un instant…'),
    parole: () => t('appel.parole', 'En train de répondre…'),
    fini: () => t('appel.termine', 'Appel terminé.')
  };

  const appel = new Appel({
    ...options,
    onEtat: (etat, detail) => {
      etatEl.textContent = (LIBELLES[etat] || LIBELLES.fini)();
      panneau.dataset.etat = etat;
      if (etat === 'ecoute') apercuEl.textContent = detail || '';
      if (etat === 'parole') apercuEl.textContent = detail ? '« ' + detail.slice(0, 180) + ' »' : '';
      if (etat === 'reflexion') apercuEl.textContent = '';
      options.onEtat?.(etat, detail);
    }
  });

  const fermer = () => {
    appel.raccrocher();
    panneau.remove();
    document.body.style.overflow = '';
    options.onFermeture?.();
  };

  panneau.querySelector('#appel-raccrocher').addEventListener('click', fermer);
  panneau.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
  panneau.querySelector('#appel-raccrocher').focus();

  appel.demarrer();
  return { appel, fermer };
}
