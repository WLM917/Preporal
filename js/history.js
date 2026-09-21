/* ═══════════════════════════════════════════════════════════
   history.js — « Mes simulations passées » + progression
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { fusionnerHistoriques, bornerDetail, aRattraper } from './fusion.js';
import { typeTraduit } from './catalogue.js';
import { $, stock, echappe, toast, couleurNote, jeton } from './ui.js';
import { supabase, session } from './auth.js';
import { t, region } from './i18n.js';

const MAX = 60;

export function lireHistorique() {
  return stock.lire(CONFIG.cles.historique, []) || [];
}

/** Retrouve une simulation par identifiant, avec tout son détail. */
export function lireSimulation(id) {
  return lireHistorique().find(s => s.id === id) || null;
}

/** Une simulation ne peut être rouverte que si son détail a été conservé. */
export const estRelisible = s =>
  Boolean(s && Array.isArray(s.reponses) && s.reponses.length);

const colonneAbsente = message =>
  /42703|does not exist|could not find|schema cache/i.test(String(message || ''));

/**
 * Remonte une simulation en base.
 *
 * Le détail vit dans cinq colonnes ajoutées après coup. Tant que
 * supabase/correctif-simulations.sql n'a pas été joué, elles n'existent
 * pas — et PostgREST refuse alors la ligne ENTIÈRE, pas seulement les
 * colonnes inconnues. Le premier jet de ce code ne prévoyait pas ce
 * cas : plus aucune simulation ne remontait, pas même sa note, et
 * l'erreur partait dans la console sans que personne la voie.
 *
 * On réessaie donc sans le détail plutôt que de tout perdre. La note
 * et la progression sont sauves ; le détail reprendra sa place dès que
 * les colonnes existeront.
 */
async function remonter(ligne) {
  const base = {
    utilisateur_id: session.id,
    type_id: ligne.typeId,
    sous_choix: ligne.sousChoix,
    score: ligne.score,
    eloquence: ligne.eloquence,
    nb_questions: ligne.nbQuestions,
    criteres: ligne.criteres
  };
  const complet = {
    ...base,
    reponses: ligne.reponses,
    eloquence_detail: ligne.eloquenceDetail,
    verdict: ligne.verdict,
    temps_total: ligne.tempsTotal,
    details: ligne.details
  };

  try {
    const { error } = await supabase.from('simulations').insert(complet);
    if (!error) return true;
    if (!colonneAbsente(error.message)) throw error;

    console.warn('Colonnes de détail absentes : la simulation remonte sans son détail. '
      + 'Jouez supabase/correctif-simulations.sql pour la rendre relisible ailleurs.');
    const reduit = await supabase.from('simulations').insert(base);
    if (reduit.error) throw reduit.error;
    return true;
  } catch (e) {
    console.warn('Historique non synchronisé', e);
    return false;
  }
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
    details: entree.details || [],

    /* Questions posées, réponses données et correction complète.
       Elles suivent le COMPTE, pas l'appareil : se connecter depuis
       un autre téléphone doit rendre la simulation relisible en
       entier, pas seulement sa note.

       Ce qui ne remonte toujours pas : le fichier de CV, le sujet
       déposé, l'audio. Lus dans le navigateur, ils servent à
       produire les questions et s'arrêtent là. */
    ...bornerDetail(entree)
  };

  const liste = [ligne, ...lireHistorique()].slice(0, MAX);
  stock.ecrire(CONFIG.cles.historique, liste);

  // Synchronisation multi-appareils si l'utilisateur est connecté.
  if (supabase && session.id) await remonter(ligne);

  rendreHistorique();
  return ligne;
}

export async function chargerDepuisServeur() {
  if (!supabase || !session.id) return;
  try {
    const { data } = await supabase
      .from('simulations')
      .select('id, cree_le, type_id, sous_choix, score, eloquence, nb_questions, criteres, reponses, eloquence_detail, verdict, temps_total, details')
      .eq('utilisateur_id', session.id)
      .order('cree_le', { ascending: false })
      .limit(MAX);
    if (!data?.length) return;

    const distant = data.map(d => ({
      id: d.id, date: d.cree_le, typeId: d.type_id, sousChoix: d.sous_choix,
      score: d.score, eloquence: d.eloquence, nbQuestions: d.nb_questions,
      criteres: d.criteres || {},
      // Le détail vient de la base : c'est lui qui rend la simulation
      // relisible depuis un appareil où elle n'a pas eu lieu.
      reponses: Array.isArray(d.reponses) ? d.reponses : [],
      eloquenceDetail: d.eloquence_detail || null,
      verdict: d.verdict || '',
      tempsTotal: d.temps_total || 0,
      details: Array.isArray(d.details) ? d.details : []
    }));

    /* On FUSIONNE, on n'écrase pas.

       Le serveur porte maintenant le détail, mais il peut ne pas encore
       l'avoir : une simulation remontée avant l'ajout des colonnes, ou
       depuis un site dont le schéma n'est pas à jour, n'a que sa note.
       Le navigateur d'origine, lui, l'a toujours.

       Écraser le local par le distant perdrait donc ce détail — c'est
       exactement ce que faisait la version précédente. On greffe. */
    const liste = fusionnerHistoriques(lireHistorique(), distant, MAX);
    stock.ecrire(CONFIG.cles.historique, liste);
    rendreHistorique();

    // Ce qui n'avait jamais pu remonter le fait maintenant.
    rattraper(liste, distant).catch(e => console.warn('Rattrapage abandonné', e));
  } catch (e) { console.warn('Historique distant indisponible', e); }
}

