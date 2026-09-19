/* ═══════════════════════════════════════════════════════════
   legal.js — mentions légales, CGV, RGPD, cookies
   ⚠️ MODÈLE À COMPLÉTER. Les mentions entre crochets sont
   obligatoires et doivent être renseignées avant la mise en
   vente. Faites relire par un juriste : ces textes n'ont pas
   valeur de conseil juridique.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, OFFRES, editeurComplet } from './config.js';
import { $, $$, ouvrirModale, echappe } from './ui.js';
import { t, langue, surChangementLangue } from './i18n.js';

/* Les mentions manquantes sont signalées en clair plutôt que
   remplacées par un texte vraisemblable : une mention légale
   inventée est pire que l'absence de mention. */
const E = '<span class="rounded bg-amber/15 px-1.5 py-0.5 text-amber">[À COMPLÉTER]</span>';
const ou = v => (String(v || '').trim() ? echappe(String(v).trim()) : E);

export const EDITEUR = {
  nom: ou(CONFIG.editeur.nom),
  statut: ou(CONFIG.editeur.statut),
  siret: ou(CONFIG.editeur.siret),
  tva: ou(CONFIG.editeur.tva),
  adresse: ou(CONFIG.editeur.adresse),
  email: ou(CONFIG.editeur.email),
  directeur: ou(CONFIG.editeur.directeur),
  mediateur: ou(CONFIG.editeur.mediateur),
  hebergeur: 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis',
  hebergeurDonnees: 'Supabase (région UE) — base de données et authentification',
  paiement: 'Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irlande'
};

const bloc = (titre, corps) => `<h3 class="mt-6 font-display text-base font-bold text-soft first:mt-0">${titre}</h3><div class="mt-2 space-y-2">${corps}</div>`;

/* Un paragraphe traduit : la clé, puis le français, qui sert de
   repli et reste la version de référence. */
const pa = (cle, fr) => `<p>${t('legal.' + cle, fr)}</p>`;

/* Le contrat est soumis au droit français et les textes visent des
   articles du code français : une traduction aide à comprendre, elle
   ne remplace pas l'original. On le dit, plutôt que de laisser croire
   à deux versions également opposables. */
const avertissementTraduction = () => langue() === 'fr' ? '' :
  `<p class="rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs leading-relaxed text-amber">${
    t('legal.version_fr_fait_foi',
      'Traduction fournie à titre informatif. Seule la version française fait foi : le contrat est soumis au droit français.')}</p>`;

/* Une fonction, pas une constante : les traductions arrivent après
   le chargement du module, un objet figé resterait en français. */
