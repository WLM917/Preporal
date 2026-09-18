/* ═══════════════════════════════════════════════════════════
   coach.js — discussion libre avec le coach, à l'écrit ou à la voix
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, echappe, stock, toast } from './ui.js';
import { Voix, Dictee, dicteeSupportee, boutonEcoute, arreterEcoute } from './speech.js';
import { session, exigerCompte } from './auth.js';
import { ouvrirPaywall } from './paywall.js';
import { ouvrirAppel, Appel } from './appel.js';
import { preparerPiece, piecePourApi, PIECES_MAX } from './upload.js';
import { langue, t, region } from './i18n.js';
import { messageRefus } from './questions.js';

const historique = [];
let lectureAuto = true;
let dictee = null;
let occupe = false;

/* Lu à l'appel, pas au chargement : les traductions arrivent après. */
const accueil = () => t('coach.accueil', 'Bonjour, je suis votre coach Oralixia. Dites-moi quel oral vous préparez, ou collez votre plan, votre texte ou votre sujet : je vous aide à structurer, reformuler et anticiper les questions du jury.');

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
  /* Avec une pièce jointe, une question vide a du sens : « regarde ça ».
     On fournit alors la demande implicite plutôt que de bloquer. */
  const demande = texte || (pieces.length
    ? t('coach.analyse_piece', 'Peux-tu analyser ce document et me dire ce que je dois travailler ?')
    : '');
  if (!demande || occupe) return;
  occupe = true;
  $('#saisie-coach').value = '';
  $('#saisie-coach').style.height = 'auto';

  // Les pièces partent avec ce message, puis la liste se vide.
  const jointes = pieces.map(piecePourApi);
  const nomsJoints = pieces.map(p => p.nom);
  pieces = [];
  rendrePieces();

  bulle('user', demande + (nomsJoints.length ? '\n\n📎 ' + nomsJoints.join(', ') : ''));
  historique.push({ role: 'user', content: demande });

  const attente = bulle('assistant', '…', 'bulle-attente', { ecoutable: false });

  try {
    const r = await fetch(`${CONFIG.api}/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {}) },
      body: JSON.stringify({ messages: historique.slice(-16), langue: langue(), pieces: jointes })
    });
    /* 402 : le serveur refuse, il ne panne pas. Servir malgré tout une
       réponse hors ligne reviendrait à contourner la limite qu'on vient
       de poser — c'est exactement ce que faisait ce bloc. */
    if (r.status === 402) {
      const data = await r.json().catch(() => ({}));
      attente.remove();
      historique.pop();                       // la question n'a pas été traitée
      return refuser(data.code, messageRefus(data));
    }
    /* 413, 415, 400 : le serveur a lu la demande et l'a refusée. Servir
       un repli hors ligne masquerait la vraie raison — un fichier trop
       lourd ou d'un format qu'il ne lit pas. */
    if (r.status >= 400 && r.status < 500) {
      const data = await r.json().catch(() => ({}));
      attente.remove();
      bulle('assistant', data.erreur || t('coach.piece_refusee', "Ce document n'a pas pu être transmis."));
      return;
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

/* ═══════════════════════════════════════════════════════════
   Pièces jointes

   On peut montrer au coach le sujet, l'offre, une copie
   annotée, le règlement d'un concours. Les pièces accompagnent
   le prochain message et ne sont envoyées qu'une fois :
   l'historique garde le texte, pas les fichiers.
   ═══════════════════════════════════════════════════════════ */

let pieces = [];

const ICONE_FICHIER = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
const ICONE_IMAGE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

const poidsLisible = o => o > 1024 * 1024
  ? (o / 1024 / 1024).toFixed(1) + ' Mo'
  : Math.max(1, Math.round(o / 1024)) + ' Ko';

function rendrePieces() {
  const zone = $('#pieces-coach');
  if (!zone) return;
  zone.classList.toggle('hidden', !pieces.length);

  zone.innerHTML = pieces.map((p, i) => `
    <span class="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs">
      <span class="shrink-0 text-iris2">${p.media?.startsWith('image/') ? ICONE_IMAGE : ICONE_FICHIER}</span>
      <span class="truncate">${echappe(p.nom)}</span>
      <span class="shrink-0 text-muted">${p.type === 'texte' ? echappe(p.octets.toLocaleString(region()) + ' c.') : echappe(poidsLisible(p.octets))}</span>
      <button type="button" data-retirer="${i}" class="shrink-0 rounded p-0.5 text-muted transition hover:text-coral"
        aria-label="${echappe(t('coach.retirer_piece', 'Retirer'))} ${echappe(p.nom)}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </span>`).join('');

  zone.querySelectorAll('[data-retirer]').forEach(b =>
    b.addEventListener('click', () => { pieces.splice(Number(b.dataset.retirer), 1); rendrePieces(); }));
}

async function ajouterPieces(fichiers) {
  const etat = $('#etat-piece');
  const dire = (texte, erreur = false) => {
    if (etat) { etat.textContent = texte; etat.className = 'mt-2 text-xs ' + (erreur ? 'text-coral' : 'text-muted'); }
  };

  for (const fichier of [...(fichiers || [])]) {
    if (pieces.length >= PIECES_MAX) {
      dire(t('coach.trop_de_pieces', 'Cinq pièces jointes au maximum.'), true);
      break;
    }
    try {
      dire(t('coach.lecture_piece', 'Lecture de {nom}…').replace('{nom}', fichier.name));
      pieces.push(await preparerPiece(fichier, m => dire(m)));
      rendrePieces();
      dire('');
    } catch (e) {
      dire(e.message || t('coach.piece_echec', 'Ce fichier n\'a pas pu être lu.'), true);
    }
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
    .replace('{date}', isNaN(d) ? '' : d.toLocaleDateString(region()));

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
    setTimeout(() => refuser(data.code, messageRefus(data)), 400);
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
        restant > 1 ? "{n} échanges offerts aujourd'hui" : "{n} échange offert aujourd'hui")
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
    etat.textContent = t('coach.dictee_absente', "La dictée vocale n'est pas disponible sur ce navigateur (essayez Chrome, Edge ou Safari).");
    return;
  }

  dictee = new Dictee({
    onDefinitif: seg => { const z = $('#saisie-coach'); z.value = (z.value + ' ' + seg).trim(); },
    onProvisoire: txt => { etat.textContent = txt ? '« ' + txt + ' »' : t('coach.je_vous_ecoute', 'Je vous écoute…'); },
    onErreur: msg => toast(msg, 'erreur'),
    onFin: () => {
      bouton.classList.remove('micro-actif', 'bg-coral');
      etat.textContent = t('coach.appuyez_micro', 'Appuyez sur le micro pour parler à votre coach.');
      const z = $('#saisie-coach');
      if (z.value.trim()) envoyer();
    }
  });

  bouton.addEventListener('click', () => {
    Voix.stop();
    if (dictee.enMarche) { dictee.arreter(); return; }
    if (dictee.demarrer()) {
      bouton.classList.add('micro-actif', 'bg-coral');
      etat.textContent = t('coach.je_vous_ecoute', 'Je vous écoute…');
    }
  });
}