/* Au-delà, on s'arrête : un rattrapage est un rattrapage, pas une
   migration. Le reste suivra au prochain chargement. */
const RATTRAPAGE_MAX = 10;

/**
 * Remonte le détail des simulations que la base n'a pas.
 *
 * Sans cela, un détail bloqué par une coupure réseau — ou par un schéma
 * pas encore à jour — y restait pour toujours : rien ne retentait, et
 * la simulation n'était relisible que sur l'appareil où elle avait eu
 * lieu. L'historique cessait d'appartenir au compte.
 */
async function rattraper(liste, brutes) {
  if (!supabase || !session.id) return 0;

  const aFaire = aRattraper(liste, brutes).slice(0, RATTRAPAGE_MAX);
  let remontees = 0;

  for (const s of aFaire) {
    const d = bornerDetail(s);
    const { error } = await supabase.from('simulations').update({
      reponses: d.reponses,
      eloquence_detail: d.eloquenceDetail,
      verdict: d.verdict,
      temps_total: d.tempsTotal,
      details: d.details
    }).eq('id', s.id).eq('utilisateur_id', session.id);

    if (error) {
      /* Un refus vaut pour tous : colonnes absentes, ou règle d'écriture
         pas encore posée. Inutile d'insister neuf fois de plus. */
      console.warn('Détail non rattrapé : ' + (error.message || error)
        + ' — jouez supabase/correctif-rattrapage.sql.');
      break;
    }
    remontees++;
  }
  return remontees;
}

/* ── Rendu ─────────────────────────────────────────────────── */
export function rendreHistorique() {
  const liste = lireHistorique();
  const zone = $('#liste-historique');
  const graph = $('#graphique-progression');
  if (!zone || !graph) return;

  if (!liste.length) {
    graph.innerHTML = '';
    zone.innerHTML = `<div class="rounded-xl border border-dashed border-line bg-ink/40 p-8 text-center text-sm text-muted">${
      echappe(t('hist.aucune', 'Aucune simulation pour le moment. Lancez-en une : elle apparaîtra ici avec sa note et sa correction.'))}</div>`;
    return;
  }

  graph.innerHTML = courbe(liste.slice().reverse());

  zone.innerHTML = liste.map(s => {
    const type = typeTraduit(s.typeId);
    const d = new Date(s.date);
    const relisible = estRelisible(s);
    /* La ligne était un bouton unique. Il en faut deux — relire, et
       effacer — et un bouton ne s'imbrique pas dans un autre. */
    return `<div class="group relative flex items-stretch gap-2">
    <button type="button" data-relire="${s.id}"
      class="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl border border-line bg-ink/40 p-4 text-left transition hover:border-iris/60">
      <div class="min-w-0">
        <p class="truncate font-medium">${type.emoji} ${echappe(type.court)}${s.sousChoix ? ' · ' + echappe(s.sousChoix) : ''}</p>
        <p class="text-xs text-muted">${d.toLocaleDateString(region())} ${t('hist.a', 'à')} ${d.toLocaleTimeString(region(), { hour: '2-digit', minute: '2-digit' })} · ${s.nbQuestions} ${t(s.nbQuestions > 1 ? 'hist.questions' : 'hist.question', s.nbQuestions > 1 ? 'questions' : 'question')}${s.eloquence != null ? ' · ' + t('hist.eloquence', 'éloquence') + ' ' + s.eloquence + '/20' : ''}</p>
        <p class="mt-1 text-xs ${relisible ? 'text-iris2' : 'text-muted'}">
          ${relisible ? t('hist.relire', 'Relire les questions et la correction →') : t('hist.non_conserve', 'Détail non conservé')}
        </p>
      </div>
      <span class="shrink-0 font-display text-xl font-extrabold tabular-nums" style="color:${couleurNote(s.score)}">${s.score}</span>
    </button>
    <button type="button" data-effacer="${s.id}"
      title="${echappe(t('hist.effacer_une', 'Effacer cette simulation'))}"
      aria-label="${echappe(t('hist.effacer_une', 'Effacer cette simulation'))}"
      class="shrink-0 rounded-xl border border-line bg-ink/40 px-3 text-muted transition hover:border-coral/60 hover:text-coral">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m5 6 1 14h12l1-14"/>
      </svg>
    </button>
    </div>`;
  }).join('');

  zone.querySelectorAll('[data-effacer]').forEach(b =>
    b.addEventListener('click', () => effacerUne(b.dataset.effacer)));
}