export const textes = () => ({
  mentions: {
    titre: t('legal.mentions.titre', 'Mentions légales'),
    contenu: `
      ${avertissementTraduction()}
      ${bloc(t('legal.mentions.editeur', 'Éditeur du site'), `
        <p>${EDITEUR.nom} — ${EDITEUR.statut}<br>${t('legal.mentions.siege', 'Siège')} : ${EDITEUR.adresse}<br>SIRET : ${EDITEUR.siret} · ${t('legal.mentions.tva', 'TVA')} : ${EDITEUR.tva}<br>${t('legal.mentions.contact', 'Contact')} : ${EDITEUR.email}</p>
        <p>${t('legal.mentions.directeur', 'Directeur de la publication')} : ${EDITEUR.directeur}</p>`)}
      ${bloc(t('legal.mentions.hebergement', 'Hébergement'), `<p>${EDITEUR.hebergeur}</p><p>${EDITEUR.hebergeurDonnees}</p>`)}
      ${bloc(t('legal.mentions.paiement', 'Paiement'), `<p>${t('legal.mentions.paiement_corps', 'Les paiements sont opérés par {p}. Aucune donnée de carte bancaire ne transite ni n\'est stockée sur les serveurs de Oralixia.').replace('{p}', EDITEUR.paiement)}</p>`)}
      ${bloc(t('legal.mentions.pi', 'Propriété intellectuelle'), pa('mentions.pi_corps', "L'ensemble des éléments du site (marque, logo, interface, textes, code) est protégé. Toute reproduction sans autorisation écrite est interdite. Les contenus que vous déposez restent votre propriété."))}
      ${bloc(t('legal.mentions.limites', 'Limites du service'), pa('mentions.limites_corps', "Oralixia est un outil d'entraînement assisté par intelligence artificielle. Les questions, notes et conseils sont générés automatiquement, peuvent comporter des erreurs et ne constituent ni une évaluation officielle, ni une garantie de réussite à un examen, un concours ou un entretien."))}
      ${bloc(t('legal.mentions.mediation', 'Médiation de la consommation'), `<p>${t('legal.mentions.mediation_corps', 'En cas de litige non résolu, le consommateur peut saisir gratuitement un médiateur de la consommation : {m}. Plateforme européenne de règlement en ligne des litiges : ec.europa.eu/consumers/odr.').replace('{m}', EDITEUR.mediateur)}</p>`)}
    `
  },

  cgv: {
    titre: t('legal.cgv.titre', 'Conditions générales de vente'),
    contenu: `
      ${avertissementTraduction()}
      ${bloc(t('legal.cgv.1', '1. Objet'), `<p>${t('legal.cgv.1_corps', "Les présentes conditions régissent la vente des abonnements et accès payants à Oralixia, service d'entraînement aux oraux édité par {n}.").replace('{n}', EDITEUR.nom)}</p>`)}
      ${bloc(t('legal.cgv.2', '2. Offres et prix'), `
        <p>${t('legal.cgv.2_gratuit', 'Offre gratuite : {n} simulations complètes à la création du compte, sans carte bancaire.').replace('{n}', CONFIG.simulationsGratuites)}</p>
        <p>${t('legal.cgv.2_pass48', '{nom} : {prix} TTC, accès complet pendant 48 heures à compter du paiement. Paiement unique, sans reconduction.').replace('{nom}', OFFRES.pass48.nom).replace('{prix}', OFFRES.pass48.prix)}</p>
        <p>${t('legal.cgv.2_mensuel', '{nom} : {prix} TTC par mois, sans engagement, reconduit automatiquement chaque mois jusqu\'à résiliation.').replace('{nom}', OFFRES.mensuel.nom).replace('{prix}', OFFRES.mensuel.prix)}</p>
        <p>${t('legal.cgv.2_extra', "{nom} : {prix} TTC pour six mois d'accès complet, précédés de {jours} jours d'essai gratuit. L'abonnement est <strong>reconduit automatiquement tous les six mois</strong> jusqu'à résiliation ; aucun prélèvement n'a lieu pendant l'essai.").replace('{nom}', OFFRES.extra.nom).replace('{prix}', OFFRES.extra.prix).replace('{jours}', OFFRES.extra.essaiJours)}</p>
        <p>${t('legal.cgv.2_prix', 'Les prix sont indiqués toutes taxes comprises, en euros. {n} peut les modifier à tout moment ; le tarif applicable est celui affiché au moment de la commande.').replace('{n}', EDITEUR.nom)}</p>`)}
      ${bloc(t('legal.cgv.3', '3. Commande et paiement'), pa('cgv.3_corps', "Le paiement s'effectue en ligne via Stripe (carte bancaire et moyens proposés par Stripe). La commande est validée après confirmation du paiement. Une facture est disponible dans l'espace client."))}
      ${bloc(t('legal.cgv.4', '4. Résiliation et reconduction'), `
        <p>${t('legal.cgv.4_resilier', "Les abonnements {m} et {e} sont résiliables à tout moment depuis « Gérer mon compte », qui ouvre le portail client Stripe. La résiliation prend effet à la fin de la période déjà réglée : l'accès est conservé jusque-là, et aucun prorata n'est remboursé. Le portail permet également de passer d'une formule à l'autre.").replace('{m}', OFFRES.mensuel.nom).replace('{e}', OFFRES.extra.nom)}</p>
        <p>${t('legal.cgv.4_essai', "Résilier pendant les {jours} jours d'essai de l'offre {nom} n'entraîne aucun prélèvement.").replace('{jours}', OFFRES.extra.essaiJours).replace('{nom}', OFFRES.extra.nom)}</p>
        <p>${t('legal.cgv.4_l215', "Conformément à l'article L215-1 du code de la consommation, {n} informe l'abonné de sa faculté de ne pas reconduire son abonnement semestriel, au plus tôt trois mois et au plus tard un mois avant l'échéance. À défaut d'information, l'abonné peut mettre fin gratuitement au contrat à tout moment à compter de la date de reconduction, et obtenir le remboursement des sommes prélevées après celle-ci.").replace('{n}', EDITEUR.nom)}</p>
        ${pa('cgv.4_pass48', "Le Pass 48 heures est un paiement unique : il ne se reconduit pas et n'a pas à être résilié. À l'échéance, l'accès revient à l'offre gratuite.")}`)}
      ${bloc(t('legal.cgv.5', '5. Droit de rétractation'), `
        ${pa('cgv.5_delai', 'Conformément aux articles L221-18 et suivants du code de la consommation, le consommateur dispose de 14 jours pour se rétracter.')}
        ${pa('cgv.5_renonciation', "En souscrivant, vous demandez expressément l'exécution immédiate du service et reconnaissez perdre votre droit de rétractation une fois le service pleinement exécuté (art. L221-28 13°). Pour l'abonnement mensuel, la rétractation reste possible tant qu'aucune simulation payante n'a été lancée.")}`)}
      ${bloc(t('legal.cgv.6', '6. Disponibilité'), `<p>${t('legal.cgv.6_corps', "Le service est fourni « en l'état ». {n} met en œuvre les moyens raisonnables pour assurer sa disponibilité mais ne garantit pas une continuité absolue (maintenance, incident d'un prestataire tiers, indisponibilité du fournisseur de modèle d'IA).").replace('{n}', EDITEUR.nom)}</p>`)}
      ${bloc(t('legal.cgv.7', '7. Responsabilité'), pa('cgv.7_corps', "Oralixia est un outil d'entraînement. Aucune obligation de résultat n'est due quant à la réussite d'un examen, d'un concours ou d'un recrutement."))}
      ${bloc(t('legal.cgv.8', '8. Souscription par un mineur'), `
        ${pa('cgv.8_principe', "Le service s'adresse notamment à des collégiens et lycéens. Conformément aux articles 1145 et suivants du code civil, un mineur non émancipé ne peut pas souscrire seul un abonnement payant : la souscription doit être effectuée par le titulaire de l'autorité parentale, ou avec son accord exprès.")}
        ${pa('cgv.8_gratuit', "L'utilisation gratuite du service reste ouverte. Pour les moins de 15 ans, la création d'un compte requiert l'accord du titulaire de l'autorité parentale (art. 45 de la loi Informatique et Libertés).")}
        <p>${t('legal.cgv.8_annulation', '{n} peut demander une confirmation à tout moment et annuler, sans frais, un abonnement souscrit par un mineur sans cet accord.').replace('{n}', EDITEUR.nom)}</p>`)}
      ${bloc(t('legal.cgv.9', '9. Droit applicable'), pa('cgv.9_corps', "Droit français. À défaut d'accord amiable, les tribunaux français sont compétents."))}
    `
  },

  confidentialite: {
    titre: t('legal.rgpd.titre', 'Politique de confidentialité (RGPD)'),
    contenu: `
      ${avertissementTraduction()}
      ${bloc(t('legal.rgpd.responsable', 'Responsable de traitement'), `<p>${EDITEUR.nom}, ${EDITEUR.adresse}. ${t('legal.mentions.contact', 'Contact')} : ${EDITEUR.email}.</p>`)}
      ${bloc(t('legal.rgpd.documents', 'Vos documents'), `
        <p><strong class="text-soft">${t('legal.rgpd.documents_gras', 'Vos CV, sujets, notes et réponses ne sont pas conservés.')}</strong> ${t('legal.rgpd.documents_corps', 'Les fichiers déposés sont lus directement dans votre navigateur : ils ne sont jamais téléversés sur nos serveurs.')}</p>
        ${pa('rgpd.documents_ia', "Le texte extrait est transmis au fournisseur de modèle d'IA le temps de générer les questions et la correction, puis n'est pas stocké côté Oralixia. Ces contenus ne sont ni revendus, ni cédés, ni utilisés pour entraîner un modèle.")}`)}
      ${bloc(t('legal.rgpd.donnees', 'Données traitées'), `
        ${pa('rgpd.donnees_compte', 'Compte : adresse e-mail, identifiant, date de création (base légale : exécution du contrat).')}
        ${pa('rgpd.donnees_abo', 'Abonnement : identifiant client Stripe, statut et échéance (exécution du contrat et obligation comptable).')}
        ${pa('rgpd.donnees_historique', "Historique : type d'oral, date, note globale et notes par critère — pour afficher votre progression (exécution du contrat). Le contenu de vos réponses n'y est pas enregistré côté serveur.")}
        ${pa('rgpd.donnees_audio', "Audio : la reconnaissance vocale utilise l'API de votre navigateur. Selon le navigateur, l'audio peut être traité par son éditeur (Google, Apple, Microsoft). Oralixia ne reçoit ni ne stocke aucun enregistrement.")}`)}
      ${bloc(t('legal.rgpd.durees', 'Durées de conservation'), pa('rgpd.durees_corps', "Compte et historique : jusqu'à la suppression du compte, puis 30 jours. Pièces comptables : 10 ans (obligation légale). Données de navigation : 13 mois maximum."))}
      ${bloc(t('legal.rgpd.soustraitants', 'Sous-traitants'), pa('rgpd.soustraitants_corps', "Vercel (hébergement), Supabase (base de données et authentification, région UE), Stripe (paiement), fournisseur de modèle d'IA pour la génération des questions et des corrections. Certains transferts hors UE sont encadrés par les clauses contractuelles types de la Commission européenne."))}
      ${bloc(t('legal.rgpd.droits', 'Vos droits'), `<p>${t('legal.rgpd.droits_corps', 'Accès, rectification, effacement, limitation, opposition et portabilité : écrivez à {email}. Vous pouvez introduire une réclamation auprès de la CNIL (cnil.fr).').replace('{email}', EDITEUR.email)}</p>`)}
      ${bloc(t('legal.rgpd.mineurs', 'Mineurs'), pa('rgpd.mineurs_corps', "Le service s'adresse notamment à des collégiens et lycéens. Pour les moins de 15 ans, la création d'un compte requiert l'accord du titulaire de l'autorité parentale."))}
    `
  },

  cookies: {
    titre: t('legal.cookies.titre', 'Cookies et stockage local'),
    contenu: `
      ${avertissementTraduction()}
      ${bloc(t('legal.cookies.utilisons', 'Ce que nous utilisons'), `
        <p>${t('legal.cookies.aucun_avant', 'Oralixia n\'utilise')} <strong class="text-soft">${t('legal.cookies.aucun_gras', 'aucun cookie publicitaire ni traceur marketing')}</strong>.</p>
        ${pa('cookies.stockage', "Stockage local du navigateur : compteur de simulations gratuites, historique de vos notes, avis déposés, préférences d'affichage. Ces informations restent sur votre appareil ; vous pouvez les effacer depuis « Mon espace » ou en vidant les données du site.")}
        ${pa('cookies.necessaires', "Cookies strictement nécessaires : session d'authentification (Supabase) et sécurité du paiement (Stripe). Ils ne requièrent pas de consentement préalable.")}`)}
    `
  }
});

