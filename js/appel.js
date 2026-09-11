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
  panneau.className = 'modale fixed inset-0 z-[60] grid place-items-center bg-ink/90 p-4 backdrop-blur';
  panneau.setAttribute('role', 'dialog');
  panneau.setAttribute('aria-modal', 'true');
  panneau.setAttribute('aria-label', titre);

  panneau.innerHTML = `
    <div class="entree w-full max-w-md rounded-3xl border border-line bg-surface p-7 text-center shadow-carte">
      <p class="font-display text-lg font-extrabold">${echappe(titre)}</p>
      ${sousTitre ? `<p class="mt-1 text-sm text-muted">${echappe(sousTitre)}</p>` : ''}

      <div class="mt-8 flex h-16 items-center justify-center gap-1.5" aria-hidden="true">
        ${[0, 1, 2, 3, 4].map(ONDE).join('')}
      </div>

      <p id="appel-etat" class="mt-6 font-medium" role="status">${echappe(t('appel.connexion', 'Connexion…'))}</p>
      <p id="appel-apercu" class="mt-2 min-h-[3rem] text-sm italic leading-relaxed text-muted"></p>

      <button id="appel-raccrocher" type="button"
        class="mt-7 inline-flex items-center gap-2 rounded-xl bg-coral px-6 py-3 font-display font-bold text-white transition hover:brightness-110">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 9a16 16 0 0 1 18 0v3.5l-4.5 1-1-3a11 11 0 0 0-7 0l-1 3-4.5-1Z"/><path d="m2 2 20 20"/>
        </svg>
        <span>${echappe(t('appel.raccrocher', 'Raccrocher'))}</span>
      </button>
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
