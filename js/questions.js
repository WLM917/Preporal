/* ═══════════════════════════════════════════════════════════
   questions.js — fabrique les questions de l'examinateur
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, typeParId } from './config.js';
import { langue, t } from './i18n.js';

export let modeDemo = false;

/** Levée quand le serveur refuse la simulation (quota épuisé, connexion requise). */
export class ErreurQuota extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/**
 * Le serveur refuse en français : il ne connaît pas la langue choisie
 * dans le navigateur. Il renvoie en revanche un code et la limite en
 * vigueur, de quoi réécrire la même phrase ici, traduite. Son texte
 * reste le repli si le code est inconnu.
 */
export function messageRefus({ code, limite, erreur }) {
  const n = String(limite ?? '');
  const cles = {
    connexion: ['refus.connexion', 'Créez un compte gratuit pour lancer une simulation : vos {n} simulations offertes y sont rattachées.'],
    quota:     ['refus.quota', 'Vos {n} simulations gratuites sont utilisées. Passez au Premium pour continuer.'],
    coach:     ['refus.coach', 'Vos {n} échanges du jour avec le coach sont utilisés. Revenez demain, ou passez au Premium pour un accès illimité.']
  };
  const paire = cles[code];
  if (!paire) return erreur || t('refus.defaut', 'Quota épuisé.');
  const traduit = t(paire[0], '');
  return (traduit || erreur || paire[1]).replace('{n}', n);
}

/**
 * @returns {Promise<Array<{categorie:string, texte:string}>>}
 * @throws {ErreurQuota} si le serveur refuse l'accès
 */
