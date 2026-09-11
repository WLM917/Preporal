/* ═══════════════════════════════════════════════════════════
   speech.js — l'IA parle (speechSynthesis) / l'utilisateur
   répond (webkitSpeechRecognition)
   ═══════════════════════════════════════════════════════════ */

/* ── 1. Voix de l'examinateur ───────────────────────────────

   Une voix de synthèse paraît robotique pour trois raisons, et
   deux d'entre elles se corrigent sans rien payer :

   1. La mauvaise voix est choisie. Les systèmes récents
      embarquent des voix neuronales bien meilleures que celle
      par défaut, mais elles ne sont pas en tête de liste. On
      les classe donc au lieu de prendre la première venue.
   2. Le texte est lu d'un seul bloc, sans respiration. Découpé
      en phrases, avec une pause après chaque point, le débit
      redevient humain.
   3. Le moteur lui-même est limité. Cette part-là ne se corrige
      qu'avec une voix neuronale distante, payante — voir le
      README, section « Qualité de la voix ».
   ─────────────────────────────────────────────────────────── */

/* Noms de voix réputées naturelles, par langue. Ordre indicatif :
   le classement ci-dessous pèse d'autres critères en plus. */
const BONNES_VOIX = {
  fr: /(amélie|amelie|aurélie|aurelie|thomas|marie|audrey|denise|henri|siri)/i,
  en: /(samantha|ava|allison|serena|daniel|karen|moira|aria|jenny|guy|siri)/i,
  es: /(mónica|monica|paulina|jorge|lucia|elvira|álvaro|alvaro|siri)/i
};

/* Marqueurs de qualité communs à tous les systèmes. */
const PREMIUM = /(neural|natural|premium|enhanced|eloquence|wavenet|studio|journey|siri)/i;
const BASSE_QUALITE = /(compact|espeak|pico|festival|robot)/i;

export const Voix = {
  supporte: 'speechSynthesis' in window,
  activee: true,
  _cache: new Map(),

  /** Liste des voix, en attendant qu'elle soit peuplée si besoin. */
  disponibles() {
    if (!this.supporte) return [];
    try { return speechSynthesis.getVoices() || []; } catch { return []; }
  },

  /**
   * Note une voix pour une langue donnée. Plus c'est haut, mieux c'est.
   * Le critère le plus utile en pratique n'est pas le nom mais
   * localService : une voix servie par le réseau est presque toujours
   * une voix neuronale, et une voix embarquée la version dégradée.
   */
  noter(v, langue) {
    const base = langue.slice(0, 2).toLowerCase();
    const nom = v.name || '';
    const lang = (v.lang || '').toLowerCase().replace('_', '-');
    if (!lang.startsWith(base)) return -1;

    let note = 0;
    if (lang === langue.toLowerCase()) note += 3;      // fr-FR plutôt que fr-CA
    if (PREMIUM.test(nom)) note += 6;
    if (v.localService === false) note += 4;           // voix réseau = neuronale
    if (BONNES_VOIX[base]?.test(nom)) note += 3;
    if (/google/i.test(nom)) note += 2;                // les voix Google sont correctes
    if (BASSE_QUALITE.test(nom)) note -= 6;
    if (v.default) note += 1;                          // départage à égalité
    return note;
  },

  /** Choisit la voix la plus naturelle disponible pour une langue. */
  choisirVoix(langue = 'fr-FR') {
    if (!this.supporte) return null;
    if (this._cache.has(langue)) return this._cache.get(langue);

    const classees = this.disponibles()
      .map(v => ({ v, note: this.noter(v, langue) }))
      .filter(x => x.note >= 0)
      .sort((a, b) => b.note - a.note);

    const choisie = classees[0]?.v || null;
    // Tant que la liste est vide, on ne mémorise rien : elle arrive tard.
    if (choisie) this._cache.set(langue, choisie);
    return choisie;
  },

  /** Découpe en phrases : une pause après chaque point vaut mieux qu'un long souffle. */
  decouper(texte) {
    return String(texte)
      .split(/(?<=[.!?…:])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"])/u)
      .flatMap(p => (p.length <= 240 ? [p] : p.split(/(?<=,)\s+/)))
      .map(p => p.trim())
      .filter(Boolean);
  },

  /**
   * Lit un texte à voix haute.
   * @param {string} texte
   * @param {{langue?:string, debit?:number, onFin?:Function}} options
   */
  parler(texte, { langue = 'fr-FR', debit = 0.97, onFin } = {}) {
    if (!this.supporte || !this.activee || !texte) { onFin && onFin(); return; }
    try {
      speechSynthesis.cancel();
      const voix = this.choisirVoix(langue);
      const morceaux = this.decouper(texte);
      if (!morceaux.length) { onFin && onFin(); return; }

      morceaux.forEach((morceau, i) => {
        const u = new SpeechSynthesisUtterance(morceau);
        if (voix) u.voice = voix;
        u.lang = voix ? voix.lang : langue;
        u.rate = debit;

        /* Une question monte légèrement, une phrase longue redescend :
           c'est ce que fait une voix humaine, et son absence est ce qui
           rend la lecture monocorde. */
        u.pitch = /\?\s*$/.test(morceau) ? 1.06 : 1;
        u.volume = 1;

        if (i === morceaux.length - 1) {
          u.onend = () => onFin && onFin();
          u.onerror = () => onFin && onFin();
        }
        speechSynthesis.speak(u);
      });
    } catch { onFin && onFin(); }
  },

  stop() { if (this.supporte) { try { speechSynthesis.cancel(); } catch {} } }
};

/* La liste des voix arrive de façon asynchrone, et parfois deux fois.
   On vide le cache à chaque changement pour ne pas rester sur un
   choix fait alors que les bonnes voix n'étaient pas encore chargées. */
if (Voix.supporte) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    Voix._cache.clear();
    Voix.choisirVoix();
  });
}

