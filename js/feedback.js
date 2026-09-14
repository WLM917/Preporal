/* ═══════════════════════════════════════════════════════════
   feedback.js — correction des réponses + analyse d'éloquence
   ═══════════════════════════════════════════════════════════ */

import { langue, t } from './i18n.js';
import { CONFIG } from './config.js';
import { typeTraduit } from './catalogue.js';
import { compterMots } from './ui.js';

export let modeDemo = false;

/**
 * @returns {Promise<{global:number, criteres:Object, details:Array, eloquence:Object}>}
 */
export async function evaluer({ typeId, sousChoix, champA, champB, questions, reponses, jeton }) {
  const eloquence = analyseEloquence(reponses);
  try {
    const r = await fetch(`${CONFIG.api}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: 'Bearer ' + jeton } : {}) },
      /* Les critères partent traduits : ils reviennent comme clés du
         bilan, et c'est ce libellé-là que le rapport affiche. */
      body: JSON.stringify({ typeId, sousChoix, champA, champB, questions, reponses,
                             mesures: eloquence.mesures, langue: langue(),
                             criteres: typeTraduit(typeId).criteres })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (typeof data.global !== 'number') throw new Error('réponse invalide');
    modeDemo = false;
    return { ...data, eloquence: { ...eloquence, ...(data.eloquence || {}) } };
  } catch {
    modeDemo = true;
    return { ...evaluationDeSecours({ typeId, reponses }), eloquence };
  }
}

/* ═══ Analyse d'éloquence (toujours calculée localement) ═══════
   Elle s'appuie sur des mesures objectives du texte retranscrit
   et sur le temps de parole réellement mesuré au micro.
   ════════════════════════════════════════════════════════════ */

/* Ces listes servent à analyser ce que le candidat a dit : elles
   doivent donc suivre la langue dans laquelle il répond, c'est-à-dire
   celle de l'interface. Une liste française ne repère aucun « you know »
   dans une réponse en anglais. */
const TICS_PAR_LANGUE = {
  fr: ['euh', 'heu', 'en fait', 'du coup', 'voilà', 'genre', 'bah', 'ben', 'tu vois', 'on va dire', 'un peu', "j'sais pas"],
  en: ['um', 'uh', 'er', 'like', 'you know', 'i mean', 'kind of', 'sort of', 'basically', 'actually', 'stuff like that', 'i guess'],
  es: ['eh', 'este', 'o sea', 'pues', 'bueno', 'digamos', 'sabes', 'como que', 'en plan', 'la verdad', 'un poco', 'no sé']
};
const CONNECTEURS_PAR_LANGUE = {
  fr: ["d'abord", 'ensuite', 'enfin', 'par ailleurs', 'en revanche', 'donc', 'parce que', "c'est pourquoi", 'en effet', 'autrement dit', 'concrètement', 'par exemple'],
  en: ['first', 'then', 'finally', 'moreover', 'however', 'so', 'because', 'that is why', 'indeed', 'in other words', 'concretely', 'for example'],
  es: ['primero', 'luego', 'por último', 'además', 'en cambio', 'por lo tanto', 'porque', 'por eso', 'de hecho', 'es decir', 'concretamente', 'por ejemplo']
};
const PREUVES_PAR_LANGUE = {
  fr: ['résultat', 'chiffre', '%', 'objectif', 'client', 'équipe', 'délai', 'budget', 'exemple', 'donc'],
  en: ['result', 'figure', '%', 'target', 'client', 'team', 'deadline', 'budget', 'example', 'so'],
  es: ['resultado', 'cifra', '%', 'objetivo', 'cliente', 'equipo', 'plazo', 'presupuesto', 'ejemplo', 'por lo tanto']
};
const selonLangue = table => table[langue()] || table.fr;
const TICS = () => selonLangue(TICS_PAR_LANGUE);
const CONNECTEURS = () => selonLangue(CONNECTEURS_PAR_LANGUE);
const PREUVES = () => selonLangue(PREUVES_PAR_LANGUE);

/** Recherche par mot entier : « heures » ne doit pas compter comme le tic « heu ». */
const echapperRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contient = (texte, expression) =>
  new RegExp('(^|[^\\p{L}\\p{N}])' + echapperRegex(expression) + '($|[^\\p{L}\\p{N}])', 'iu').test(texte);
const trouver = (texte, liste) => liste.filter(x => contient(texte, x));

export function analyseEloquence(reponses = []) {
  const parlees = reponses.filter(r => r.texte && r.texte.trim());
  const texteTotal = parlees.map(r => r.texte).join(' ');
  const mots = compterMots(texteTotal);
  const secondes = parlees.reduce((s, r) => s + (r.dureeParole || r.duree || 0), 0);

  // Débit : mots par minute. Repère oral français : 130–160 mpm.
  const debit = secondes > 5 ? Math.round(mots / (secondes / 60)) : null;

  // Richesse lexicale : indice de Guiraud (mots distincts / √total), ramené sur 100.
  // Repère : un oral soigné tourne autour de 6 à 8 avant normalisation.
  const liste = texteTotal.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿñæœ']{3,}/g) || [];
  const distincts = new Set(liste).size;
  const guiraud = liste.length ? distincts / Math.sqrt(liste.length) : 0;
  const richesse = Math.max(0, Math.min(100, Math.round((guiraud / 8) * 100)));

  // Clarté : phrases ni trop longues ni hachées, peu de tics, des connecteurs logiques.
  const phrases = texteTotal.split(/[.!?…]+/).filter(p => p.trim().length > 3);
  const motsParPhrase = phrases.length ? Math.round(mots / phrases.length) : mots;
  const basse = texteTotal.toLowerCase();
  const ticsTrouves = trouver(basse, TICS());
  const connecteursTrouves = trouver(basse, CONNECTEURS());

  let clarte = 70;
  if (motsParPhrase > 40) clarte -= 20;
  else if (motsParPhrase > 28) clarte -= 10;
  else if (motsParPhrase < 8 && phrases.length > 2) clarte -= 8;
  clarte -= Math.min(24, ticsTrouves.length * 6);
  clarte += Math.min(22, connecteursTrouves.length * 5);
  clarte = Math.max(0, Math.min(100, clarte));

  // Note d'éloquence sur 20.
  let note = 10;
  if (debit !== null) {
    if (debit >= 125 && debit <= 165) note += 4;
    else if (debit >= 100 && debit <= 185) note += 2;
    else note -= 1;
  }
  note += Math.round((richesse - 45) / 12);
  note += Math.round((clarte - 60) / 15);
  note = Math.max(0, Math.min(20, note));

  const conseils = [];
  if (debit === null) conseils.push(t('bilan.debit.non_mesure', "Répondez au micro plutôt qu'au clavier : Oralixia pourra alors mesurer votre débit et vos silences."));
  else if (debit > 175) conseils.push(t('bilan.debit.rapide', "Vous parlez à {n} mots/minute : c'est rapide. Marquez une respiration après chaque idée, le jury a besoin de vous suivre.").replace('{n}', debit));
  else if (debit < 105) conseils.push(t('bilan.debit.lent', "Vous parlez à {n} mots/minute : un peu lent, ce qui donne une impression d'hésitation. Enchaînez vos idées sans chercher le mot parfait.").replace('{n}', debit));
  else conseils.push(t('bilan.debit.bon', "Débit de {n} mots/minute : c'est le rythme d'un oral maîtrisé, gardez-le.").replace('{n}', debit));

  if (ticsTrouves.length) conseils.push(t('bilan.tics.reperes', "Tics de langage repérés : {liste}. Remplacez-les par un silence d'une seconde, qui passe pour de l'assurance.").replace('{liste}', ticsTrouves.slice(0, 5).join(', ')));
  else conseils.push(t('bilan.tics.aucun', 'Aucun tic de langage marquant : votre parole est nette.'));

  if (connecteursTrouves.length < 3) conseils.push(t('bilan.plan', "Annoncez votre plan à l'oral (« d'abord… ensuite… enfin ») : le jury note ce qu'il arrive à suivre."));
  if (richesse < 40) conseils.push(t('bilan.vocabulaire', 'Vocabulaire répétitif : préparez cinq termes précis du domaine et placez-les volontairement.'));
  if (motsParPhrase > 32) conseils.push(t('bilan.phrases_longues', 'Vos phrases font en moyenne {n} mots. Coupez-les en deux : une idée, une phrase.').replace('{n}', motsParPhrase));

  return {
    note,
    debit,
    richesse,
    clarte,
    motsParPhrase,
    tics: ticsTrouves,
    conseils,
    mesures: { mots, secondes, debit, richesse, clarte, motsParPhrase, tics: ticsTrouves.length }
  };
}

/* ═══ Correction de secours (hors ligne / API indisponible) ═══ */

/* Marqueurs de plan et de première personne, par langue : ils
   cherchent dans la réponse du candidat, pas dans l'interface. */
const PLAN_PAR_LANGUE = {
  fr: /(d'abord|ensuite|enfin|premièrement|par ailleurs)/,
  en: /(first(ly)?|then|finally|moreover|secondly)/,
  es: /(primero|luego|por último|además|en segundo lugar)/
};
const MOI_PAR_LANGUE = {
  fr: /(j'ai|je suis|j'avais|mon rôle|je me suis)/,
  en: /(i have|i was|i am|i did|my role|i led|i built)/,
  es: /(he |fui |era |mi papel|hice |yo )/
};

export function evaluationDeSecours({ typeId, reponses }) {
  const type = typeTraduit(typeId);

  const details = reponses.map(r => {
    const texte = (r.texte || '').trim();
    if (!texte) return { note: 0, forts: [], axes: [t('bilan.sans_reponse', 'Question laissée sans réponse : reprenez-la à voix haute, même imparfaitement.')], reecriture: '' };

    const mots = compterMots(texte);
    const basse = texte.toLowerCase();
    const forts = [], axes = [];
    let note = 4;

    if (mots >= 110) { note += 4; forts.push(t('bilan.long.bien', 'Réponse assez développée pour convaincre.')); }
    else if (mots >= 55) { note += 3; forts.push(t('bilan.long.correct', 'Longueur correcte ; un exemple de plus la rendrait imparable.')); }
    else { axes.push(t('bilan.long.court', 'Trop court : visez 45 à 120 secondes, soit environ 100 à 250 mots.')); }

    if (/\d/.test(texte)) { note += 3; forts.push(t('bilan.chiffres.oui', 'Vous appuyez votre propos sur des éléments chiffrés ou datés.')); }
    else { axes.push(t('bilan.chiffres.non', 'Ajoutez une donnée précise : une durée, un volume, une date, un nombre.')); }

    if (PREUVES().some(p => (p === '%' ? basse.includes(p) : contient(basse, p)))) { note += 3; forts.push(t('bilan.preuve.oui', "Le raisonnement va jusqu'au résultat ou à l'exemple.")); }
    else { axes.push(t('bilan.preuve.non', 'Terminez par ce que ça a produit, pas seulement par ce que vous avez fait.')); }

    if (selonLangue(PLAN_PAR_LANGUE).test(basse)) { note += 2; forts.push(t('bilan.plan.oui', 'Le plan de la réponse est audible.')); }
    else { axes.push(t('bilan.plan.non', 'Annoncez deux ou trois points en ouverture : le jury suit mieux.')); }

    if (selonLangue(MOI_PAR_LANGUE).test(basse)) { note += 3; forts.push(t('bilan.je.oui', 'Vous assumez votre rôle à la première personne.')); }
    else { axes.push(t('bilan.je.non', "Dites « j'ai fait », pas « on a fait » : le jury évalue vous.")); }

    const tics = trouver(basse, TICS());
    if (tics.length) { note -= 2; axes.push(t('bilan.tics.supprimer', 'Tics de langage à supprimer : {liste}.').replace('{liste}', tics.slice(0, 4).join(', '))); }
    else { note += 1; }

    return {
      note: Math.max(0, Math.min(20, note)),
      forts, axes,
      reecriture: texte.length > 40
        ? t('bilan.reecriture', 'Ouvrez ainsi : « {debut}… » puis enchaînez sur un exemple daté et chiffré, et concluez en une phrase sur le résultat.')
            .replace('{debut}', texte.split(/[.!?]/)[0].trim().slice(0, 90))
        : ''
    };
  });

  const moyenne = details.reduce((s, d) => s + d.note, 0) / (details.length || 1);
  const base = Math.round(moyenne * 5);
  /* On compare à la phrase traduite, pas à un mot français : sinon
     l'agrégat retombe toujours au même score en anglais. */
  const chiffresOui = t('bilan.chiffres.oui', 'Vous appuyez votre propos sur des éléments chiffrés ou datés.');
  const ticsPrefixe = t('bilan.tics.supprimer', 'Tics de langage à supprimer : {liste}.').split('{liste}')[0];
  const avecChiffres = details.filter(d => d.forts.includes(chiffresOui)).length / (details.length || 1);
  const sansTics = details.filter(d => !d.axes.some(a => a.startsWith(ticsPrefixe))).length / (details.length || 1);

  const criteres = {};
  (type.criteres || []).forEach((nom, i) => {
    const bonus = [0, 4, Math.round(avecChiffres * 30 - 12), Math.round(sansTics * 24 - 10)][i] || 0;
    criteres[nom] = Math.max(5, Math.min(100, base + bonus));
  });

  return { global: base, criteres, details };
}
