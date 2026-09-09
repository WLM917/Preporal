/* ═══════════════════════════════════════════════════════════
   config.js — réglages produit et catalogue des épreuves
   Aucune clé secrète ici : ce fichier part dans le navigateur.
   ═══════════════════════════════════════════════════════════ */

const ENV = window.PREPORAL_ENV || {};

/* Une URL Supabase avec une barre oblique finale casse la construction
   des URL du client : on la retire systématiquement. */
const sansBarreFinale = (u = '') => String(u).trim().replace(/\/+$/, '');

export const CONFIG = {
  api: ENV.API_BASE || '/api',
  /* Renseignés dans le bloc window.PREPORAL_ENV d'index.html.
     Ces deux valeurs sont publiques par conception (la clé « anon »
     part de toute façon dans le navigateur et n'ouvre que ce que les
     règles RLS autorisent). La clé service_role, elle, reste côté
     serveur — voir .env.example. */
  supabase: {
    url: sansBarreFinale(ENV.SUPABASE_URL),
    anonKey: (ENV.SUPABASE_ANON_KEY || '').trim()
  },
  simulationsGratuites: 2,
  cles: {
    quota: 'prepOral.simulationsUtilisees',
    historique: 'prepOral.historique',
    avis: 'prepOral.avis',
    premiumLocal: 'prepOral.premiumLocal'
  },

  /* ── Identité de l'éditeur ────────────────────────────────
     Obligatoire avant toute vente en France (mentions légales,
     CGV, médiateur de la consommation). Renseignez ce bloc dans
     index.html : tant qu'il est vide, un bandeau d'avertissement
     s'affiche et les textes légaux signalent ce qui manque. */
  editeur: {
    nom: ENV.EDITEUR_NOM || '',
    statut: ENV.EDITEUR_STATUT || '',
    siret: ENV.EDITEUR_SIRET || '',
    tva: ENV.EDITEUR_TVA || '',
    adresse: ENV.EDITEUR_ADRESSE || '',
    email: ENV.EDITEUR_EMAIL || '',
    directeur: ENV.EDITEUR_DIRECTEUR || '',
    mediateur: ENV.EDITEUR_MEDIATEUR || ''
  },

  /* Âge minimal pour souscrire seul (art. 1145 s. du code civil :
     un mineur ne peut pas s'engager seul dans un abonnement payant). */
  ageMinimumAchat: 18
};

/** true quand toutes les mentions obligatoires sont renseignées. */
export const editeurComplet = () =>
  Object.values(CONFIG.editeur).every(v => String(v).trim().length > 0);

export const OFFRES = {
  mensuel: { id: 'mensuel', nom: 'PrepOral Premium', prix: '9,99 €', periode: 'par mois', mode: 'subscription' },
  pass48:  { id: 'pass48',  nom: 'Pass 48 heures',   prix: '4,99 €', periode: 'une fois',  mode: 'payment' }
};

/* ─────────────────────────────────────────────────────────────
   Catalogue des épreuves.
   champA / champB pilotent les deux zones de dépôt de l'accueil.
   consigne est transmis au modèle côté serveur.
   ───────────────────────────────────────────────────────────── */
