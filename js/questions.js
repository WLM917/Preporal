/* ═══════════════════════════════════════════════════════════
   questions.js — fabrique les questions de l'examinateur
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, typeParId } from './config.js';

export let modeDemo = false;

/**
 * @returns {Promise<Array<{categorie:string, texte:string}>>}
 */
export async function genererQuestions({ typeId, sousChoix, champA, champB, nbQuestions, niveau, jeton }) {
  try {
    const r = await fetch(`${CONFIG.api}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jeton ? { Authorization: 'Bearer ' + jeton } : {})
      },
      body: JSON.stringify({ typeId, sousChoix, champA, champB, nbQuestions, niveau })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const q = (data.questions || []).filter(x => x && x.texte);
    if (!q.length) throw new Error('réponse vide');
    modeDemo = false;
    return q.slice(0, nbQuestions);
  } catch {
    modeDemo = true;
    return questionsDeSecours({ typeId, sousChoix, champA, champB, nbQuestions, niveau });
  }
}

/* ── Extraction de mots-clés (sert au mode démo) ───────────── */
const VIDES = new Set(('alors ainsi aucun aussi autre avec avoir bien cela cette chez comme dans depuis des donc elle encore entre etre être faire fait leur leurs mais meme même notre nous plus pour pouvoir sans sont sous sur tous tout très votre vous candidat entreprise equipe équipe mission missions poste profil recherche recherchons stage travail annonce societe société')
  .split(' '));

export function motsCles(texte = '', n = 8) {
  const freq = new Map();
  (texte.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿñæœ][a-zàâçéèêëîïôûùüÿñæœ-]{3,}/g) || [])
    .forEach(m => { if (!VIDES.has(m)) freq.set(m, (freq.get(m) || 0) + 1); });
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

/* ── Banques de secours par épreuve ────────────────────────── */
function banque(typeId, k, sujet, sousChoix) {
  const m = (i, repli) => k[i] || repli;

  const banques = {
    entretien: [
      ['Parcours', 'Présentez-vous en deux minutes, en ne gardant que ce qui éclaire ce poste.'],
      ['Motivation', "Qu'est-ce qui vous attire précisément dans cette offre, au-delà du secteur ?"],
      ['Compétences', `L'annonce insiste sur « ${m(0, 'la rigueur')} ». Racontez une situation où vous l'avez démontré.`],
      ['Mise en situation', `Votre première semaine porte sur ${m(1, 'un dossier inconnu')}. Par quoi commencez-vous ?`],
      ['Compétences', `Parlez-moi d'un travail sur ${m(2, 'un projet chiffré')} : quel a été votre apport concret ?`],
      ['Recul', "Racontez un échec professionnel ou scolaire et ce que vous en avez tiré."],
      ['Collectif', "Un désaccord avec un collègue sur une méthode : comment le gérez-vous ?"],
      ['Projection', "Où voulez-vous en être dans trois ans, et en quoi ce poste y contribue ?"],
      ['Pression', "Votre profil manque d'expérience sur ce périmètre. Pourquoi vous plutôt qu'un candidat confirmé ?"]
    ],
    'grand-oral': [
      ['Sujet', `Présentez votre question et expliquez pourquoi vous l'avez choisie.`],
      ['Argumentation', `Quelle est votre thèse principale, et sur quels arguments repose-t-elle ?`],
      ['Connaissances', `Définissez précisément « ${m(0, 'la notion centrale')} » de votre sujet.`],
      ['Contre-argument', "Quelqu'un vous soutient exactement l'inverse de votre conclusion. Que lui répondez-vous ?"],
      ['Exemple', "Donnez un exemple concret, chiffré ou historique, qui appuie votre démonstration."],
      ['Lien au projet', "En quoi ce travail éclaire-t-il votre projet d'orientation ?"],
      ['Ouverture', "Quelle limite voyez-vous à votre propre réponse ?"],
      ['Méthode', "Quelles sources avez-vous utilisées, et comment en avez-vous vérifié la fiabilité ?"]
    ],
    brevet: [
      ['Présentation', `Présentez en quelques phrases ${sujet || 'votre stage ou votre projet'}.`],
      ['Découverte', "Décrivez une journée type : que faisiez-vous concrètement ?"],
      ['Analyse', "Qu'est-ce qui vous a le plus surpris, en bien ou en mal ?"],
      ['Métiers', "Quel métier avez-vous observé, et en quoi consiste-t-il vraiment ?"],
      ['Compétences', "Quelles qualités faut-il pour exercer ce métier ?"],
      ['Orientation', "Est-ce que cette expérience a changé quelque chose à votre projet ?"],
      ['Recul', "Si vous pouviez refaire ce stage, que feriez-vous différemment ?"]
    ],
    concours: [
      ['Motivation', "Pourquoi cette école, et pas une autre du même niveau ?"],
      ['Personnalité', "Quelle est la décision la plus difficile que vous ayez prise ?"],
      ['Parcours', `Votre dossier mentionne ${m(0, 'votre formation')} : qu'en retenez-vous ?`],
      ['Culture générale', "Quel sujet d'actualité vous a marqué ces derniers mois, et pourquoi ?"],
      ['Mise en situation', "Vous dirigez un groupe qui n'avance plus à trois jours du rendu. Que faites-vous ?"],
      ['Engagement', "Parlez-moi d'un engagement associatif, sportif ou personnel qui vous définit."],
      ['Projet', "Où vous voyez-vous cinq ans après la sortie de l'école ?"],
      ['Pression', "Qu'est-ce qui, dans votre dossier, pourrait faire hésiter le jury ?"]
    ],
    pitch: [
      ['Problème', "En une phrase : quel problème résolvez-vous, et pour qui ?"],
      ['Solution', "Qu'est-ce qui rend votre solution difficile à copier ?"],
      ['Marché', "Quelle est la taille de votre marché, et comment l'avez-vous estimée ?"],
      ['Modèle', "Comment gagnez-vous de l'argent, et à partir de quel volume ?"],
      ['Concurrence', `Pourquoi vos clients ne restent-ils pas simplement sur ${m(0, 'la solution actuelle')} ?`],
      ['Objection', "Votre principale hypothèse est-elle validée ? Par quoi ?"],
      ['Équipe', "Pourquoi votre équipe est-elle la bonne pour exécuter ce projet ?"],
      ['Traction', "Quels chiffres pouvez-vous montrer aujourd'hui ?"]
    ],
    matiere: [
      ['Définition', `Définissez « ${m(0, 'la notion centrale du chapitre')} ».`],
      ['Connaissances', `Quels sont les points essentiels à retenir sur ${sujet || 'ce sujet'} ?`],
      ['Chronologie', "Situez ce sujet dans son contexte : quand, où, pourquoi ?"],
      ['Analyse', `Expliquez le lien entre ${m(1, 'les causes')} et ${m(2, 'les conséquences')}.`],
      ['Exemple', "Donnez un exemple précis qui illustre ce que vous venez d'expliquer."],
      ['Approfondissement', "Quelle est la principale difficulté ou controverse sur ce point ?"],
      ['Synthèse', "Résumez l'essentiel en une minute, comme si vous l'expliquiez à un camarade."]
    ],
    langue: [
      ['Question personnelle', 'Tell me about yourself and what you are currently studying or doing.'],
      ['Description', 'Describe your daily routine and what you enjoy most about it.'],
      ['Opinion', 'Do you think technology makes people more or less social? Explain your view.'],
      ['Argumentation', 'Some people say studying abroad is essential. Do you agree? Give reasons and examples.'],
      ['Situation', 'You missed an important meeting. Call your manager and explain the situation.'],
      ['Comparaison', 'Compare living in a big city with living in a small town.'],
      ['Projection', 'What are your professional goals for the next five years?']
    ]
  };

  let liste = banques[typeId] || banques.entretien;

  // Adaptation de langue pour les certifications non anglophones.
  if (typeId === 'langue' && /dele|espagnol/i.test(sousChoix || '')) {
    liste = [
      ['Presentación', 'Preséntate y habla de tus estudios o de tu trabajo.'],
      ['Descripción', 'Describe un día normal en tu vida.'],
      ['Opinión', '¿Crees que las redes sociales mejoran la comunicación? Justifica tu respuesta.'],
      ['Argumentación', 'Algunos dicen que estudiar en el extranjero es imprescindible. ¿Estás de acuerdo?'],
      ['Situación', 'Llegas tarde a una cita importante. Explica lo que ha pasado.'],
      ['Proyección', '¿Cuáles son tus objetivos para los próximos años?']
    ];
  }
  if (typeId === 'langue' && /goethe|allemand/i.test(sousChoix || '')) {
    liste = [
      ['Vorstellung', 'Stellen Sie sich bitte kurz vor.'],
      ['Beschreibung', 'Beschreiben Sie einen typischen Tag in Ihrem Leben.'],
      ['Meinung', 'Halten Sie soziale Netzwerke für nützlich? Begründen Sie Ihre Meinung.'],
      ['Argumentation', 'Sollte man im Ausland studieren? Nennen Sie Argumente.'],
      ['Situation', 'Sie haben einen wichtigen Termin verpasst. Erklären Sie warum.'],
      ['Ziele', 'Was sind Ihre beruflichen Ziele?']
    ];
  }

  return liste.map(([categorie, texte]) => ({ categorie, texte }));
}

export function questionsDeSecours({ typeId, sousChoix, champA, champB, nbQuestions, niveau }) {
  const type = typeParId(typeId);
  const k = motsCles(`${champB} ${champA}`, 8);
  const sujet = (champA || '').split('\n')[0].slice(0, 90);
  let liste = banque(type.id, k, sujet, sousChoix);

  // Le ton « exigeant » garde les questions difficiles en fin de parcours.
  if (niveau !== 'exigeant') liste = liste.filter(q => q.categorie !== 'Pression');

  const premiere = liste[0];
  const reste = liste.slice(1).sort(() => Math.random() - 0.5);
  return [premiere, ...reste].slice(0, nbQuestions);
}