export function initCoach() {
  const bonjour = accueil();
  bulle('assistant', bonjour);
  historique.push({ role: 'assistant', content: bonjour });

  reprendreSimulationConfiee();

  $('#btn-envoyer-coach')?.addEventListener('click', () => envoyer());
  $('#btn-appel-coach')?.addEventListener('click', appelerLeCoach);

  $('#fichier-coach')?.addEventListener('change', e => {
    ajouterPieces(e.target.files);
    e.target.value = '';               // le même fichier doit pouvoir être rechoisi
  });

  // Glisser-déposer sur la conversation, et collage d'une capture d'écran.
  const zone = $('#vue-coach') || document;
  ['dragover', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'drop') ajouterPieces(e.dataTransfer?.files);
  }));
  $('#saisie-coach')?.addEventListener('paste', e => {
    const fichiers = [...(e.clipboardData?.files || [])];
    if (fichiers.length) { e.preventDefault(); ajouterPieces(fichiers); }
  });
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
    e.currentTarget.textContent = t(lectureAuto ? 'coach.lecture_activee' : 'coach.lecture_coupee',
      lectureAuto ? 'Lecture audio : activée' : 'Lecture audio : coupée');
  });

  $('#btn-vider-coach')?.addEventListener('click', () => {
    historique.length = 0;
    $('#fil-coach').innerHTML = '';
    Voix.stop();
    const bonjour = accueil();
    bulle('assistant', bonjour);
    historique.push({ role: 'assistant', content: bonjour });
  });

  brancherMicro();
}

export const arreterCoach = () => { arreterEcoute(); dictee?.arreter(); };