/**
 * Efface une simulation, ici et en base.
 *
 * Une simulation dont le détail a été perdu avant le correctif ne peut
 * pas être réparée : la seule chose honnête est de permettre de la
 * retirer, plutôt que de la laisser afficher « détail non conservé »
 * pour toujours.
 */
async function effacerUne(id) {
  if (!id) return;
  if (!confirm(t('hist.effacer_une_confirmer',
    'Effacer définitivement cette simulation et sa correction ?'))) return;

  const ligne = lireSimulation(id);

  if (supabase && session.id) {
    /* L'identifiant local (« sim_… ») n'existe pas en base : on vise la
       ligne par ce qui l'identifie vraiment, et on borne au compte. */
    let requete = supabase.from('simulations').delete().eq('utilisateur_id', session.id);
    requete = String(id).startsWith('sim_') && ligne
      ? requete.eq('type_id', ligne.typeId).eq('score', ligne.score)
          .eq('nb_questions', ligne.nbQuestions)
      : requete.eq('id', id);

    const { error } = await requete;
    if (error) {
      console.warn('Simulation non effacée en base', error);
      return toast(t('hist.effacer_echec',
        "Cette simulation n'a pas pu être effacée. Réessayez dans un instant."), 'erreur');
    }
  }

  stock.ecrire(CONFIG.cles.historique, lireHistorique().filter(s => s.id !== id));
  rendreHistorique();
  toast(t('hist.effacee', 'Simulation effacée.'));
}

/** Petite courbe SVG maison : pas de librairie à charger. */
function courbe(points) {
  if (points.length < 2) {
    return `<p class="rounded-xl border border-line bg-ink/40 p-4 text-sm text-muted">${
      t('hist.courbe_attente', "Une deuxième simulation et votre courbe de progression s'affichera ici.")}</p>`;
  }
  const iris = jeton('--iris', 'rgb(124 92 255)');
  const iris2 = jeton('--iris2', 'rgb(167 139 255)');
  const ligneCouleur = jeton('--line', 'rgb(38 35 54)');
  const L = 640, H = 160, pad = 24;
  const n = points.length;
  const x = i => pad + (i * (L - pad * 2)) / (n - 1);
  const y = v => H - pad - ((Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2));

  const ligne = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const aire = `${ligne} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const cercles = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4" fill="${couleurNote(p.score)}" stroke="${jeton('--surface', 'rgb(17 16 24)')}" stroke-width="2"><title>${p.score}/100</title></circle>`).join('');

  const dernier = points[n - 1].score, premier = points[0].score;
  const ecart = dernier - premier;

  return `
  <div class="rounded-xl border border-line bg-ink/40 p-4">
    <div class="flex items-baseline justify-between">
      <p class="text-sm text-muted">${t('hist.progression', 'Progression sur {n} simulations').replace('{n}', n)}</p>
      <p class="font-display text-sm font-bold" style="color:${ecart >= 0 ? jeton('--mint', 'rgb(61 220 151)') : jeton('--coral', 'rgb(255 93 108)')}">${ecart >= 0 ? '+' : ''}${ecart} pts</p>
    </div>
    <svg viewBox="0 0 ${L} ${H}" class="mt-3 w-full" role="img" aria-label="${echappe(t('hist.courbe_a11y', 'Courbe de progression des notes'))}">
      <defs>
        <linearGradient id="remplissage" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${iris}" stop-opacity=".35"/>
          <stop offset="100%" stop-color="${iris}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${y(50)}" x2="${L - pad}" y2="${y(50)}" stroke="${ligneCouleur}" stroke-dasharray="4 6"/>
      <path d="${aire}" fill="url(#remplissage)"/>
      <path d="${ligne}" fill="none" stroke="${iris2}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${cercles}
    </svg>
  </div>`;
}

export function brancherHistorique() {
  $('#btn-vider-historique')?.addEventListener('click', async () => {
    if (!confirm(t('hist.vider_confirmer', 'Effacer définitivement toutes vos simulations enregistrées ?'))) return;

    /* Le vidage ne touchait que ce navigateur. Depuis que
       l'historique suit le compte, cela ne l'effaçait donc pas : il
       revenait au rechargement suivant, et le bouton mentait. */
    if (supabase && session.id) {
      const { error } = await supabase.from('simulations')
        .delete().eq('utilisateur_id', session.id);
      if (error) {
        console.warn('Historique non effacé en base', error);
        return toast(t('hist.vider_echec',
          "L'historique n'a pas pu être effacé. Réessayez dans un instant."), 'erreur');
      }
    }

    stock.supprimer(CONFIG.cles.historique);
    rendreHistorique();
    toast(t('hist.vide', 'Historique effacé.'));
  });
  rendreHistorique();
}
