// api/questions.js — Vercel Serverless Function (Node.js)
// Génère 5 questions d'entretien à partir du CV + de l'offre.
// La clé API reste ici, côté serveur. Elle n'est jamais envoyée au navigateur.

const MODEL = 'claude-sonnet-5';          // remplaçable par un autre modèle
const MAX_CHARS = 12000;                   // garde-fou coût / abus

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const { cv = '', offer = '', lang = 'français' } = req.body || {};
  if (cv.length < 200 || offer.length < 150) {
    return res.status(400).json({ error: 'CV ou offre trop court.' });
  }

  const system = `Tu es un recruteur expérimenté qui prépare une grille d'entretien.
Tu reçois un CV et une offre d'emploi. Tu produis exactement 5 questions que ce
recruteur poserait réellement à ce candidat pour ce poste précis.

Règles :
- Chaque question s'appuie sur un élément nommé du CV ou de l'offre (une entreprise,
  un projet, un outil, une mission, un trou dans le parcours, un écart entre profil
  et exigences). Aucune question générique du type "Parlez-moi de vous".
- Couvre : 1 question de parcours, 2 questions comportementales sur des situations
  vécues, 1 question technique ou métier liée aux missions de l'offre, 1 question
  difficile sur une faiblesse ou un écart apparent.
- Les questions sont rédigées en ${lang}.
- Pour chaque question, explique en une phrase ce que le recruteur cherche à vérifier.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises de code :
{"questions":[{"question":"...","why":"..."}]}`;

  const user = `CV DU CANDIDAT :
"""
${cv.slice(0, MAX_CHARS)}
"""

OFFRE D'EMPLOI :
"""
${offer.slice(0, MAX_CHARS)}
"""`;

  try {
    const data = await callClaude({ system, user, maxTokens: 1200 });
    const parsed = extractJson(data);
    if (!parsed?.questions?.length) throw new Error('Réponse du modèle inexploitable.');
    return res.status(200).json({ questions: parsed.questions.slice(0, 5) });
  } catch (e) {
    console.error('questions:', e);
    return res.status(502).json({ error: "Le générateur de questions n'a pas répondu." });
  }
}

/* ---------- appel du modèle ---------- */
export async function callClaude({ system, user, maxTokens }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  const json = await r.json();
  return json.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

/* ---------- extraction JSON tolérante ---------- */
export function extractJson(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}