/* ── 2. Dictée ─────────────────────────────────────────────── */
const Moteur = window.SpeechRecognition || window.webkitSpeechRecognition;
export const dicteeSupportee = Boolean(Moteur);

export class Dictee {
  /**
   * @param {object} o
   * @param {(txt:string)=>void} o.onDefinitif  segment retranscrit définitivement
   * @param {(txt:string)=>void} o.onProvisoire texte en cours de reconnaissance
   * @param {(err:string)=>void} o.onErreur
   * @param {()=>void} o.onFin
   */
  constructor({ onDefinitif, onProvisoire, onErreur, onFin, langue = 'fr-FR' } = {}) {
    this.langue = langue;
    this.enMarche = false;
    this.debut = 0;
    this.duree = 0;           // secondes de parole cumulées
    this.arretVoulu = false;
    this.onDefinitif = onDefinitif || (() => {});
    this.onProvisoire = onProvisoire || (() => {});
    this.onErreur = onErreur || (() => {});
    this.onFin = onFin || (() => {});
    if (!Moteur) return;

    const r = new Moteur();
    r.lang = langue;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = e => {
      let provisoire = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) this.onDefinitif(res[0].transcript.trim());
        else provisoire += res[0].transcript;
      }
      this.onProvisoire(provisoire.trim());
    };

    r.onerror = e => {
      const messages = {
        'not-allowed': "Micro refusé. Autorisez l'accès au micro dans votre navigateur.",
        'service-not-allowed': "Micro refusé par le système.",
        'no-speech': "Aucune parole détectée.",
        'audio-capture': "Aucun micro détecté sur cet appareil.",
        'network': "La reconnaissance vocale n'a pas pu joindre le réseau."
      };
      if (e.error !== 'no-speech') this.onErreur(messages[e.error] || "La dictée s'est interrompue.");
    };

    // Chrome coupe la session toutes les ~60 s : on relance tant que l'utilisateur n'a pas arrêté.
    r.onend = () => {
      if (this.enMarche && !this.arretVoulu) { try { r.start(); return; } catch {} }
      this.enMarche = false;
      this.duree += (Date.now() - this.debut) / 1000;
      this.onFin();
    };

    this.moteur = r;
  }

  changerLangue(langue) {
    this.langue = langue;
    if (this.moteur) this.moteur.lang = langue;
  }

  demarrer() {
    if (!this.moteur || this.enMarche) return false;
    this.arretVoulu = false;
    this.enMarche = true;
    this.debut = Date.now();
    try { this.moteur.start(); return true; }
    catch { this.enMarche = false; return false; }
  }

  arreter() {
    if (!this.moteur || !this.enMarche) return;
    this.arretVoulu = true;
    try { this.moteur.stop(); } catch {}
  }

  basculer() { return this.enMarche ? (this.arreter(), false) : this.demarrer(); }
}

