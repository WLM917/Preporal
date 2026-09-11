/* ═══════════════════════════════════════════════════════════
   temoignages.js — page des retours d'utilisateurs

   Cette page n'affiche que des avis réellement déposés puis
   vérifiés (`avis.publie = true`). Elle ne contient aucun
   témoignage d'exemple, et ne doit jamais en contenir : publier
   un avis inventé est une pratique commerciale trompeuse
   (art. L121-2 du code de la consommation), et l'art. L111-7-2
   impose d'indiquer si les avis sont vérifiés et à quelle date
   ils ont été collectés.

   Tant qu'aucun avis n'est publié, la page explique honnêtement
   qu'elle est vide et invite à en déposer un.
   ═══════════════════════════════════════════════════════════ */

import { TYPES_ORAL, typeParId } from './config.js';
import { $, $$, echappe, toast, stock } from './ui.js';
import { CONFIG } from './config.js';
import { supabase, session } from './auth.js';
import { brancherNavigation } from './nav.js';

const etoiles = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

let avis = [];
let filtre = 'tous';

async function charger() {
  if (!supabase) { rendre(); return; }
  try {
    const { data } = await supabase
      .from('avis')
      .select('nom, statut, note, texte, type_oral, cree_le')
      .eq('publie', true)
      .order('cree_le', { ascending: false })
      .limit(120);
    avis = data || [];
  } catch (e) {
    console.warn('Avis indisponibles', e);
    avis = [];
  }
  rendre();
}

