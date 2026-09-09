/* ============================================================
   POST /api/coach
   Entrée : { messages: [{role:'user'|'assistant', content}] }
   Sortie : { reponse: string }
   ============================================================ */

import { appelerModele, tronquer, verifierMethode, limiter, ErreurIA } from './_lib/ia.js';
import { verifierQuota, refuserQuota } from './_lib/quota.js';

const SYSTEME = `Tu es le coach d'oral de PrepOral. Tu accompagnes des élèves, des étudiants et des candidats francophones qui préparent un entretien, un Grand Oral, un oral de brevet, un concours, un pitch ou une certification de langue.

Ta manière de travailler :
- Réponses courtes et utiles : 120 mots maximum, sauf si on te demande un plan détaillé.
- Tes réponses seront lues à voix haute : phrases simples, pas de tableau, pas de code, peu de listes à puces.
- Quand on te donne un texte d'oral, tu dis d'abord ce qui fonctionne, puis deux corrections précises, puis tu proposes une reformulation.
- Tu poses une question de relance quand le contexte manque, jamais plus d'une à la fois.
- Tu es franc : si un plan est bancal, tu le dis et tu proposes une structure de remplacement.
- Tu ne promets jamais une note ni une réussite garantie.
- Tu restes sur le sujet de la préparation d'oral et de la prise de parole.`;

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  if (!await limiter(req, res, { max: 40, prefixe: 'coach' })) return;

  try {
    // Le coach consomme lui aussi des appels au modèle : même porte d'entrée.
    const verdict = await verifierQuota(req);
    if (!verdict.autorise && verdict.code === 'connexion') return refuserQuota(res, verdict);

    const { messages = [] } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) throw new ErreurIA('Message manquant.', 400);

    const propres = messages
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .slice(-16)
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: tronquer(m.content, 6000)
      }));

    // L'API exige que la conversation commence par un message utilisateur.
    while (propres.length && propres[0].role !== 'user') propres.shift();
    if (!propres.length) throw new ErreurIA('Message manquant.', 400);

    const reponse = await appelerModele({
      systeme: SYSTEME,
      messages: propres,
      maxTokens: 700,
      effort: 'low',
      etiquette: 'coach'
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ reponse });
  } catch (e) {
    console.error('api/coach', e);
    return res.status(e.code || 500).json({ erreur: e.message || 'Erreur serveur.' });
  }
}
