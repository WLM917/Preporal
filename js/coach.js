/* ═══════════════════════════════════════════════════════════
   coach.js — discussion libre avec le coach, à l'écrit ou à la voix
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, echappe, stock, toast } from './ui.js';
import { Voix, Dictee, dicteeSupportee, boutonEcoute, arreterEcoute } from './speech.js';
import { session, exigerCompte } from './auth.js';
import { ouvrirPaywall } from './paywall.js';
import { ouvrirAppel, Appel } from './appel.js';
import { langue, t } from './i18n.js';

const historique = [];
let lectureAuto = true;
let dictee = null;
let occupe = false;

const ACCUEIL = "Bonjour, je suis votre coach Oralixia. Dites-moi quel oral vous préparez, ou collez votre plan, votre texte ou votre sujet : je vous aide à structurer, reformuler et anticiper les questions du jury.";

function bulle(role, texte, id, { ecoutable = true } = {}) {
  const fil = $('#fil-coach');
  const el = document.createElement('div');
  el.className = role === 'user' ? 'flex justify-end' : 'flex flex-col items-start gap-1.5';
  if (id) el.id = id;

  el.innerHTML = role === 'user'
    ? `<div class="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-iris to-iris2 px-4 py-3 text-sm text-white shadow-glow">${echappe(texte)}</div>`
    : `<div class="max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-ink/50 px-4 py-3 text-sm leading-relaxed text-soft">${formater(texte)}</div>`;

  /* Bouton d'écoute sous chaque réponse du coach : la lecture
     automatique est globale, celui-ci vise un message précis et se
     réécoute autant de fois qu'on veut. */
  if (role === 'assistant' && ecoutable) {
    const b = boutonEcoute({ texte: () => texte, langue: langueVoix,
      libelle: t('ecoute.ecouter', 'Écouter'), libelleArret: t('ecoute.arreter', 'Arrêter') });
    if (b) { b.classList.add('ml-1'); el.appendChild(b); }
  }

  fil.appendChild(el);
  fil.scrollTop = fil.scrollHeight;
  return el;
}

/* Langue de la voix du coach : suit la langue d'interface. */
let langueVoix = 'fr-FR';
export const reglerLangueCoach = l => { langueVoix = l; };

/** Markdown minimal : gras, listes, sauts de ligne. Tout est échappé avant. */
function formater(texte) {
  return echappe(texte)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-soft">$1</strong>')
    .replace(/^[-–•]\s+(.*)$/gm, '<span class="flex gap-2"><span class="text-iris2">•</span><span>$1</span></span>')
    .replace(/\n{2,}/g, '<span class="block h-2"></span>')
    .replace(/\n/g, '<br>');
}

async function envoyer(texteSaisi) {
  const texte = (texteSaisi ?? $('#saisie-coach').value).trim();
  if (!texte || occupe) return;
  occupe = true;
  $('#saisie-coach').value = '';
  $('#saisie-coach').style.height = 'auto';
  bulle('user', texte);
  historique.push({ role: 'user', content: texte });

  const attente = bulle('assistant', '…', 'bulle-attente', { ecoutable: false });

  try {
    const r = await fetch(`${CONFIG.api}/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {}) },
      body: JSON.stringify({ messages: historique.slice(-16), langue: langue() })
    });
    /* 402 : le serveur refuse, il ne panne pas. Servir malgré tout une
       réponse hors ligne reviendrait à contourner la limite qu'on vient
       de poser — c'est exactement ce que faisait ce bloc. */
    if (r.status === 402) {
      const data = await r.json().catch(() => ({}));
      attente.remove();
      historique.pop();                       // la question n'a pas été traitée
      return refuser(data.code, data.erreur);
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const reponse = (data.reponse || '').trim();
    if (!reponse) throw new Error('réponse vide');

    attente.remove();
    bulle('assistant', reponse);
    historique.push({ role: 'assistant', content: reponse });
    majSolde(data.restant);
    if (lectureAuto) Voix.parler(reponse.replace(/[*#•]/g, ''), { langue: langueVoix, debit: 1 });
  } catch {
    attente.remove();
    const repli = t('coach.repli', "Le coach n'est pas joignable pour le moment (l'API n'est pas configurée ou le réseau a coupé). En attendant, une méthode qui marche presque toujours : une phrase d'accroche, trois idées annoncées, un exemple daté et chiffré par idée, puis une conclusion qui répond à la question posée.");
    bulle('assistant', repli);
    if (lectureAuto) Voix.parler(repli, { langue: langueVoix });
  } finally {
    occupe = false;
  }
}

/* ── Une simulation confiée depuis « Mon espace » ───────────
   Le bouton « Analyser avec le coach » dépose la simulation puis
   change de page. On la reprend ici, on la montre au candidat
   plutôt que de l'envoyer en cachette, et on lance l'analyse. */
function reprendreSimulationConfiee() {
  const confiee = stock.lire(CONFIG.cles.aCoacher, null);
  if (!confiee?.texte) return;
  stock.supprimer(CONFIG.cles.aCoacher);

  const d = new Date(confiee.date);
  const entete = t('coach.simulation_confiee', 'Voici ma simulation du {date}. Qu\'est-ce que je dois travailler en priorité ?')
    .replace('{date}', isNaN(d) ? '' : d.toLocaleDateString('fr-FR'));

  // Un délai laisse le message d'accueil s'afficher avant celui-ci.
  setTimeout(() => envoyer(entete + '\n\n' + confiee.texte), 500);
}

/* ── Appel au coach ────────────────────────────────────────
   Le même échange que par écrit, sans clavier : on parle, la
   réponse arrive à voix haute, l'écoute reprend. Tout passe par
   /api/coach, donc par le même quota — un appel ne doit pas être
   une porte dérobée vers le modèle. */
async function tourDAppel(texte) {
  bulle('user', texte);
  historique.push({ role: 'user', content: texte });

  const r = await fetch(`${CONFIG.api}/coach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {}) },
    body: JSON.stringify({ messages: historique.slice(-16), langue: langue() })
  });

  if (r.status === 402) {
    const data = await r.json().catch(() => ({}));
    historique.pop();
    setTimeout(() => refuser(data.code, data.erreur), 400);
    return null;                      // raccroche : inutile de poursuivre
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);

  const data = await r.json();
  const reponse = (data.reponse || '').trim();
  if (!reponse) throw new Error('réponse vide');

  bulle('assistant', reponse);
  historique.push({ role: 'assistant', content: reponse });
  majSolde(data.restant);
  return reponse;
}

