/* ═══════════════════════════════════════════════════════════
   POST /api/feedback
   Entrée : { typeId, sousChoix, champA, champB, questions,
              reponses, mesures }
   Sortie : { global, criteres, details[], eloquence }
   ═══════════════════════════════════════════════════════════ */

import { appelerModele, extraireJSON, tronquer, verifierMethode, limiter, ErreurIA } from './_lib/ia.js';
import { verifierQuota, refuserQuota } from './_lib/quota.js';

const CRITERES = {
  entretien: ['Structure de la réponse', "Lien avec l'offre", 'Preuves et chiffres', 'Concision'],
  'grand-oral': ['Maîtrise du sujet', "Qualité de l'argumentation", 'Prise de recul et projet', 'Expression et conviction'],
  brevet: ['Clarté de la présentation', 'Richesse du contenu', 'Réponses aux questions', 'Expression orale'],
  concours: ['Cohérence du projet', "Connaissance de l'école", 'Culture générale', 'Posture et assurance'],
  pitch: ['Clarté du problème', 'Solidité du modèle', 'Impact du storytelling', 'Réponses aux objections'],
  matiere: ['Exactitude des connaissances', 'Structure de la réponse', 'Vocabulaire de la matière', 'Exemples mobilisés'],
  langue: ['Fluidité', 'Grammaire et structures', 'Richesse lexicale', 'Prononciation et intonation']
};

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  if (!await limiter(req, res, { max: 20, prefixe: 'feedback' })) return;

  try {
    /* On revérifie l'accès sans re-décompter : le quota a déjà été
       consommé par /api/questions au lancement de la simulation. */
    const verdict = await verifierQuota(req);
    if (!verdict.autorise && verdict.code === 'connexion') return refuserQuota(res, verdict);

    const { typeId = 'entretien', sousChoix = '', champA = '', champB = '', reponses = [], mesures = {} } = req.body || {};
    if (!Array.isArray(reponses) || !reponses.length) throw new ErreurIA('Aucune réponse à corriger.', 400);

    const criteres = CRITERES[typeId] || CRITERES.entretien;

    const systeme = `Tu es un coach d'oral français, exigeant et utile. Tu corriges la prestation d'un candidat.

Épreuve : ${typeId}${sousChoix ? ' — ' + sousChoix : ''}.

Principes de correction :
- Sois franc : une réponse creuse reçoit une note basse. Ne félicite pas par politesse.
- Chaque axe d'amélioration est ACTIONNABLE : dis quoi changer, pas seulement ce qui ne va pas.
- Pour chaque réponse, propose une réécriture courte (3 à 4 phrases) de ce que le candidat aurait pu dire de mieux.
- Le texte évalué est une retranscription orale : ignore la ponctuation et l'orthographe, juge le fond, la structure et la clarté.
- Vouvoiement, français clair, aucune formule creuse.

Mesures objectives déjà calculées (à intégrer dans ton appréciation, ne les recalcule pas) :
${JSON.stringify(mesures)}

Réponds UNIQUEMENT par un JSON valide, sans texte autour :
{
  "global": <entier 0-100>,
  "criteres": { ${criteres.map(c => `"${c}": <entier 0-100>`).join(', ')} },
  "details": [ { "note": <entier 0-20>, "forts": ["…"], "axes": ["…"], "reecriture": "…" } ],
  "eloquence": { "conseils": ["…", "…"] }
}
Le tableau "details" contient exactement ${reponses.length} entrées, dans l'ordre des questions.`;

    const corpus = reponses.map((r, i) =>
      `QUESTION ${i + 1} (${r.categorie || '—'}) : ${r.question}
RÉPONSE : ${r.texte ? tronquer(r.texte, 2500) : '(le candidat a passé cette question)'}
Temps de parole : ${r.dureeParole || 0} s`).join('\n\n');

    const message = `CONTEXTE DU CANDIDAT :
${tronquer(champA, 3000) || '(non fourni)'}

SUJET / OFFRE :
${tronquer(champB, 3000) || '(non fourni)'}

PRESTATION :
${corpus}

Corrige cette prestation.`;

    /* Schéma construit à partir des critères de l'épreuve : la
       correction revient toujours dans une forme exploitable. */
    const proprietesCriteres = {};
    criteres.forEach(c => { proprietesCriteres[c] = { type: 'integer', minimum: 0, maximum: 100 }; });

    const schema = {
      type: 'object',
      properties: {
        global: { type: 'integer', minimum: 0, maximum: 100 },
        criteres: {
          type: 'object',
          properties: proprietesCriteres,
          required: criteres,
          additionalProperties: false
        },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              note: { type: 'integer', minimum: 0, maximum: 20 },
              forts: { type: 'array', items: { type: 'string' } },
              axes: { type: 'array', items: { type: 'string' } },
              reecriture: { type: 'string' }
            },
            required: ['note', 'forts', 'axes', 'reecriture'],
            additionalProperties: false
          }
        },
        eloquence: {
          type: 'object',
          properties: { conseils: { type: 'array', items: { type: 'string' } } },
          required: ['conseils'],
          additionalProperties: false
        }
      },
      required: ['global', 'criteres', 'details', 'eloquence'],
      additionalProperties: false
    };

    const brut = await appelerModele({
      systeme,
      messages: [{ role: 'user', content: message }],
      maxTokens: 2600,
      effort: 'medium',        // la correction demande du jugement, pas la génération de questions
      etiquette: 'feedback',
      schema
    });

    const data = extraireJSON(brut);

    // Normalisation défensive : le front ne doit jamais recevoir de valeur aberrante.
    const borne = (v, min, max, defaut) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : defaut;
    };

    const sortie = {
      global: borne(data.global, 0, 100, 50),
      criteres: {},
      details: [],
      eloquence: { conseils: Array.isArray(data.eloquence?.conseils) ? data.eloquence.conseils.slice(0, 6) : [] }
    };

    criteres.forEach(c => { sortie.criteres[c] = borne(data.criteres?.[c], 0, 100, sortie.global); });

    for (let i = 0; i < reponses.length; i++) {
      const d = (data.details || [])[i] || {};
      sortie.details.push({
        note: borne(d.note, 0, 20, 10),
        forts: (Array.isArray(d.forts) ? d.forts : []).slice(0, 4).map(String),
        axes: (Array.isArray(d.axes) ? d.axes : []).slice(0, 4).map(String),
        reecriture: typeof d.reecriture === 'string' ? d.reecriture.slice(0, 900) : ''
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(sortie);
  } catch (e) {
    console.error('api/feedback', e);
    return res.status(e.code || 500).json({ erreur: e.message || 'Erreur serveur.' });
  }
}
