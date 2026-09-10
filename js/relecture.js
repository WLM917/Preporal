/* ═══════════════════════════════════════════════════════════
   relecture.js — rouvrir une simulation passée

   « Mes simulations passées » reste dans Mon espace. Chaque ligne
   s'ouvre ici : on y retrouve les questions posées, ce qu'on a
   répondu, la note par critère et la correction de l'examinateur,
   question par question.

   Tout vient du navigateur : le serveur ne stocke que des
   métadonnées de progression.
   ═══════════════════════════════════════════════════════════ */

import { typeParId } from './config.js';
import { $, echappe, formaterTemps, couleurNote, ouvrirModale, fermerModale } from './ui.js';
import { lireSimulation, estRelisible } from './history.js';

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