/** Langue de dictée déduite de la certification choisie. */
export function langueDeLEpreuve(typeId, sousChoix = '') {
  if (typeId !== 'langue' && typeId !== 'matiere') return 'fr-FR';
  const s = (sousChoix || '').toLowerCase();
  if (/toeic|toefl|ielts|cambridge|anglais/.test(s)) return 'en-US';
  if (/dele|espagnol/.test(s)) return 'es-ES';
  if (/goethe|allemand/.test(s)) return 'de-DE';
  return 'fr-FR';
}

/* ── 3. Bouton « écouter » réutilisable ─────────────────────
   La lecture automatique est tout ou rien. Ce bouton permet
   d'écouter un message précis, de l'arrêter, et de le réécouter —
   comme le font Claude ou Gemini sur chaque réponse.

   Un seul message parle à la fois : démarrer une lecture arrête
   la précédente et remet son bouton dans l'état « écouter ».
   ─────────────────────────────────────────────────────────── */

const HAUT_PARLEUR = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const ARRET = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

/** Bouton actuellement en lecture, pour n'en avoir jamais deux. */
let boutonActif = null;

function reposer(bouton, libelle) {
  if (!bouton) return;
  bouton.dataset.enLecture = 'false';
  bouton.innerHTML = HAUT_PARLEUR + `<span>${libelle}</span>`;
  bouton.setAttribute('aria-label', libelle);
  bouton.classList.remove('text-iris2', 'border-iris/50');
}

/**
 * Fabrique un bouton d'écoute pour un texte donné.
 *
 * @param {object} o
 * @param {() => string} o.texte    fonction rendant le texte à lire
 * @param {string} [o.langue]
 * @param {string} [o.libelle]      texte au repos
 * @param {string} [o.libelleArret] texte pendant la lecture
 * @param {string} [o.classes]      classes supplémentaires
 * @returns {HTMLButtonElement|null} null si la synthèse vocale manque
 */
export function boutonEcoute({
  texte,
  langue = 'fr-FR',
  libelle = 'Écouter',
  libelleArret = 'Arrêter',
  classes = ''
} = {}) {
  // Sans synthèse vocale, mieux vaut ne rien afficher qu'un bouton inerte.
  if (!Voix.supporte) return null;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 '
    + 'text-xs transition hover:border-iris/60 ' + classes;
  reposer(b, libelle);

  b.addEventListener('click', () => {
    const enLecture = b.dataset.enLecture === 'true';

    // Toute lecture en cours s'arrête, y compris celle d'un autre message.
    Voix.stop();
    if (boutonActif && boutonActif !== b) reposer(boutonActif, boutonActif.dataset.libelle || 'Écouter');
    boutonActif = null;

    if (enLecture) { reposer(b, libelle); return; }

    const contenu = (typeof texte === 'function' ? texte() : texte) || '';
    if (!contenu.trim()) return;

    b.dataset.enLecture = 'true';
    b.dataset.libelle = libelle;
    b.innerHTML = ARRET + `<span>${libelleArret}</span>`;
    b.setAttribute('aria-label', libelleArret);
    b.classList.add('text-iris2', 'border-iris/50');
    boutonActif = b;

    /* La lecture automatique peut être coupée globalement ; un clic
       explicite sur « Écouter » doit fonctionner quand même. */
    const etatInitial = Voix.activee;
    Voix.activee = true;
    Voix.parler(nettoyerPourLaVoix(contenu), {
      langue,
      onFin: () => {
        Voix.activee = etatInitial;
        if (boutonActif === b) boutonActif = null;
        reposer(b, libelle);
      }
    });
  });

  return b;
}

/** Retire la ponctuation de mise en forme, qui s'entend mal. */
export const nettoyerPourLaVoix = (t = '') =>
  String(t)
    .replace(/[*_#`]/g, '')
    .replace(/^[-–•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Arrête toute lecture et remet les boutons au repos. */
export function arreterEcoute() {
  Voix.stop();
  if (boutonActif) { reposer(boutonActif, boutonActif.dataset.libelle || 'Écouter'); boutonActif = null; }
}