export async function genererQuestions({ typeId, sousChoix, champA, champB, nbQuestions, niveau, jeton }) {
  try {
    const r = await fetch(`${CONFIG.api}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jeton ? { Authorization: 'Bearer ' + jeton } : {})
      },
      body: JSON.stringify({ typeId, sousChoix, champA, champB, nbQuestions, niveau, langue: langue() })
    });

    /* 402 = quota épuisé ou connexion requise. Ce n'est PAS une panne :
       il ne faut surtout pas retomber sur les questions hors ligne, sinon
       le paywall ne bloque plus rien. On remonte l'erreur telle quelle. */
    if (r.status === 402) {
      const data = await r.json().catch(() => ({}));
      throw new ErreurQuota(messageRefus(data), data.code || 'quota');
    }

    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const q = (data.questions || []).filter(x => x && x.texte);
    if (!q.length) throw new Error('réponse vide');
    modeDemo = false;
    return q.slice(0, nbQuestions);
  } catch (e) {
    if (e instanceof ErreurQuota) throw e;
    // Panne réelle (réseau, modèle indisponible) : on dépanne hors ligne.
    modeDemo = true;
    return questionsDeSecours({ typeId, sousChoix, champA, champB, nbQuestions, niveau });
  }
}

/* ── Extraction de mots-clés (sert au mode démo) ───────────── */
/* Les mots vides dépendent de la langue de la réponse : une liste
   française ne filtre rien dans une annonce rédigée en anglais. */
const VIDES_PAR_LANGUE = {
  fr: 'alors ainsi aucun aussi autre avec avoir bien cela cette chez comme dans depuis des donc elle encore entre etre être faire fait leur leurs mais meme même notre nous plus pour pouvoir sans sont sous sur tous tout très votre vous candidat entreprise equipe équipe mission missions poste profil recherche recherchons stage travail annonce societe société',
  en: 'about above after again against also because been before being between both cannot could does doing during each from have here into itself more most must only other should some such than that their them then there these they this those through very were what when which while will with your company team role position candidate internship work mission profile looking',
  es: 'algo antes aqui aquí así aunque cada como cuando desde donde entre esta estar este esto hace haber hasta mismo mucho muy nuestro para pero poder porque puede sobre solo también tanto tiene todo todos vuestro empresa equipo puesto perfil misión prácticas trabajo candidato anuncio buscamos'
};
const motsVides = () => new Set((VIDES_PAR_LANGUE[langue()] || VIDES_PAR_LANGUE.fr).split(' '));

export function motsCles(texte = '', n = 8) {
  const vides = motsVides();
  const freq = new Map();
  (texte.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿñæœ][a-zàâçéèêëîïôûùüÿñæœ-]{3,}/g) || [])
    .forEach(m => { if (!vides.has(m)) freq.set(m, (freq.get(m) || 0) + 1); });
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

/* ── Banques de secours par épreuve ──────────────────────────
   Elles ne servent qu'en mode démo, quand le modèle est
   injoignable — mais elles s'affichent alors à l'écran, donc
   elles se traduisent comme le reste.

   Un texte peut contenir « {0|repli} » : le chiffre désigne un
   mot-clé extrait des documents, et le repli s'affiche quand
   l'extraction n'a rien donné. « {sujet|repli} » reprend la
   première ligne du document déposé. Le repli est dans la
   chaîne traduite, donc il se traduit avec elle.

   Le troisième élément marque une question dure : elle n'est
   posée qu'au ton « exigeant ». Ce drapeau remplace une
   comparaison sur le libellé « Pression », qui cessait de
   fonctionner dès que la catégorie était traduite.
   ──────────────────────────────────────────────────────────── */
const BANQUES = {
  entretien: [
    ['Parcours', 'Présentez-vous en deux minutes, en ne gardant que ce qui éclaire ce poste.'],
    ['Motivation', "Qu'est-ce qui vous attire précisément dans cette offre, au-delà du secteur ?"],
    ['Compétences', "L'annonce insiste sur « {0|la rigueur} ». Racontez une situation où vous l'avez démontré."],
    ['Mise en situation', 'Votre première semaine porte sur {1|un dossier inconnu}. Par quoi commencez-vous ?'],
    ['Compétences', "Parlez-moi d'un travail sur {2|un projet chiffré} : quel a été votre apport concret ?"],
    ['Recul', 'Racontez un échec professionnel ou scolaire et ce que vous en avez tiré.'],
    ['Collectif', 'Un désaccord avec un collègue sur une méthode : comment le gérez-vous ?'],
    ['Projection', 'Où voulez-vous en être dans trois ans, et en quoi ce poste y contribue ?'],
    ['Pression', "Votre profil manque d'expérience sur ce périmètre. Pourquoi vous plutôt qu'un candidat confirmé ?", true]
  ],
  'grand-oral': [
    ['Sujet', "Présentez votre question et expliquez pourquoi vous l'avez choisie."],
    ['Argumentation', 'Quelle est votre thèse principale, et sur quels arguments repose-t-elle ?'],
    ['Connaissances', 'Définissez précisément « {0|la notion centrale} » de votre sujet.'],
    ['Contre-argument', "Quelqu'un vous soutient exactement l'inverse de votre conclusion. Que lui répondez-vous ?"],
    ['Exemple', 'Donnez un exemple concret, chiffré ou historique, qui appuie votre démonstration.'],
    ['Lien au projet', "En quoi ce travail éclaire-t-il votre projet d'orientation ?"],
    ['Ouverture', 'Quelle limite voyez-vous à votre propre réponse ?'],
    ['Méthode', 'Quelles sources avez-vous utilisées, et comment en avez-vous vérifié la fiabilité ?']
  ],
  brevet: [
    ['Présentation', 'Présentez en quelques phrases {sujet|votre stage ou votre projet}.'],
    ['Découverte', 'Décrivez une journée type : que faisiez-vous concrètement ?'],
    ['Analyse', "Qu'est-ce qui vous a le plus surpris, en bien ou en mal ?"],
    ['Métiers', 'Quel métier avez-vous observé, et en quoi consiste-t-il vraiment ?'],
    ['Compétences', 'Quelles qualités faut-il pour exercer ce métier ?'],
    ['Orientation', 'Est-ce que cette expérience a changé quelque chose à votre projet ?'],
    ['Recul', 'Si vous pouviez refaire ce stage, que feriez-vous différemment ?']
  ],
  concours: [
    ['Motivation', 'Pourquoi cette école, et pas une autre du même niveau ?'],
    ['Personnalité', 'Quelle est la décision la plus difficile que vous ayez prise ?'],
    ['Parcours', 'Votre dossier mentionne {0|votre formation} : qu\'en retenez-vous ?'],
    ['Culture générale', "Quel sujet d'actualité vous a marqué ces derniers mois, et pourquoi ?"],
    ['Mise en situation', "Vous dirigez un groupe qui n'avance plus à trois jours du rendu. Que faites-vous ?"],
    ['Engagement', "Parlez-moi d'un engagement associatif, sportif ou personnel qui vous définit."],
    ['Projet', "Où vous voyez-vous cinq ans après la sortie de l'école ?"],
    ['Pression', "Qu'est-ce qui, dans votre dossier, pourrait faire hésiter le jury ?", true]
  ],
  pitch: [
    ['Problème', 'En une phrase : quel problème résolvez-vous, et pour qui ?'],
    ['Solution', "Qu'est-ce qui rend votre solution difficile à copier ?"],
    ['Marché', "Quelle est la taille de votre marché, et comment l'avez-vous estimée ?"],
    ['Modèle', "Comment gagnez-vous de l'argent, et à partir de quel volume ?"],
    ['Concurrence', 'Pourquoi vos clients ne restent-ils pas simplement sur {0|la solution actuelle} ?'],
    ['Objection', 'Votre principale hypothèse est-elle validée ? Par quoi ?'],
    ['Équipe', 'Pourquoi votre équipe est-elle la bonne pour exécuter ce projet ?'],
    ['Traction', "Quels chiffres pouvez-vous montrer aujourd'hui ?"]
  ],
  matiere: [
    ['Définition', 'Définissez « {0|la notion centrale du chapitre} ».'],
    ['Connaissances', 'Quels sont les points essentiels à retenir sur {sujet|ce sujet} ?'],
    ['Chronologie', 'Situez ce sujet dans son contexte : quand, où, pourquoi ?'],
    ['Analyse', 'Expliquez le lien entre {1|les causes} et {2|les conséquences}.'],
    ['Exemple', "Donnez un exemple précis qui illustre ce que vous venez d'expliquer."],
    ['Approfondissement', 'Quelle est la principale difficulté ou controverse sur ce point ?'],
    ['Synthèse', "Résumez l'essentiel en une minute, comme si vous l'expliquiez à un camarade."]
  ],

  /* Épreuves de langue : le texte reste dans la langue de l'examen,
     seules les catégories sont traduites — les dictionnaires ne
     définissent volontairement pas les clés « .q » de ces trois
     banques, le repli anglais/espagnol/allemand s'affiche donc. */
  langue: [
    ['Question personnelle', 'Tell me about yourself and what you are currently studying or doing.'],
    ['Description', 'Describe your daily routine and what you enjoy most about it.'],
    ['Opinion', 'Do you think technology makes people more or less social? Explain your view.'],
    ['Argumentation', 'Some people say studying abroad is essential. Do you agree? Give reasons and examples.'],
    ['Situation', 'You missed an important meeting. Call your manager and explain the situation.'],
    ['Comparaison', 'Compare living in a big city with living in a small town.'],
    ['Projection', 'What are your professional goals for the next five years?']
  ],
  'langue-es': [
    ['Présentation', 'Preséntate y habla de tus estudios o de tu trabajo.'],
    ['Description', 'Describe un día normal en tu vida.'],
    ['Opinion', '¿Crees que las redes sociales mejoran la comunicación? Justifica tu respuesta.'],
    ['Argumentation', 'Algunos dicen que estudiar en el extranjero es imprescindible. ¿Estás de acuerdo?'],
    ['Situation', 'Llegas tarde a una cita importante. Explica lo que ha pasado.'],
    ['Projection', '¿Cuáles son tus objetivos para los próximos años?']
  ],
  'langue-de': [
    ['Présentation', 'Stellen Sie sich bitte kurz vor.'],
    ['Description', 'Beschreiben Sie einen typischen Tag in Ihrem Leben.'],
    ['Opinion', 'Halten Sie soziale Netzwerke für nützlich? Begründen Sie Ihre Meinung.'],
    ['Argumentation', 'Sollte man im Ausland studieren? Nennen Sie Argumente.'],
    ['Situation', 'Sie haben einen wichtigen Termin verpasst. Erklären Sie warum.'],
    ['Projection', 'Was sind Ihre beruflichen Ziele?']
  ]
};

/** Remplace « {0|repli} » et « {sujet|repli} » dans un texte traduit. */
const remplir = (texte, k, sujet) =>
  texte.replace(/\{(\d|sujet)\|([^}]*)\}/g, (_, quoi, repli) =>
    (quoi === 'sujet' ? sujet : k[Number(quoi)]) || repli);

/** Identifiant de banque : les certifications non anglophones ont la leur. */
function idBanque(typeId, sousChoix) {
  if (typeId !== 'langue') return BANQUES[typeId] ? typeId : 'entretien';
  if (/dele|espagnol/i.test(sousChoix || '')) return 'langue-es';
  if (/goethe|allemand/i.test(sousChoix || '')) return 'langue-de';
  return 'langue';
}

function banque(typeId, k, sujet, sousChoix, exigeant) {
  const id = idBanque(typeId, sousChoix);
  return BANQUES[id]
    .filter(([, , dure]) => exigeant || !dure)
    .map(([categorie, texte], i) => ({
      categorie: t(`secours.${id}.${i}.cat`, categorie),
      texte: remplir(t(`secours.${id}.${i}.q`, texte), k, sujet)
    }));
}

export function questionsDeSecours({ typeId, sousChoix, champA, champB, nbQuestions, niveau }) {
  const type = typeParId(typeId);
  const k = motsCles(`${champB} ${champA}`, 8);
  const sujet = (champA || '').split('\n')[0].slice(0, 90);
  const liste = banque(type.id, k, sujet, sousChoix, niveau === 'exigeant');

  const premiere = liste[0];
  const reste = liste.slice(1).sort(() => Math.random() - 0.5);
  return [premiere, ...reste].slice(0, nbQuestions);
}
