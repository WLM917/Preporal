/* ═══════════════════════════════════════════════════════════
   reviews.js — preuve sociale et dépôt d'avis
   ⚠️ Les avis ci-dessous sont des EXEMPLES de mise en page.
   En France, publier de faux avis ou une note moyenne inventée
   est une pratique commerciale trompeuse (art. L121-2 s. du
   code de la consommation). Remplacez-les par de vrais retours
   avant toute mise en vente. Voir README.md.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, stock, echappe, toast } from './ui.js';
import { supabase, session } from './auth.js';

const EXEMPLES = [
  { nom: 'Lucas M.', statut: 'Étudiant en L3 éco-gestion', note: 5, texte: "Je bafouillais dès qu'on me demandait de me présenter. Trois simulations plus tard, j'avais une réponse carrée de 90 secondes. Stage décroché." },
  { nom: 'Inès B.', statut: 'Terminale, spécialité SES', note: 5, texte: "Le mode Grand Oral m'a posé exactement la question de recul que le jury m'a posée le jour J. Je l'avais déjà travaillée, ça a tout changé." },
  { nom: 'Karim D.', statut: 'Prépa ECG, concours 2e année', note: 5, texte: "Ce que j'ai le plus utilisé : l'analyse du débit. Je parlais à 190 mots/minute sans m'en rendre compte. Corrigé en une semaine." },
  { nom: 'Sarah L.', statut: 'En reconversion, ex-vendeuse', note: 5, texte: "Pouvoir répéter dix fois sans déranger personne, c'est ce qui m'a rendu confiance. Le rapport dit franchement ce qui ne va pas." },
  { nom: 'Thomas R.', statut: 'Élève de 3e', note: 5, texte: "Pour l'oral de stage, j'ai enregistré ma présentation et l'appli m'a dit où j'allais trop vite. J'ai eu 19." },
  { nom: 'Marion V.', statut: 'Étudiante en LEA, TOEIC', note: 5, texte: "Les questions en anglais et la correction sur la richesse du vocabulaire m'ont fait progresser plus vite que mes fiches." }
];

const etoiles = n => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

const lireAvis = () => stock.lire(CONFIG.cles.avis, []) || [];

export function rendreAvis() {
  const zone = $('#grille-avis');
  if (!zone) return;
  const perso = lireAvis();
  const tout = [...perso, ...EXEMPLES];

  zone.innerHTML = tout.map(a => `
    <figure class="rounded-2xl border ${a.nouveau ? 'border-mint/50' : 'border-line'} bg-surface p-5 shadow-lift">
      <div class="flex items-center justify-between gap-3">
        <span class="text-amber" aria-label="${a.note} sur 5">${etoiles(a.note)}</span>
        ${a.nouveau ? '<span class="rounded-full border border-mint/50 bg-mint/10 px-2 py-0.5 text-xs text-mint">Avis publié</span>' : ''}
      </div>
      <blockquote class="mt-3 text-sm leading-relaxed text-muted">« ${echappe(a.texte)} »</blockquote>
      <figcaption class="mt-4 text-sm">
        <span class="font-medium">${echappe(a.nom)}</span>
        <span class="block text-xs text-muted">${echappe(a.statut)}</span>
      </figcaption>
    </figure>`).join('');
}

export function brancherAvis() {
  const zoneNote = $('#avis-note');
  let noteChoisie = 5;

  if (zoneNote) {
    const dessiner = () => {
      zoneNote.innerHTML = [1, 2, 3, 4, 5].map(i =>
        `<button type="button" role="radio" aria-checked="${i === noteChoisie}" aria-label="${i} étoile${i > 1 ? 's' : ''}"
           data-note="${i}" class="text-2xl leading-none transition ${i <= noteChoisie ? 'text-amber' : 'text-line hover:text-amber/60'}">★</button>`
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
    const avis = {
      nom: nom.trim(),
      statut: reste.join(',').trim() || 'Utilisateur de PrepOral',
      note: noteChoisie,
      texte,
      nouveau: true,
      date: new Date().toISOString()
    };

    stock.ecrire(CONFIG.cles.avis, [avis, ...lireAvis()].slice(0, 20));

    if (supabase) {
      try {
        await supabase.from('avis').insert({
          utilisateur_id: session.id || null,
          nom: avis.nom, statut: avis.statut, note: avis.note, texte: avis.texte, publie: false
        });
      } catch (e) { console.warn('Avis non synchronisé', e); }
    }

    $('#avis-texte').value = '';
    rendreAvis();
    toast('Merci ! Votre avis est publié en tête de liste.', 'succes');
    $('#grille-avis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  rendreAvis();
}
