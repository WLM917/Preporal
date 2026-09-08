/* ═══════════════════════════════════════════════════════════
   speech.js — l'IA parle (speechSynthesis) / l'utilisateur
   répond (webkitSpeechRecognition)
   ═══════════════════════════════════════════════════════════ */

/* ── 1. Voix de l'examinateur ──────────────────────────────── */
export const Voix = {
  supporte: 'speechSynthesis' in window,
  activee: true,
  _voix: null,

  /** Choisit la voix la plus naturelle disponible pour une langue. */
  choisirVoix(langue = 'fr-FR') {
    if (!this.supporte) return null;
    const dispo = speechSynthesis.getVoices();
    if (!dispo.length) return null;
    const base = langue.slice(0, 2);
    const candidates = dispo.filter(v => v.lang && v.lang.toLowerCase().startsWith(base));
    // Les voix « premium » des systèmes récents sonnent beaucoup mieux.
    const preferees = /(google|natural|enhanced|premium|siri|amélie|thomas|denise|audrey)/i;
    return candidates.find(v => preferees.test(v.name)) || candidates[0] || null;
  },

  parler(texte, { langue = 'fr-FR', debit = 0.98, onFin } = {}) {
    if (!this.supporte || !this.activee || !texte) { onFin && onFin(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texte);
      const v = this.choisirVoix(langue);
      if (v) u.voice = v;
      u.lang = v ? v.lang : langue;
      u.rate = debit;
      u.pitch = 1;
      u.onend = () => onFin && onFin();
      u.onerror = () => onFin && onFin();
      speechSynthesis.speak(u);
    } catch { onFin && onFin(); }
  },

  stop() { if (this.supporte) { try { speechSynthesis.cancel(); } catch {} } }
};

// Certains navigateurs ne peuplent la liste des voix qu'après cet évènement.
if (Voix.supporte) speechSynthesis.addEventListener?.('voiceschanged', () => Voix.choisirVoix());

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
