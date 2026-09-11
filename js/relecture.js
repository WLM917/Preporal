/* ═══════════════════════════════════════════════════════════
   relecture.js — rouvrir une simulation passée

   « Mes simulations passées » reste dans Mon espace. Chaque ligne
   s'ouvre ici : on y retrouve les questions posées, ce qu'on a
   répondu, la note par critère et la correction de l'examinateur,
   question par question.

   Tout vient du navigateur : le serveur ne stocke que des
   métadonnées de progression.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, typeParId } from './config.js';
import { $, echappe, formaterTemps, couleurNote, stock, ouvrirModale, fermerModale } from './ui.js';
import { lireSimulation, estRelisible } from './history.js';
import { t } from './i18n.js';
import { boutonEcoute, arreterEcoute } from './speech.js';

const note = (v, sur = 20) =>
  `<span class="font-display font-extrabold tabular-nums" style="color:${couleurNote(sur === 20 ? v * 5 : v)}">${v}</span>`
  + `<span class="text-xs text-muted"> / ${sur}</span>`;

function criteres(c = {}) {
  const entrees = Object.entries(c);
  if (!entrees.length) return '';
  return `<div class="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">${entrees.map(([nom, val]) => `
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-sm font-medium">${echappe(nom)}</p>
        <p class="font-display text-sm font-bold tabular-nums text-muted">${val}<span class="text-xs"> / 100</span></p>
      </div>
      <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
        <i class="block h-full rounded-full" style="width:${Math.max(2, val)}%;background:${couleurNote(val)}"></i>
      </div>
    </div>`).join('')}</div>`;
}

function reponse(r, d, i) {
  const n = d?.note ?? 0;
  const teinte = n >= 14 ? 'text-mint' : n >= 9 ? 'text-amber' : 'text-coral';
  return `
  <details class="group rounded-2xl border border-line bg-surface" ${i === 0 ? 'open' : ''}>
    <summary class="flex cursor-pointer list-none items-start justify-between gap-4 p-5">
      <div>
        <p class="text-xs text-muted">Question ${i + 1}${r.categorie ? ' · ' + echappe(r.categorie) : ''}</p>
        <p class="mt-1 font-display font-bold leading-snug">${echappe(r.question)}</p>
      </div>
      <span class="shrink-0 font-display text-lg font-extrabold tabular-nums ${teinte}">
        ${n}<span class="text-xs text-muted"> / 20</span>
      </span>
    </summary>
    <div class="space-y-5 border-t border-line/70 p-5">
      <div>
        <p class="text-xs text-muted">Ce que vous avez répondu${r.dureeParole ? ` · ${Math.round(r.dureeParole)} s de parole` : ''}</p>
        <p class="mt-1 text-sm leading-relaxed text-soft/90">
          ${r.texte ? echappe(r.texte) : '<span class="text-muted">Question passée.</span>'}
        </p>
      </div>
      ${d?.forts?.length ? `<div>
        <p class="text-xs font-medium text-mint">Ce qui fonctionne</p>
        <ul class="mt-2 space-y-1.5 text-sm text-muted">${d.forts.map(f =>
          `<li class="flex gap-2"><span class="text-mint">+</span><span>${echappe(f)}</span></li>`).join('')}</ul>
      </div>` : ''}
      ${d?.axes?.length ? `<div>
        <p class="text-xs font-medium text-amber">À renforcer</p>
        <ul class="mt-2 space-y-1.5 text-sm text-muted">${d.axes.map(a =>
          `<li class="flex gap-2"><span class="text-amber">→</span><span>${echappe(a)}</span></li>`).join('')}</ul>
      </div>` : ''}
      ${d?.reecriture ? `<div class="rounded-xl border border-iris/30 bg-iris/5 p-4">
        <p class="text-xs font-medium text-iris2">Réponse réécrite par l'examinateur</p>
        <p class="mt-2 text-sm leading-relaxed text-soft/90">${echappe(d.reecriture)}</p>
      </div>` : ''}
    </div>
  </details>`;
}

/** Ouvre la relecture complète d'une simulation. */
export function ouvrirRelecture(id) {
  arreterEcoute();
  const s = lireSimulation(id);
  const zone = $('#relecture-contenu');
  const titre = $('#relecture-titre');
  if (!s || !zone) return;

  const type = typeParId(s.typeId);
  const d = new Date(s.date);
  if (titre) {
    titre.textContent = `${type.emoji} ${type.court}${s.sousChoix ? ' · ' + s.sousChoix : ''}`;
  }

  if (!estRelisible(s)) {
    /* Les simulations passées avant l'ajout de la relecture n'ont
       gardé que leur note : on le dit plutôt que d'afficher un vide. */
    zone.innerHTML = `
      <div class="rounded-2xl border border-line bg-surface p-5">
        <p class="text-sm text-muted">${d.toLocaleDateString('fr-FR')} · note globale
          <span class="font-display font-bold" style="color:${couleurNote(s.score)}">${s.score}/100</span></p>
        ${criteres(s.criteres)}
      </div>
      <p class="rounded-xl border border-dashed border-line p-5 text-sm leading-relaxed text-muted">
        Le détail de cette simulation n'a pas été conservé : elle est antérieure à
        l'ajout de la relecture. Les prochaines seront relisibles intégralement.
      </p>`;
    ouvrirModale('modal-relecture');
    return;
  }

  const e = s.eloquenceDetail || {};
  zone.innerHTML = `
    <div class="rounded-2xl border border-line bg-surface p-5">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <p class="text-sm text-muted">
          ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          · ${s.nbQuestions} question${s.nbQuestions > 1 ? 's' : ''}
          ${s.tempsTotal ? ' · ' + formaterTemps(s.tempsTotal) + ' de parole' : ''}
        </p>
        <p class="font-display text-2xl font-extrabold tabular-nums" style="color:${couleurNote(s.score)}">
          ${s.score}<span class="text-sm text-muted"> / 100</span>
        </p>
      </div>
      ${s.verdict ? `<p class="mt-3 font-display font-bold">${echappe(s.verdict)}</p>` : ''}
      ${criteres(s.criteres)}
    </div>

    ${s.eloquence != null ? `
    <div class="rounded-2xl border border-line bg-surface p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h4 class="font-display font-bold">Éloquence et voix</h4>
        <span class="rounded-full border border-line bg-raised px-3 py-1 font-display text-sm font-bold tabular-nums">
          ${s.eloquence} / 20
        </span>
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-line bg-ink/50 p-4">
          <p class="text-xs text-muted">Débit</p>
          <p class="mt-1 font-display text-lg font-bold">${e.debit ? e.debit + ' mots/min' : '–'}</p>
        </div>
        <div class="rounded-xl border border-line bg-ink/50 p-4">
          <p class="text-xs text-muted">Richesse</p>
          <p class="mt-1 font-display text-lg font-bold">${e.richesse ?? '–'} / 100</p>
        </div>
        <div class="rounded-xl border border-line bg-ink/50 p-4">
          <p class="text-xs text-muted">Clarté</p>
          <p class="mt-1 font-display text-lg font-bold">${e.clarte ?? '–'} / 100</p>
        </div>
      </div>
      ${e.conseils?.length ? `<ul class="mt-4 space-y-2 text-sm text-muted">${e.conseils.map(c =>
        `<li class="flex gap-2"><span class="text-iris2">•</span><span>${echappe(c)}</span></li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div>
      <h4 class="font-display text-lg font-bold">Réponse par réponse</h4>
      <div class="mt-4 space-y-3">
        ${s.reponses.map((r, i) => reponse(r, (s.details || [])[i], i)).join('')}
      </div>
    </div>`;

  // Le bilan relu peut être écouté, téléchargé, ou confié au coach.
  const zoneEcoute = document.createElement('div');
  zoneEcoute.className = 'mb-1 flex flex-wrap items-center gap-2 sans-impression';
  zoneEcoute.append(boutonTelecharger(s, d), boutonCoach(s));
  const b = boutonEcoute({
    libelle: t('ecoute.bilan', 'Écouter cette simulation'),
    libelleArret: t('ecoute.arreter', 'Arrêter'),
    classes: 'px-3 py-1.5',
    texte: () => [
      `Simulation du ${d.toLocaleDateString('fr-FR')}. Note globale : ${s.score} sur 100.`,
      s.verdict,
      ...s.reponses.map((r, i) => {
        const det = (s.details || [])[i] || {};
        return `Question ${i + 1}. ${r.question} Note : ${det.note} sur 20.`
          + (det.axes?.length ? ` À renforcer : ${det.axes.join('. ')}.` : '');
      })
    ].filter(Boolean).join(' ')
  });
  if (b) zoneEcoute.prepend(b);
  $('#relecture-contenu').prepend(zoneEcoute);

  ouvrirModale('modal-relecture');
}

export function brancherRelecture() {
  // Délégation : les lignes d'historique sont redessinées à chaque mise à jour.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-relire]');
    if (!b) return;
    ouvrirRelecture(b.dataset.relire);
  });

  // Ouverture directe depuis la fin d'une simulation : ?simulation=sim_…
  const id = new URLSearchParams(location.search).get('simulation');
  if (id) setTimeout(() => ouvrirRelecture(id), 300);
}

export { fermerModale };


/* ═══════════════════════════════════════════════════════════
   Emporter sa simulation
   ═══════════════════════════════════════════════════════════ */

const bouton = (libelle, icone, classes = '') => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'inline-flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-medium transition hover:border-iris/60 ' + classes;
  b.innerHTML = `${icone}<span>${echappe(libelle)}</span>`;
  return b;
};

const ICONE_PDF = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
const ICONE_COACH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l2-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/></svg>';

/** Téléchargement : on passe par l'impression, seule voie vers un PDF
    sans embarquer un moteur de rendu de deux mégaoctets. */
function boutonTelecharger(s, d) {
  const b = bouton(t('relecture.telecharger', 'Télécharger en PDF'), ICONE_PDF);
  b.addEventListener('click', () => {
    const titreInitial = document.title;
    const type = typeParId(s.typeId);
    document.title = `${CONFIG.nomProduit} - ${type.court} du ${d.toLocaleDateString('fr-FR')}`;
    document.body.classList.add('impression-relecture');

    const restaurer = () => {
      document.body.classList.remove('impression-relecture');
      document.title = titreInitial;
      window.removeEventListener('afterprint', restaurer);
    };
    window.addEventListener('afterprint', restaurer);
    setTimeout(() => window.print(), 120);
  });
  return b;
}

/** Confie la simulation au coach, qui l'analysera dans la foulée. */
function boutonCoach(s) {
  const b = bouton(t('relecture.envoyer_au_coach', 'Analyser avec le coach'), ICONE_COACH,
    'border-iris/40 text-iris2 hover:border-iris');
  b.addEventListener('click', () => {
    stock.ecrire(CONFIG.cles.aCoacher, resumerPourLeCoach(s));
    fermerModale('modal-relecture');
    location.assign('./index.html?vue=coach');
  });
  return b;
}

/**
 * Résumé destiné au coach. On lui donne de quoi analyser — questions,
 * réponses, notes, axes — sans lui envoyer le CV ni l'offre : ils ne
 * sont pas conservés, et le coach n'en a pas besoin pour juger une
 * prestation orale.
 */
export function resumerPourLeCoach(s) {
  const type = typeParId(s.typeId);
  const d = new Date(s.date);
  const lignes = [
    `Simulation du ${d.toLocaleDateString('fr-FR')} — ${type.court}${s.sousChoix ? ' (' + s.sousChoix + ')' : ''}.`,
    `Note globale : ${s.score}/100.`,
    s.verdict ? `Verdict : ${s.verdict}` : '',
    s.eloquence != null ? `Éloquence : ${s.eloquence}/20.` : ''
  ].filter(Boolean);

  (s.reponses || []).forEach((r, i) => {
    const det = (s.details || [])[i] || {};
    lignes.push(
      '',
      `Question ${i + 1} : ${r.question}`,
      `Ma réponse : ${(r.texte || '').slice(0, 1200) || '(pas de réponse)'}`,
      det.note != null ? `Note : ${det.note}/20.` : '',
      det.axes?.length ? `Axes signalés : ${det.axes.join(' ; ')}` : ''
    );
  });

  return { id: s.id, date: s.date, texte: lignes.filter(l => l !== undefined).join('\n') };
}
