/* ═══════════════════════════════════════════════════════════
   POST /api/questions
   Entrée  : { typeId, sousChoix, champA, champB, nbQuestions, niveau }
   Sortie  : { questions: [{ categorie, texte }] }
   ═══════════════════════════════════════════════════════════ */

import { appelerModele, extraireJSON, tronquer, verifierMethode, limiter, ErreurIA } from './_lib/ia.js';

const CONSIGNES = {
  entretien: "Tu es un recruteur expérimenté qui fait passer un entretien d'embauche ou de stage en France.",
  'grand-oral': "Tu es examinateur du Grand Oral du baccalauréat français. Tu interroges sur la question préparée, puis tu élargis au projet d'orientation, selon la grille officielle.",
  brevet: "Tu es membre du jury de l'oral du diplôme national du brevet. Tu interroges un élève de 3e avec bienveillance mais exigence, dans un vocabulaire adapté à son âge.",
  concours: "Tu es membre d'un jury d'admission de grande école ou de concours français. Tu challenges la cohérence du projet et la culture générale.",
  pitch: "Tu es un jury d'investisseurs et d'experts qui écoute un pitch de projet. Tes questions sont courtes, concrètes et exigeantes.",
  matiere: "Tu es professeur et tu interroges un élève à l'oral sur son cours. Tu vérifies les connaissances précises, le vocabulaire de la discipline et la capacité à illustrer.",
  langue: "Tu es examinateur d'une certification de langue. Tu poses les questions DANS LA LANGUE DE L'ÉPREUVE, au format officiel."
};

const TONS = {
  bienveillant: "Ton chaleureux et encourageant : tu mets le candidat à l'aise et tes questions restent ouvertes.",
  standard: "Ton professionnel et neutre, comme un vrai jury.",
  exigeant: "Ton exigeant : tu creuses, tu relances sur les points faibles, tu poses au moins une question déstabilisante."
};

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  if (!limiter(req, res, { max: 20 })) return;

  try {
    const { typeId = 'entretien', sousChoix = '', champA = '', champB = '', nbQuestions = 5, niveau = 'standard' } = req.body || {};
    const n = Math.max(1, Math.min(10, Number(nbQuestions) || 5));

    const systeme = `${CONSIGNES[typeId] || CONSIGNES.entretien}
${TONS[niveau] || TONS.standard}
${sousChoix ? `Contexte précis : ${sousChoix}.` : ''}

Tu prépares une simulation d'oral. Tu dois produire ${n} questions.

Règles :
- Les questions s'appuient sur les deux documents fournis : cite des éléments réellement présents, jamais inventés.
- Une seule question par entrée, formulée telle qu'un examinateur la prononcerait à l'oral.
- Progression : commencer par une question d'ouverture, finir par une question d'approfondissement ou de projection.
- Pas de question fermée par oui/non.
- Vouvoiement, français correct (sauf pour une épreuve de langue étrangère : utilise alors la langue de l'épreuve).

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, au format :
{"questions":[{"categorie":"...","texte":"..."}]}
La catégorie est un mot ou deux (ex. "Parcours", "Argumentation", "Mise en situation").`;

    const message = `DOCUMENT 1 :
${tronquer(champA, 6000) || '(vide)'}

DOCUMENT 2 :
${tronquer(champB, 6000) || '(vide)'}

Produis les ${n} questions.`;

    const brut = await appelerModele({
      systeme,
      messages: [{ role: 'user', content: message }],
      maxTokens: 1400,
      temperature: 0.8
    });

    const data = extraireJSON(brut);
    const questions = (data.questions || [])
      .filter(q => q && typeof q.texte === 'string' && q.texte.trim())
      .slice(0, n)
      .map(q => ({ categorie: String(q.categorie || 'Question').slice(0, 30), texte: q.texte.trim() }));

    if (!questions.length) throw new ErreurIA('Aucune question exploitable.');

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ questions });
  } catch (e) {
    console.error('api/questions', e);
    return res.status(e.code || 500).json({ erreur: e.message || 'Erreur serveur.' });
  }
}