/* Tant que l'identité de l'éditeur n'est pas renseignée, le site
   ne peut pas légalement vendre : on le signale sans ambiguïté. */
export function verifierMentions() {
  const alerte = $('#alerte-editeur');
  if (!alerte) return;
  if (editeurComplet()) { alerte.classList.add('hidden'); return; }

  const manquantes = Object.entries(CONFIG.editeur)
    .filter(([, v]) => !String(v || '').trim())
    .map(([k]) => k);

  /* Cet avertissement s'adresse à l'éditeur du site, pas à ses
     visiteurs : c'est à lui de compléter ses mentions, et un candidat
     venu s'entraîner n'a rien à faire de cette liste au bas de chaque
     page. Il part donc dans la console, où l'éditeur le retrouve, et
     réapparaît dans la page si ORALIXIA_ENV.AFFICHER_ALERTE_MENTIONS
     vaut true.

     Il ne disparaît pas pour autant : les mentions légales restent
     obligatoires avant toute vente (art. L111-1 s. du code de la
     consommation), et le README le rappelle. */
  console.warn(
    'Mentions légales incomplètes : ' + manquantes.join(', ') +
    '. Complétez window.ORALIXIA_ENV dans index.html avant de vendre ' +
    '(art. L111-1 s. du code de la consommation).');

  if (!(window.ORALIXIA_ENV || {}).AFFICHER_ALERTE_MENTIONS) {
    alerte.classList.add('hidden');
    return;
  }

  alerte.classList.remove('hidden');
  alerte.innerHTML =
    `<strong>${t('legal.alerte.titre', "Configuration incomplète — ne pas mettre en vente en l'état.")}</strong> ` +
    t('legal.alerte.manquantes', 'Les mentions légales obligatoires suivantes ne sont pas renseignées :') + ' ' +
    echappe(manquantes.join(', ')) + '. ' +
    t('legal.alerte.completer', 'Complétez le bloc <code>window.ORALIXIA_ENV</code> dans <code>index.html</code>.') + ' ' +
    t('legal.alerte.sanctions', 'Vendre sans ces mentions expose à des sanctions (art. L111-1 s. du code de la consommation).');
}

export function brancherLegal() {
  verifierMentions();
  // L'alerte est réécrite en clair dans le DOM : elle ne porte pas de
  // data-i18n, il faut donc la refaire à chaque changement de langue.
  surChangementLangue(verifierMentions);

  $$('[data-legal]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Le texte est construit à l'ouverture : il suit la langue courante.
      const texte = textes()[btn.dataset.legal];
      if (!texte) return;
      $('#legal-titre').textContent = texte.titre;
      $('#legal-contenu').innerHTML = texte.contenu;
      ouvrirModale('modal-legal');
    });
  });
}