function appelerLeCoach() {
  if (!Appel.disponible()) {
    return toast(t('appel.indisponible',
      "L'appel demande la reconnaissance vocale, absente de ce navigateur. Safari, Chrome et Edge la proposent."), 'erreur');
  }
  // La voix de synthèse et le micro ne peuvent pas fonctionner ensemble.
  Voix.stop();
  arreterEcoute();

  ouvrirAppel({
    titre: t('appel.titre_coach', 'Appel avec le coach'),
    sousTitre: t('appel.sous_titre_coach', 'Parlez normalement. Marquez une pause pour laisser répondre.'),
    langue: langueVoix,
    ouverture: t('appel.ouverture_coach',
      'Bonjour, je suis votre coach. Dites-moi sur quel oral vous travaillez.'),
    repondre: tourDAppel
  });
}

/** Refus du serveur : compte manquant, ou échanges du jour épuisés. */
function refuser(code, message) {
  const texte = message || t('coach.limite_atteinte',
    'Vos échanges du jour avec le coach sont utilisés.');
  bulle('assistant', texte);

  if (code === 'connexion') {
    exigerCompte(t('coach.raison_compte',
      'Créez votre compte gratuit pour parler au coach : quelques échanges par jour vous sont offerts.'));
  } else {
    setTimeout(() => ouvrirPaywall('quota'), 600);
  }
}

/** Rappel discret du solde du jour, sous la zone de saisie. */
function majSolde(restant) {
  const el = $('#solde-coach');
  if (!el) return;
  if (restant === null || restant === undefined) { el.textContent = ''; return; }
  el.textContent = restant > 0
    ? t(restant > 1 ? 'coach.echanges_restants' : 'coach.echange_restant',
        `${restant} échange${restant > 1 ? 's' : ''} offert${restant > 1 ? 's' : ''} aujourd'hui`)
        .replace('{n}', restant)
    : t('coach.dernier_echange', 'Dernier échange offert du jour.');
}

function brancherMicro() {
  const bouton = $('#btn-micro-coach');
  const etat = $('#etat-micro-coach');
  if (!bouton) return;

  if (!dicteeSupportee) {
    bouton.disabled = true;
    bouton.style.opacity = '.45';
    etat.textContent = "La dictée vocale n'est pas disponible sur ce navigateur (essayez Chrome, Edge ou Safari).";
    return;
  }

  dictee = new Dictee({
    onDefinitif: seg => { const z = $('#saisie-coach'); z.value = (z.value + ' ' + seg).trim(); },
    onProvisoire: txt => { etat.textContent = txt ? '« ' + txt + ' »' : 'Je vous écoute…'; },
    onErreur: msg => toast(msg, 'erreur'),
    onFin: () => {
      bouton.classList.remove('micro-actif', 'bg-coral');
      etat.textContent = 'Appuyez sur le micro pour parler à votre coach.';
      const z = $('#saisie-coach');
      if (z.value.trim()) envoyer();
    }
  });

  bouton.addEventListener('click', () => {
    Voix.stop();
    if (dictee.enMarche) { dictee.arreter(); return; }
    if (dictee.demarrer()) {
      bouton.classList.add('micro-actif', 'bg-coral');
      etat.textContent = 'Je vous écoute…';
    }
  });
}

export function initCoach() {
  bulle('assistant', ACCUEIL);
  historique.push({ role: 'assistant', content: ACCUEIL });

  reprendreSimulationConfiee();

  $('#btn-envoyer-coach')?.addEventListener('click', () => envoyer());
  $('#btn-appel-coach')?.addEventListener('click', appelerLeCoach);
  // Sans reconnaissance vocale, un bouton d'appel ne servirait à rien.
  if (!Appel.disponible()) $('#btn-appel-coach')?.classList.add('hidden');

  const saisie = $('#saisie-coach');
  saisie?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer(); }
  });
  saisie?.addEventListener('input', () => {
    saisie.style.height = 'auto';
    saisie.style.height = Math.min(160, saisie.scrollHeight) + 'px';
  });

  $('#btn-voix-coach')?.addEventListener('click', e => {
    lectureAuto = !lectureAuto;
    if (!lectureAuto) Voix.stop();
    e.currentTarget.textContent = 'Lecture audio : ' + (lectureAuto ? 'activée' : 'coupée');
  });

  $('#btn-vider-coach')?.addEventListener('click', () => {
    historique.length = 0;
    $('#fil-coach').innerHTML = '';
    Voix.stop();
    bulle('assistant', ACCUEIL);
    historique.push({ role: 'assistant', content: ACCUEIL });
  });

  brancherMicro();
}

export const arreterCoach = () => { arreterEcoute(); dictee?.arreter(); };
