/* ═══════════════════════════════════════════════════════════
   chargement.js — écran d'attente

   Générer les questions puis corriger la prestation prend
   plusieurs secondes. Un simple rouet laisse croire que rien ne
   se passe : on montre l'étape réellement en cours, une barre qui
   avance, et un conseil à lire pendant l'attente.

   La progression est indicative — l'API ne renvoie pas d'état
   intermédiaire. Elle ralentit à l'approche de la fin et ne
   prétend jamais avoir terminé avant que ce soit vrai.
   ═══════════════════════════════════════════════════════════ */

import { $, echappe } from './ui.js';
import { t } from './i18n.js';

const SEQUENCES = {
  questions: {
    titre: 'Préparation de votre oral',
    etapes: [
      { texte: 'Lecture de vos documents', duree: 2200 },
      { texte: 'Repérage des points que le jury va creuser', duree: 3200 },
      { texte: "Rédaction des questions de l'examinateur", duree: 4200 },
      { texte: 'Mise en ordre du déroulé', duree: 3000 }
    ],
    conseils: [
      "Respirez avant de répondre. Deux secondes de silence valent mieux qu'un « euh » de trois.",
      "Une bonne réponse tient en trois temps : la situation, ce que vous avez fait, le résultat.",
      "Le jury retient la première et la dernière phrase. Soignez-les.",
      "Un chiffre concret vaut mieux que trois adjectifs.",
      "Si la question vous surprend, reformulez-la : vous gagnez cinq secondes de réflexion."
    ]
  },
  correction: {
    titre: 'Analyse de votre prestation',
    etapes: [
      { texte: 'Relecture de vos réponses', duree: 2400 },
      { texte: 'Évaluation du fond, réponse par réponse', duree: 4200 },
      { texte: 'Mesure du débit et de la richesse du vocabulaire', duree: 3000 },
      { texte: 'Rédaction des axes de progression', duree: 3600 }
    ],
    conseils: [
      "La correction est franche : c'est ce qui la rend utile.",
      "Reprenez d'abord la question la moins bien notée, pas la première.",
      "Relancer une simulation juste après avoir lu le bilan est le meilleur moment pour progresser.",
      "Une réponse trop longue coûte plus de points qu'une réponse trop courte."
    ]
  }
};

let minuteur = null;
let debut = 0;

const pourcentage = el => Number(el?.dataset.avance || 0);

/**
 * Démarre l'animation d'attente.
 * @param {'questions'|'correction'} type
 */
export function demarrerChargement(type = 'questions') {
  const sequence = SEQUENCES[type] || SEQUENCES.questions;
  arreterChargement();
  debut = Date.now();

  const titre = $('#titre-chargement');
  const liste = $('#etapes-chargement');
  const barre = $('#barre-chargement');
  const conseil = $('#conseil-chargement');

  if (titre) titre.textContent = t(`chargement.${type}.titre`, sequence.titre);

  if (conseil) {
    const i = Math.floor(Math.random() * sequence.conseils.length);
    conseil.textContent = t(`chargement.${type}.conseil${i}`, sequence.conseils[i]);
  }

  if (liste) {
    liste.innerHTML = sequence.etapes.map((e, i) => `
      <li data-etape="${i}" class="flex items-center gap-3 text-sm transition-opacity ${i === 0 ? '' : 'opacity-40'}">
        <span data-puce class="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line text-[10px]">
          ${i === 0 ? '<span class="h-2 w-2 rounded-full bg-iris vivant"></span>' : ''}
        </span>
        <span data-texte class="${i === 0 ? 'text-soft' : 'text-muted'}">${echappe(t(`chargement.${type}.etape${i}`, e.texte))}</span>
      </li>`).join('');
  }

  const total = sequence.etapes.reduce((s, e) => s + e.duree, 0);
  let index = 0;

  minuteur = setInterval(() => {
    const ecoule = Date.now() - debut;

    /* Progression asymptotique : on approche 92 % sans jamais l'atteindre
       tant que la réponse n'est pas là. Annoncer 100 % trop tôt puis rester
       bloqué est pire que d'avancer lentement. */
    const brut = 1 - Math.exp(-ecoule / (total * 0.55));
    const avance = Math.min(92, brut * 92);
    if (barre) { barre.style.width = avance.toFixed(1) + '%'; barre.dataset.avance = avance; }

    // Étape courante d'après le temps écoulé.
    let cumul = 0, nouvelIndex = 0;
    for (let i = 0; i < sequence.etapes.length; i++) {
      cumul += sequence.etapes[i].duree;
      if (ecoule < cumul) { nouvelIndex = i; break; }
      nouvelIndex = sequence.etapes.length - 1;
    }

    if (nouvelIndex !== index && liste) {
      index = nouvelIndex;
      [...liste.children].forEach((li, i) => {
        const fait = i < index, courant = i === index;
        li.classList.toggle('opacity-40', !fait && !courant);
        const puce = li.querySelector('[data-puce]');
        const texte = li.querySelector('[data-texte]');
        if (puce) {
          puce.className = 'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] '
            + (fait ? 'border-mint/60 bg-mint/15 text-mint' : courant ? 'border-iris/60' : 'border-line');
          puce.innerHTML = fait ? '✓' : courant ? '<span class="h-2 w-2 rounded-full bg-iris vivant"></span>' : '';
        }
        if (texte) texte.className = fait || courant ? 'text-soft' : 'text-muted';
      });
    }
  }, 140);
}

/** Termine proprement : la barre va jusqu'au bout avant de disparaître. */
export function arreterChargement() {
  if (minuteur) { clearInterval(minuteur); minuteur = null; }
  const barre = $('#barre-chargement');
  if (barre && pourcentage(barre) > 0) barre.style.width = '100%';
}