export const TYPES_ORAL = [
  {
    id: 'entretien',
    nom: "Entretien d'embauche ou de stage",
    court: 'Entretien / Stage',
    emoji: '💼',
    duree: 120,
    champA: { label: 'Votre CV', aide: 'Parcours, missions, résultats', placeholder: 'Collez ou importez votre CV…', min: 200 },
    champB: { label: "L'offre d'emploi", aide: 'Intitulé, missions, profil recherché', placeholder: "Collez l'annonce complète…", min: 150 },
    criteres: ['Structure de la réponse', "Lien avec l'offre", 'Preuves et chiffres', 'Concision'],
    categories: ['Parcours', 'Motivation', 'Compétences', 'Mise en situation', 'Recul', 'Projection'],
    consigne: "Tu es un recruteur expérimenté qui fait passer un entretien d'embauche ou de stage en France."
  },
  {
    id: 'grand-oral',
    nom: 'Grand Oral du baccalauréat',
    court: 'Grand Oral',
    emoji: '🎓',
    duree: 300,
    champA: { label: 'Votre question de Grand Oral', aide: 'La question retenue et sa problématique', placeholder: 'Ex. « Dans quelle mesure la dette publique contraint-elle… »', min: 80 },
    champB: { label: 'Vos notes ou votre plan', aide: 'Plan détaillé, arguments, exemples, lien au projet', placeholder: 'Collez ou importez votre plan, vos fiches…', min: 200 },
    criteres: ['Maîtrise du sujet', 'Qualité de l\'argumentation', 'Prise de recul et projet', 'Expression et conviction'],
    categories: ['Sujet', 'Argumentation', 'Contre-argument', 'Lien au projet', 'Ouverture'],
    consigne: "Tu es examinateur du Grand Oral du baccalauréat français. Tu interroges sur la question préparée, puis tu élargis au projet d'orientation, selon la grille officielle."
  },
  {
    id: 'brevet',
    nom: 'Oral du brevet (soutenance de stage ou de projet)',
    court: 'Brevet / 3e',
    emoji: '📗',
    duree: 300,
    champA: { label: 'Votre sujet de soutenance', aide: 'Stage, parcours avenir, EPI, projet artistique', placeholder: 'Ex. « Mon stage de 3e chez un cabinet d\'expertise comptable »', min: 60 },
    champB: { label: 'Ce que vous voulez raconter', aide: 'Déroulé, métiers observés, ce que vous en retenez', placeholder: 'Vos notes, votre diaporama, votre rapport…', min: 150 },
    criteres: ['Clarté de la présentation', 'Richesse du contenu', 'Réponses aux questions', 'Expression orale'],
    categories: ['Présentation', 'Découverte', 'Analyse', 'Orientation'],
    consigne: "Tu es membre du jury de l'oral du diplôme national du brevet. Tu interroges un élève de 3e avec bienveillance mais exigence, dans un vocabulaire adapté à son âge."
  },
  {
    id: 'concours',
    nom: 'Entretien de motivation, concours ou grande école',
    court: 'Concours / École',
    emoji: '🏛️',
    duree: 180,
    champA: { label: 'Votre CV ou votre parcours', aide: 'Formation, expériences, engagements', placeholder: 'Collez ou importez votre CV…', min: 150 },
    champB: { label: "L'école, le concours ou le poste visé", aide: 'Programme, valeurs, attendus du jury', placeholder: "Descriptif de l'école, de la filière, du concours…", min: 120 },
    criteres: ['Cohérence du projet', 'Connaissance de l\'école', 'Culture générale et actualité', 'Posture et assurance'],
    categories: ['Motivation', 'Personnalité', 'Culture générale', 'Actualité', 'Mise en situation'],
    consigne: "Tu es membre d'un jury d'admission de grande école ou de concours français. Tu challenges la cohérence du projet et la culture générale du candidat."
  },
  {
    id: 'pitch',
    nom: 'Présentation ou pitch de projet',
    court: 'Pitch / Présentation',
    emoji: '🚀',
    duree: 120,
    champA: { label: 'Votre projet', aide: 'Problème résolu, solution, marché, modèle', placeholder: 'Décrivez votre projet, votre produit, votre startup…', min: 150 },
    champB: { label: 'Votre audience', aide: 'Jury, investisseurs, client, professeurs', placeholder: 'À qui présentez-vous, et qu\'attendent-ils ?', min: 60 },
    criteres: ['Clarté du problème', 'Solidité du modèle', 'Impact du storytelling', 'Réponses aux objections'],
    categories: ['Problème', 'Solution', 'Marché', 'Modèle économique', 'Objection'],
    consigne: "Tu es un jury d'investisseurs et d'experts qui écoute un pitch de projet. Tu poses des questions courtes, concrètes et exigeantes."
  },
  {
    id: 'matiere',
    nom: 'Oral de matière scolaire',
    court: 'Oral de matière',
    emoji: '📚',
    duree: 180,
    sousChoix: {
      label: 'Matière',
      options: ['Histoire-géographie', 'Français', 'Mathématiques', 'SES / économie', 'Physique-chimie', 'SVT', 'Philosophie', 'Espagnol', 'Allemand', 'Droit', 'Autre']
    },
    champA: { label: 'Le sujet ou le chapitre', aide: 'Ce sur quoi vous serez interrogé', placeholder: 'Ex. « La Guerre froide 1947-1991 »', min: 40 },
    champB: { label: 'Votre cours ou vos fiches', aide: 'Le contenu que vous devez maîtriser', placeholder: 'Collez ou importez votre cours, vos fiches de révision…', min: 200 },
    criteres: ['Exactitude des connaissances', 'Structure de la réponse', 'Vocabulaire de la matière', 'Exemples mobilisés'],
    categories: ['Définition', 'Connaissances', 'Analyse', 'Exemple', 'Approfondissement'],
    consigne: "Tu es professeur et tu interroges un élève à l'oral sur son cours. Tu vérifies les connaissances précises, le vocabulaire de la discipline et la capacité à illustrer."
  },
  {
    id: 'langue',
    nom: 'Certification de langue (TOEIC, TOEFL, IELTS…)',
    court: 'Oral de langue',
    emoji: '🌍',
    duree: 120,
    sousChoix: {
      label: 'Certification',
      options: ['TOEIC Speaking', 'TOEFL iBT Speaking', 'IELTS Speaking', 'Cambridge B2 First', 'Cambridge C1 Advanced', 'DELE (espagnol)', 'Goethe-Zertifikat (allemand)', 'Autre']
    },
    champA: { label: 'Votre niveau et votre objectif', aide: 'Niveau actuel, score visé, échéance', placeholder: 'Ex. « B1 solide, je vise 850 au TOEIC en mars »', min: 40 },
    champB: { label: 'Thèmes à travailler', aide: 'Sujets de l\'épreuve, vocabulaire à réviser', placeholder: 'Travail, études, environnement, technologies…', min: 40 },
    criteres: ['Fluidité', 'Grammaire et structures', 'Richesse lexicale', 'Prononciation et intonation'],
    categories: ['Question personnelle', 'Description', 'Opinion', 'Argumentation', 'Situation'],
    consigne: "Tu es examinateur d'une certification de langue. Tu poses les questions DANS LA LANGUE DE L'ÉPREUVE, au format officiel, puis tu évalues selon les descripteurs du CECRL."
  }
];

export const typeParId = id => TYPES_ORAL.find(t => t.id === id) || TYPES_ORAL[0];
