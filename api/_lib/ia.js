/*
  api/_lib/ia.js — appel au modèle, côté serveur uniquement.
  La clé API ne quitte jamais le serveur.
*/

import Anthropic from '@anthropic-ai/sdk';

/* claude-opus-5 par défaut. Surchargez MODELE_IA pour arbitrer le coût :
   claude-sonnet-5 coûte environ 2,5 fois moins cher en entrée comme en
   sortie, pour un travail de correction qui reste bon. Mesurez avant de
   trancher — voir la section « Coût par simulation » du README. */
const MODELE = process.env.MODELE_IA || 'claude-opus-5';

export class ErreurIA extends Error {
  constructor(message, code = 502) { super(message); this.code = code; }
}

/* Tarifs publics en dollars par million de jetons, au 2026-06.
   Vérifiez-les avant de vous appuyer sur les montants journalisés :
   ils servent d'ordre de grandeur, pas de facturation. */
const TARIFS = {
  'claude-opus-5':   { entree: 5.00, sortie: 25.00 },
  'claude-sonnet-5': { entree: 2.00, sortie: 10.00 },
  'claude-haiku-4-5': { entree: 1.00, sortie: 5.00 }
};

/** Coût estimé d'un appel, en dollars. */
export function estimerCout(modele, usage = {}) {
  const t = TARIFS[modele];
  if (!t) return null;
  const entree = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const sortie = usage.output_tokens || 0;
  return (entree / 1e6) * t.entree + (sortie / 1e6) * t.sortie;
}

/* Cumul par instance : donne un ordre de grandeur dans les journaux
   sans dépendre d'un service externe. Remis à zéro au démarrage à
   froid — pour un suivi fiable, agrégez les lignes « [cout] ». */
const cumul = { appels: 0, dollars: 0 };
export const coutCumule = () => ({ ...cumul });

let client = null;
function clientIA() {
  if (client) return client;
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ErreurIA("Clé ANTHROPIC_API_KEY absente côté serveur.", 500);
  // Le SDK réessaie tout seul les 429 et les 5xx.
  client = new Anthropic({ apiKey: cle, maxRetries: 3, timeout: 120_000 });
  return client;
}

/**
 * Appelle le modèle et renvoie le texte concaténé.
 *
 * @param {object}  o
 * @param {string}  o.systeme    consigne système
 * @param {Array}   o.messages   [{ role:'user'|'assistant', content:string }]
 * @param {number}  o.maxTokens
 * @param {'low'|'medium'|'high'} [o.effort]  profondeur de réflexion et dépense
 * @param {object}  [o.schema]   schéma JSON attendu — garantit une sortie valide
 * @param {string}  [o.etiquette] nom de la route, pour la journalisation du coût
 * @returns {Promise<string>}
 */
export async function appelerModele({ systeme, messages, maxTokens = 1600, effort = 'low', schema = null, etiquette = 'inconnu' }) {
  const outputConfig = { effort };
  if (schema) outputConfig.format = { type: 'json_schema', schema };

  try {
    /* Pas de `temperature` : les modèles actuels la refusent (erreur 400).
       La variabilité se règle par la consigne et par `effort`. */
    const reponse = await clientIA().messages.create({
      model: MODELE,
      max_tokens: maxTokens,
      system: systeme,
      messages,
      output_config: outputConfig
    });

    /* Coût mesuré, pas estimé au doigt mouillé : le README demande de
       connaître le coût par simulation avant d'arrêter le prix. Chaque
       simulation vaut deux appels (questions puis correction). */
    const usage = reponse.usage || {};
    const dollars = estimerCout(MODELE, usage);
    if (dollars !== null) { cumul.appels++; cumul.dollars += dollars; }
    console.log('[cout]', JSON.stringify({
      route: etiquette,
      modele: MODELE,
      effort,
      jetons_entree: usage.input_tokens || 0,
      jetons_cache: usage.cache_read_input_tokens || 0,
      jetons_sortie: usage.output_tokens || 0,
      dollars: dollars === null ? null : Number(dollars.toFixed(5)),
      cumul_appels: cumul.appels,
      cumul_dollars: Number(cumul.dollars.toFixed(4))
    }));

    // Un refus renvoie un HTTP 200 : il faut le tester avant de lire le contenu.
    if (reponse.stop_reason === 'refusal') {
      throw new ErreurIA("Le modèle a décliné cette demande. Reformulez votre document.", 422);
    }

    return (reponse.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

  } catch (e) {
    if (e instanceof ErreurIA) throw e;
    if (e instanceof Anthropic.RateLimitError) {
      throw new ErreurIA('Service momentanément saturé, réessayez dans un instant.', 429);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      throw new ErreurIA('Configuration du modèle invalide côté serveur.', 500);
    }
    if (e instanceof Anthropic.APIError) {
      throw new ErreurIA(`Modèle indisponible (${e.status}).`, 502);
    }
    throw new ErreurIA('Modèle injoignable.', 502);
  }
}

/** Extrait un objet JSON même si le modèle l'a entouré de texte ou de balises.
    Avec `schema`, la sortie est déjà du JSON valide ; ce filet reste utile
    pour les appels qui n'imposent pas de schéma. */
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
  String(txt).slice(0, max) + (String(txt).length > max ? '\n[...document tronqué...]' : '');

/** Bornes d'entrée communes à toutes les routes. */
export function verifierMethode(req, res, methode = 'POST') {
  if (req.method !== methode) {
    res.status(405).json({ erreur: 'Méthode non autorisée.' });
    return false;
  }
  return true;
}

/* ── Limitation de débit ───────────────────────────────────────
   Avec UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN, le
   compteur est partagé entre toutes les instances. Sans ces clés,
   on retombe sur un compteur en mémoire : utile en local, mais il
   se remet à zéro à chaque démarrage à froid et ne protège pas
   réellement en production.
   ──────────────────────────────────────────────────────────── */
const compteurs = new Map();

export const ipDe = req =>
  (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'inconnu').split(',')[0].trim();

async function limiterRedis(cle, max, fenetreSecondes) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const jeton = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !jeton) return null;

  try {
    // INCR puis EXPIRE au premier passage : fenêtre glissante par tranche.
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
      body: JSON.stringify([['INCR', cle], ['EXPIRE', cle, fenetreSecondes, 'NX']])
    });
    if (!r.ok) return null;
    const [incr] = await r.json();
    return Number(incr?.result) <= max;
  } catch {
    return null;   // Redis injoignable : on ne bloque pas le service
  }
}

export async function limiter(req, res, { max = 30, fenetreMs = 60_000, prefixe = 'ia' } = {}) {
  const ip = ipDe(req);
  const cle = `debit:${prefixe}:${ip}`;

  const viaRedis = await limiterRedis(cle, max, Math.ceil(fenetreMs / 1000));
  if (viaRedis !== null) {
    if (!viaRedis) { res.status(429).json({ erreur: 'Trop de requêtes, réessayez dans une minute.' }); return false; }
    return true;
  }

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
