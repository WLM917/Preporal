/* ============================================================
   POST /api/coach
   Entrée : { messages: [{role:'user'|'assistant', content}] }
   Sortie : { reponse: string }
   ============================================================ */

import { appelerModele, tronquer, verifierMethode, limiter, ErreurIA } from './_lib/ia.js';
import { verifierQuotaCoach, consommerQuotaCoach, refuserQuota } from './_lib/quota.js';
import { blocsDePieces, resumerPieces } from './_lib/pieces.js';

const SYSTEME = `Tu es le coach d'oral de Oralixia. Tu accompagnes des élèves, des étudiants et des candidats francophones qui préparent un entretien, un Grand Oral, un oral de brevet, un concours, un pitch ou une certification de langue.

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
    /* Le coach s'essaie avant de s'acheter : quelques échanges par jour
       hors abonnement, illimité pour les abonnés. Sans compte, rien —
       sinon le quota se remet à zéro en vidant son navigateur. */
    const verdict = await verifierQuotaCoach(req);
    if (!verdict.autorise) return refuserQuota(res, verdict);

    const { messages = [], langue = 'fr', pieces = [] } = req.body || {};
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

    /* Les pièces jointes accompagnent le dernier message. Elles se
       placent AVANT son texte : le modèle lit d'abord le document, puis
       la question posée dessus.

       Seul le dernier tour les porte. L'historique reste en texte : on
       ne renvoie pas un PDF de deux mégaoctets à chaque échange. */
    const blocs = blocsDePieces(pieces);
    if (blocs.length) {
      const dernier = propres[propres.length - 1];
      dernier.content = [...blocs, { type: 'text', text: dernier.content }];
    }

    /* La langue d'interface pilote la langue des réponses : un
       utilisateur qui a mis le site en anglais ne doit pas recevoir
       une correction en français. */
    const LANGUES = { fr: 'français', en: 'anglais', es: 'espagnol' };
    const nom = LANGUES[langue] || LANGUES.fr;
    const systeme = SYSTEME + `\n\nRéponds intégralement en ${nom}, quelle que soit la langue de la question.`;

    const reponse = await appelerModele({
      systeme,
      messages: propres,
      /* Un document joint demande une lecture attentive : on ne lit pas
         un sujet de Grand Oral au même effort qu'une question de deux
         lignes, et la réponse a besoin de place pour l'analyser. */
      maxTokens: blocs.length ? 1600 : 700,
      effort: blocs.length ? 'medium' : 'low',
      etiquette: blocs.length ? 'coach+pieces' : 'coach'
    });

    if (blocs.length) console.log('[pieces]', resumerPieces(pieces));

    // Décompté seulement maintenant : une panne du modèle ne coûte pas
    // un échange au candidat.
    await consommerQuotaCoach(verdict);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      reponse,
      restant: verdict.premium ? null : Math.max(0, (verdict.restant || 1) - 1)
    });
  } catch (e) {
    console.error('api/coach', e);
    return res.status(e.code || 500).json({ erreur: e.message || 'Erreur serveur.' });
  }
}
