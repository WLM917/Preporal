/* ═══════════════════════════════════════════════════════════
   history.js — « Mes simulations passées » + progression
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, typeParId } from './config.js';
import { $, stock, echappe, toast, couleurNote } from './ui.js';
import { supabase, session } from './auth.js';

const MAX = 60;

export function lireHistorique() {
  return stock.lire(CONFIG.cles.historique, []) || [];
}

export async function enregistrerSimulation(entree) {
  const ligne = {
    id: 'sim_' + Date.now(),
    date: new Date().toISOString(),
    typeId: entree.typeId,
    sousChoix: entree.sousChoix || '',
    score: Math.round(entree.score || 0),
    eloquence: entree.eloquence ?? null,
    nbQuestions: entree.nbQuestions || 0,
    criteres: entree.criteres || {},
    details: entree.details || []
  };

  const liste = [ligne, ...lireHistorique()].slice(0, MAX);
  stock.ecrire(CONFIG.cles.historique, liste);

  // Synchronisation multi-appareils si l'utilisateur est connecté.
  if (supabase && session.id) {
    try {
      await supabase.from('simulations').insert({
        utilisateur_id: session.id,
        type_id: ligne.typeId,
        sous_choix: ligne.sousChoix,
        score: ligne.score,
        eloquence: ligne.eloquence,
        nb_questions: ligne.nbQuestions,
        criteres: ligne.criteres
      });
    } catch (e) { console.warn('Historique non synchronisé', e); }
  }

  rendreHistorique();
  return ligne;
}

export async function chargerDepuisServeur() {
  if (!supabase || !session.id) return;
  try {
    const { data } = await supabase
      .from('simulations')
      .select('id, cree_le, type_id, sous_choix, score, eloquence, nb_questions, criteres')
      .eq('utilisateur_id', session.id)
      .order('cree_le', { ascending: false })
      .limit(MAX);
    if (data?.length) {
      const distant = data.map(d => ({
        id: d.id, date: d.cree_le, typeId: d.type_id, sousChoix: d.sous_choix,
        score: d.score, eloquence: d.eloquence, nbQuestions: d.nb_questions,
        criteres: d.criteres || {}, details: []
      }));
      stock.ecrire(CONFIG.cles.historique, distant);
      rendreHistorique();
    }
  } catch (e) { console.warn('Historique distant indisponible', e); }
}

/* ── Rendu ─────────────────────────────────────────────────── */
export function rendreHistorique() {
  const liste = lireHistorique();
  const zone = $('#liste-historique');
  const graph = $('#graphique-progression');
  if (!zone || !graph) return;

  if (!liste.length) {
    graph.innerHTML = '';
    zone.innerHTML = `<div class="rounded-xl border border-dashed border-line bg-ink/40 p-8 text-center text-sm text-muted">
      Aucune simulation pour le moment. Lancez-en une : elle apparaîtra ici avec sa note et sa correction.
    </div>`;
    return;
  }

  graph.innerHTML = courbe(liste.slice().reverse());

  zone.innerHTML = liste.map(s => {
    const type = typeParId(s.typeId);
    const d = new Date(s.date);
    return `<div class="flex items-center justify-between gap-4 rounded-xl border border-line bg-ink/40 p-4">
      <div class="min-w-0">
        <p class="truncate font-medium">${type.emoji} ${echappe(type.court)}${s.sousChoix ? ' · ' + echappe(s.sousChoix) : ''}</p>
        <p class="text-xs text-muted">${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${s.nbQuestions} question${s.nbQuestions > 1 ? 's' : ''}${s.eloquence != null ? ' · éloquence ' + s.eloquence + '/20' : ''}</p>
      </div>
      <span class="shrink-0 font-display text-xl font-extrabold tabular-nums" style="color:${couleurNote(s.score)}">${s.score}</span>
    </div>`;
  }).join('');
}

/** Petite courbe SVG maison : pas de librairie à charger. */
function courbe(points) {
  if (points.length < 2) {
    return `<p class="rounded-xl border border-line bg-ink/40 p-4 text-sm text-muted">
      Une deuxième simulation et votre courbe de progression s'affichera ici.</p>`;
  }
  const L = 640, H = 160, pad = 24;
  const n = points.length;
  const x = i => pad + (i * (L - pad * 2)) / (n - 1);
  const y = v => H - pad - ((Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2));

  const ligne = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const aire = `${ligne} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const cercles = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4" fill="${couleurNote(p.score)}" stroke="#191527" stroke-width="2"><title>${p.score}/100</title></circle>`).join('');

  const dernier = points[n - 1].score, premier = points[0].score;
  const ecart = dernier - premier;

  return `
  <div class="rounded-xl border border-line bg-ink/40 p-4">
    <div class="flex items-baseline justify-between">
      <p class="text-sm text-muted">Progression sur ${n} simulations</p>
      <p class="font-display text-sm font-bold" style="color:${ecart >= 0 ? '#3DDC97' : '#FF5D6C'}">${ecart >= 0 ? '+' : ''}${ecart} pts</p>
    </div>
    <svg viewBox="0 0 ${L} ${H}" class="mt-3 w-full" role="img" aria-label="Courbe de progression des notes">
      <defs>
        <linearGradient id="remplissage" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7C5CFF" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#7C5CFF" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${y(50)}" x2="${L - pad}" y2="${y(50)}" stroke="#312A4A" stroke-dasharray="4 6"/>
      <path d="${aire}" fill="url(#remplissage)"/>
      <path d="${ligne}" fill="none" stroke="#B48CFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${cercles}
    </svg>
  </div>`;
}

export function brancherHistorique() {
  $('#btn-vider-historique')?.addEventListener('click', () => {
    if (!confirm('Effacer définitivement toutes vos simulations enregistrées ?')) return;
    stock.supprimer(CONFIG.cles.historique);
    rendreHistorique();
    toast('Historique effacé.');
  });
  rendreHistorique();
}
