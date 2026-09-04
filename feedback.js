// api/feedback.js — Vercel Serverless Function (Node.js)
// Note les réponses de l'utilisateur et rédige la correction.

import { callClaude, extractJson } from './questions.js';

const MAX_CHARS = 12000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const { cv = '', offer = '', exchanges = [], lang = 'français' } = req.body || {};
  if (!Array.isArray(exchanges) || exchanges.length === 0) {
    return res.status(400).json({ error: 'Aucune réponse à corriger.' });
  }

  const system = `Tu es un coach en entretien d'embauche, exigeant et concret.
Tu reçois le CV du candidat, l'offre visée, et ses réponses à 5 questions
d'entretien. Tu évalues chaque réponse.

Critères de notation sur 20 :
- structure (situation, action, résultat) ;
- présence de faits précis : chiffres, durées, outils, rôle exact ;
- pertinence par rapport aux exigences de l'offre ;
- absence de langue de bois et de généralités.

Consignes :
- Sois franc. Une réponse vide ou creuse mérite une note basse, dis-le sans détour.
- "gap" nomme ce qui manque précisément, pas un conseil vague.
- "fixes" contient 2 ou 3 corrections applicables immédiatement.
- "model" réécrit la réponse en 4 à 6 phrases, à la première personne, en
  réutilisant uniquement des éléments réels du CV du candidat. N'invente aucun
  chiffre ni employeur.
- "verdict" fait 2 phrases maximum sur la performance d'ensemble.
- Tout est rédigé en ${lang}.
- "score" global est sur 100 et reflète la moyenne des notes.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises de code :
{"score":0,"verdict":"...","reviews":[{"score":0,"strength":"...","gap":"...","fixes":["..."],"model":"..."}]}
Le tableau "reviews" contient un objet par question, dans le même ordre.`;

  const user = `CV :
"""
${cv.slice(0, MAX_CHARS)}
"""

OFFRE :
"""
${offer.slice(0, MAX_CHARS)}
"""

ENTRETIEN :
${exchanges.map((e, i) => `
Question ${i + 1} : ${e.question}
Réponse du candidat : ${(e.answer || '').slice(0, 4000) || '(aucune réponse donnée)'}`).join('\n')}`;

  try {
    const data = await callClaude({ system, user, maxTokens: 3000 });
    const parsed = extractJson(data);
    if (!parsed?.reviews) throw new Error('Réponse du modèle inexploitable.');
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('feedback:', e);
    return res.status(502).json({ error: "Le correcteur n'a pas répondu." });
  }
}
