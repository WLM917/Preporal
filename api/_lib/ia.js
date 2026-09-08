/* ═══════════════════════════════════════════════════════════
   api/_lib/ia.js — appel au modèle, côté serveur uniquement.
   La clé API ne quitte jamais le serveur.
   ═══════════════════════════════════════════════════════════ */

const URL_API = 'https://api.anthropic.com/v1/messages';
const MODELE = process.env.MODELE_IA || 'claude-3-5-sonnet-20240620';

export class ErreurIA extends Error {
  constructor(message, code = 502) { super(message); this.code = code; }
}

/**
 * @param {object} o
 * @param {string} o.systeme      consigne système
 * @param {Array}  o.messages     [{role:'user'|'assistant', content:string}]
 * @param {number} o.maxTokens
 * @returns {Promise<string>} texte concaténé de la réponse
 */
export async function appelerModele({ systeme, messages, maxTokens = 1600, temperature = 0.7 }) {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ErreurIA("Clé ANTHROPIC_API_KEY absente côté serveur.", 500);

  const reponse = await fetch(URL_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODELE, max_tokens: maxTokens, temperature, system: systeme, messages })
  });

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    throw new ErreurIA(`Modèle indisponible (${reponse.status}). ${detail.slice(0, 200)}`, 502);
  }

  const data = await reponse.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

/** Extrait un objet JSON même si le modèle l'a entouré de texte ou de balises. */
export function extraireJSON(texte) {
  if (!texte) throw new ErreurIA('Réponse vide du modèle.');
  const nettoye = texte.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  try { return JSON.parse(nettoye); } catch {}
  const debut = nettoye.indexOf('{'), fin = nettoye.lastIndexOf('}');
  if (debut !== -1 && fin > debut) {
    try { return JSON.parse(nettoye.slice(debut, fin + 1)); } catch {}
  }
  throw new ErreurIA('Réponse du modèle illisible.');
}

/** Coupe les documents utilisateur pour maîtriser le coût par appel. */
export const tronquer = (txt = '', max = 6000) =>
  String(txt).slice(0, max) + (String(txt).length > max ? '\n[…document tronqué…]' : '');

/** Bornes d'entrée communes à toutes les routes. */
export function verifierMethode(req, res, methode = 'POST') {
  if (req.method !== methode) {
    res.status(405).json({ erreur: 'Méthode non autorisée.' });
    return false;
  }
  return true;
}

/* ── Limitation de débit très simple (mémoire de l'instance) ──
   Pour une vraie protection multi-instances, branchez Upstash
   Redis ou le rate limiting de Vercel.                        */
const compteurs = new Map();
export function limiter(req, res, { max = 30, fenetreMs = 60_000 } = {}) {
  const ip = (req.headers['x-forwarded-for'] || 'inconnu').split(',')[0].trim();
  const maintenant = Date.now();
  const entree = compteurs.get(ip) || { debut: maintenant, n: 0 };
  if (maintenant - entree.debut > fenetreMs) { entree.debut = maintenant; entree.n = 0; }
  entree.n++;
  compteurs.set(ip, entree);
  if (entree.n > max) {
    res.status(429).json({ erreur: 'Trop de requêtes, réessayez dans une minute.' });
    return false;
  }
  return true;
}