function synthese() {
  const el = $('#synthese-avis');
  if (!el) return;
  if (!avis.length) { el.classList.add('hidden'); return; }

  const total = avis.reduce((s, a) => s + Number(a.note || 0), 0);
  const moyenne = Math.round((total / avis.length) * 10) / 10;
  const plusAncien = avis.reduce((min, a) => (!min || a.cree_le < min ? a.cree_le : min), null);
  const depuis = plusAncien
    ? new Date(plusAncien).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null;

  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="text-amber text-lg">${etoiles(Math.round(moyenne))}</span>
    <span class="font-display text-xl font-extrabold">${String(moyenne).replace('.', ',')}/5</span>
    <span class="text-sm text-muted">
      sur ${avis.length} avis vérifié${avis.length > 1 ? 's' : ''}${depuis ? ', collectés depuis ' + echappe(depuis) : ''}
    </span>`;
}

function filtres() {
  const zone = $('#filtres-avis');
  if (!zone) return;

  // On ne propose que les épreuves pour lesquelles un avis existe.
  const presents = new Set(avis.map(a => a.type_oral).filter(Boolean));
  if (!presents.size) { zone.classList.add('hidden'); return; }

  zone.classList.remove('hidden');
  const boutons = [{ id: 'tous', nom: 'Toutes les épreuves', emoji: '' }]
    .concat(TYPES_ORAL.filter(t => presents.has(t.id)).map(t => ({ id: t.id, nom: t.court, emoji: t.emoji })));

  zone.innerHTML = boutons.map(b => `
    <button type="button" data-filtre="${b.id}"
      class="shrink-0 rounded-lg border px-3.5 py-2 text-sm transition ${
        filtre === b.id ? 'border-iris bg-iris/10 text-soft' : 'border-line text-muted hover:border-iris/50'}">
      ${b.emoji ? b.emoji + ' ' : ''}${echappe(b.nom)}
    </button>`).join('');
}

function carte(a) {
  const type = a.type_oral ? typeParId(a.type_oral) : null;
  const d = a.cree_le ? new Date(a.cree_le) : null;
  return `
  <figure class="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 shadow-carte">
    <div class="flex items-center justify-between gap-3">
      <span class="text-amber" aria-label="${a.note} sur 5">${etoiles(a.note)}</span>
      ${type ? `<span class="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">${type.emoji} ${echappe(type.court)}</span>` : ''}
    </div>
    <blockquote class="mt-3 flex-1 text-sm leading-relaxed text-muted">« ${echappe(a.texte)} »</blockquote>
    <figcaption class="mt-4 border-t border-line/70 pt-3 text-sm">
      <span class="font-medium">${echappe(a.nom)}</span>
      <span class="block text-xs text-muted">
        ${echappe(a.statut || '')}${d ? ' · ' + d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''}
      </span>
    </figcaption>
  </figure>`;
}

function rendre() {
  synthese();
  filtres();

  const zone = $('#grille-temoignages');
  if (!zone) return;

  if (!avis.length) {
    zone.innerHTML = `
      <div class="rounded-3xl border border-dashed border-line bg-surface/50 p-8 text-center sm:col-span-2 lg:col-span-3 sm:p-12">
        <p class="font-display text-xl font-bold">Aucun témoignage publié pour l'instant.</p>
        <p class="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted">
          Cette page n'affichera que des retours réellement déposés par des personnes ayant
          passé une simulation, vérifiés avant publication. Nous préférons une page vide à
          des témoignages inventés — c'est d'ailleurs interdit.
        </p>
        <a href="#deposer" class="mt-6 inline-flex items-center gap-2 rounded-xl bg-inverse px-6 py-3.5 font-display font-bold text-sur-inverse transition hover:opacity-90">
          Déposer le premier avis
        </a>
      </div>`;
    return;
  }

  const visibles = filtre === 'tous' ? avis : avis.filter(a => a.type_oral === filtre);
  zone.innerHTML = visibles.length
    ? visibles.map(carte).join('')
    : `<p class="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted sm:col-span-2 lg:col-span-3">
         Aucun avis pour cette épreuve pour le moment.
       </p>`;
}

/* ── Dépôt d'un avis ───────────────────────────────────────── */
function brancherDepot() {
  const zoneNote = $('#avis-note');
  let noteChoisie = 5;

  const select = $('#avis-type');
  if (select) {
    select.innerHTML = '<option value="">Épreuve préparée (facultatif)</option>'
      + TYPES_ORAL.map(t => `<option value="${t.id}">${echappe(t.emoji + ' ' + t.court)}</option>`).join('');
  }

  if (zoneNote) {
    const dessiner = () => {
      zoneNote.innerHTML = [1, 2, 3, 4, 5].map(i =>
        `<button type="button" role="radio" aria-checked="${i === noteChoisie}" aria-label="${i} étoile${i > 1 ? 's' : ''}"
           data-note="${i}" class="text-3xl leading-none transition ${i <= noteChoisie ? 'text-amber' : 'text-line hover:text-amber/60'}">★</button>`
      ).join('');
    };
    dessiner();
    zoneNote.addEventListener('click', e => {
      const b = e.target.closest('[data-note]');
      if (!b) return;
      noteChoisie = Number(b.dataset.note);
      dessiner();
    });
  }

  $('#btn-avis')?.addEventListener('click', async () => {
    const brut = ($('#avis-nom')?.value || '').trim();
    const texte = ($('#avis-texte')?.value || '').trim();
    if (brut.length < 2) return toast('Indiquez au moins votre prénom.', 'erreur');
    if (texte.length < 20) return toast('Votre retour est un peu court : quelques mots de plus ?', 'erreur');

    const [nom, ...reste] = brut.split(',');
    const nouvel = {
      nom: nom.trim(),
      statut: reste.join(',').trim() || 'Utilisateur de Oralixia',
      note: noteChoisie,
      texte,
      type_oral: $('#avis-type')?.value || null,
      date: new Date().toISOString()
    };

    stock.ecrire(CONFIG.cles.avis, [nouvel, ...(stock.lire(CONFIG.cles.avis, []) || [])].slice(0, 20));

    let enregistre = false;
    if (supabase) {
      try {
        const { error } = await supabase.from('avis').insert({
          utilisateur_id: session.id || null,
          nom: nouvel.nom, statut: nouvel.statut, note: nouvel.note,
          texte: nouvel.texte, type_oral: nouvel.type_oral,
          publie: false        // vérification avant publication
        });
        enregistre = !error;
      } catch (e) { console.warn('Avis non synchronisé', e); }
    }

    $('#avis-texte').value = '';
    $('#avis-nom').value = '';
    $('#merci-avis')?.classList.remove('hidden');
    toast(enregistre
      ? 'Merci ! Votre avis sera publié après vérification.'
      : "Merci ! Votre avis est enregistré sur cet appareil ; il sera publié après vérification.",
      'succes');
  });
}

/* ── Démarrage ─────────────────────────────────────────────── */
await brancherNavigation();
brancherDepot();
charger();

document.addEventListener('click', e => {
  const b = e.target.closest('[data-filtre]');
  if (!b) return;
  filtre = b.dataset.filtre;
  rendre();
});
