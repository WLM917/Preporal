/* ═══════════════════════════════════════════════════════════
   coach.js — discussion libre avec le coach, à l'écrit ou à la voix
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, echappe, toast } from './ui.js';
import { Voix, Dictee, dicteeSupportee } from './speech.js';
import { session } from './auth.js';

const historique = [];
let lectureAuto = true;
let dictee = null;
let occupe = false;

const ACCUEIL = "Bonjour, je suis votre coach PrepOral. Dites-moi quel oral vous préparez, ou collez votre plan, votre texte ou votre sujet : je vous aide à structurer, reformuler et anticiper les questions du jury.";

function bulle(role, texte, id) {
  const fil = $('#fil-coach');
  const el = document.createElement('div');
  el.className = role === 'user' ? 'flex justify-end' : 'flex justify-start';
  if (id) el.id = id;
  el.innerHTML = role === 'user'
    ? `<div class="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-iris to-iris2 px-4 py-3 text-sm text-white shadow-glow">${echappe(texte)}</div>`
    : `<div class="max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-ink/50 px-4 py-3 text-sm leading-relaxed text-soft">${formater(texte)}</div>`;
  fil.appendChild(el);
  fil.scrollTop = fil.scrollHeight;
  return el;
}

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

  const attente = bulle('assistant', '…', 'bulle-attente');

  try {
    const r = await fetch(`${CONFIG.api}/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {}) },
      body: JSON.stringify({ messages: historique.slice(-16) })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const reponse = (data.reponse || '').trim();
    if (!reponse) throw new Error('réponse vide');

    attente.remove();
    bulle('assistant', reponse);
    historique.push({ role: 'assistant', content: reponse });
    if (lectureAuto) Voix.parler(reponse.replace(/[*#•]/g, ''), { debit: 1 });
  } catch {
    attente.remove();
    const repli = "Le coach n'est pas joignable pour le moment (l'API n'est pas configurée ou le réseau a coupé). En attendant, une méthode qui marche presque toujours : une phrase d'accroche, trois idées annoncées, un exemple daté et chiffré par idée, puis une conclusion qui répond à la question posée.";
    bulle('assistant', repli);
    if (lectureAuto) Voix.parler(repli);
  } finally {
    occupe = false;
  }
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

  $('#btn-envoyer-coach')?.addEventListener('click', () => envoyer());

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

export const arreterCoach = () => { Voix.stop(); dictee?.arreter(); };
