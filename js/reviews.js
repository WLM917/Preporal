/* ═══════════════════════════════════════════════════════════
   reviews.js — preuve sociale honnête

   Règle de conduite, non négociable : on n'affiche que des avis
   réellement déposés et vérifiés, et une note moyenne réellement
   calculée à partir de ces avis.

   En France, publier de faux avis ou une note moyenne inventée est
   une pratique commerciale trompeuse (art. L121-2 s. du code de la
   consommation). L'article L111-7-2 impose en plus d'indiquer si
   les avis sont vérifiés et à quelle date ils ont été collectés.
   Aucun avis d'exemple ne doit donc être réintroduit ici.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, stock, echappe, toast } from './ui.js';
import { supabase, session } from './auth.js';

const etoiles = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

/* Avis déposés depuis ce navigateur, en attente de vérification.
   Ils ne sont visibles que par leur auteur et ne comptent jamais
   dans la note moyenne publique. */
const lireAvisLocaux = () => stock.lire(CONFIG.cles.avis, []) || [];

/* Avis publiés, chargés depuis Supabase (publie = true via RLS). */
let avisPublies = [];

export async function chargerAvisPublies() {
  if (!supabase) return;
  try {
    const { data } = await supabase
      .from('avis')
      .select('nom, statut, note, texte, type_oral, cree_le')
      .eq('publie', true)
      .order('cree_le', { ascending: false })
      .limit(6);   // l'accueil n'affiche qu'un aperçu
    avisPublies = data || [];
  } catch (e) {
    console.warn('Avis publiés indisponibles', e);
    avisPublies = [];
  }
  rendreAvis();
}

/** Note moyenne réellement observée, ou null si aucun avis publié. */
export function noteMoyenne() {
  if (!avisPublies.length) return null;
  const total = avisPublies.reduce((s, a) => s + Number(a.note || 0), 0);
  return {
    valeur: Math.round((total / avisPublies.length) * 10) / 10,
    nombre: avisPublies.length,
    depuis: avisPublies.reduce(
      (min, a) => (!min || a.cree_le < min ? a.cree_le : min), null)
  };
}

function rendreNoteMoyenne() {
  const el = $('#note-moyenne');
  if (!el) return;
  const m = noteMoyenne();

  // Pas d'avis publié : on n'affiche aucune note plutôt qu'une note inventée.
  if (!m) { el.classList.add('hidden'); el.classList.remove('flex'); return; }

  const depuis = m.depuis
    ? new Date(m.depuis).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null;

  el.classList.remove('hidden');
  el.classList.add('flex');
  el.innerHTML =
    `<span class="text-amber">${etoiles(Math.round(m.valeur))}</span>` +
    `<span class="font-display font-bold">${String(m.valeur).replace('.', ',')}/5</span>` +
    `<span class="text-muted">· ${m.nombre} avis vérifié${m.nombre > 1 ? 's' : ''}` +
    `${depuis ? ' depuis ' + echappe(depuis) : ''}</span>`;
}

const carte = (a, enAttente = false) => `
  <figure class="rounded-2xl border ${enAttente ? 'border-amber/40' : 'border-line'} bg-surface p-5 shadow-carte">
    <div class="flex items-center justify-between gap-3">
      <span class="text-amber" aria-label="${a.note} sur 5">${etoiles(a.note)}</span>
      ${enAttente
        ? '<span class="rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 text-xs text-amber">En attente de vérification</span>'
        : ''}
    </div>
    <blockquote class="mt-3 text-sm leading-relaxed text-muted">« ${echappe(a.texte)} »</blockquote>
    <figcaption class="mt-4 text-sm">
      <span class="font-medium">${echappe(a.nom)}</span>
      <span class="block text-xs text-muted">${echappe(a.statut || '')}</span>
    </figcaption>
  </figure>`;

export function rendreAvis() {
  rendreNoteMoyenne();

  const zone = $('#grille-avis');
  if (!zone) return;

  const locaux = lireAvisLocaux();

  if (!avisPublies.length && !locaux.length) {
    zone.innerHTML = `
      <div class="rounded-2xl border border-dashed border-line bg-surface/50 p-8 text-center sm:col-span-2 lg:col-span-3">
        <p class="font-display font-bold">Pas encore d'avis publié.</p>
        <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Les retours affichés ici seront ceux de vraies personnes ayant passé une simulation,
          vérifiés avant publication. Vous venez de terminer un oral ?
          <a href="./temoignages.html#deposer" class="text-iris2 underline underline-offset-2">Votre avis peut être le premier.</a>
        </p>
      </div>`;
    return;
  }

  zone.innerHTML = [
    ...locaux.map(a => carte(a, true)),
    ...avisPublies.map(a => carte(a, false))
  ].join('');
}

/* Le dépôt d'un avis se fait sur la page Témoignages : ce module
   ne s'occupe plus que de l'aperçu affiché sur l'accueil. */
