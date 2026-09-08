/* ═══════════════════════════════════════════════════════════
   legal.js — mentions légales, CGV, RGPD, cookies
   ⚠️ MODÈLE À COMPLÉTER. Les mentions entre crochets sont
   obligatoires et doivent être renseignées avant la mise en
   vente. Faites relire par un juriste : ces textes n'ont pas
   valeur de conseil juridique.
   ═══════════════════════════════════════════════════════════ */

import { $, $$, ouvrirModale } from './ui.js';

const E = '[À COMPLÉTER]';

export const EDITEUR = {
  nom: E,                       // ex. « PrepOral SAS » ou « William X., entrepreneur individuel »
  statut: E,                    // SAS, EI, auto-entrepreneur…
  siret: E,
  tva: E,                       // n° TVA intracommunautaire, ou mention de franchise en base
  adresse: E,
  email: E,
  directeur: E,
  hebergeur: 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis',
  hebergeurDonnees: 'Supabase (région UE) — base de données et authentification',
  paiement: 'Stripe Payments Europe, Ltd., 1 Grand Canal Street Lower, Dublin 2, Irlande'
};

const bloc = (titre, corps) => `<h3 class="mt-6 font-display text-base font-bold text-soft first:mt-0">${titre}</h3><div class="mt-2 space-y-2">${corps}</div>`;

export const TEXTES = {
  mentions: {
    titre: 'Mentions légales',
    contenu: `
      ${bloc('Éditeur du site', `
        <p>${EDITEUR.nom} — ${EDITEUR.statut}<br>Siège : ${EDITEUR.adresse}<br>SIRET : ${EDITEUR.siret} · TVA : ${EDITEUR.tva}<br>Contact : ${EDITEUR.email}</p>
        <p>Directeur de la publication : ${EDITEUR.directeur}</p>`)}
      ${bloc('Hébergement', `<p>${EDITEUR.hebergeur}</p><p>${EDITEUR.hebergeurDonnees}</p>`)}
      ${bloc('Paiement', `<p>Les paiements sont opérés par ${EDITEUR.paiement}. Aucune donnée de carte bancaire ne transite ni n'est stockée sur les serveurs de PrepOral.</p>`)}
      ${bloc('Propriété intellectuelle', `<p>L'ensemble des éléments du site (marque, logo, interface, textes, code) est protégé. Toute reproduction sans autorisation écrite est interdite. Les contenus que vous déposez restent votre propriété.</p>`)}
      ${bloc('Limites du service', `<p>PrepOral est un outil d'entraînement assisté par intelligence artificielle. Les questions, notes et conseils sont générés automatiquement, peuvent comporter des erreurs et ne constituent ni une évaluation officielle, ni une garantie de réussite à un examen, un concours ou un entretien.</p>`)}
      ${bloc('Médiation de la consommation', `<p>En cas de litige non résolu, le consommateur peut saisir gratuitement un médiateur de la consommation : ${E}. Plateforme européenne de règlement en ligne des litiges : ec.europa.eu/consumers/odr.</p>`)}
    `
  },

  cgv: {
    titre: 'Conditions générales de vente',
    contenu: `
      ${bloc('1. Objet', `<p>Les présentes conditions régissent la vente des abonnements et accès payants à PrepOral, service d'entraînement aux oraux édité par ${EDITEUR.nom}.</p>`)}
      ${bloc('2. Offres et prix', `
        <p>Offre gratuite : 2 simulations complètes, sans carte bancaire.</p>
        <p>PrepOral Premium : 9,99 € TTC par mois, sans engagement, reconduit automatiquement chaque mois jusqu'à résiliation.</p>
        <p>Pass 48 heures : 4,99 € TTC, accès complet pendant 48 heures à compter du paiement, sans reconduction.</p>
        <p>Les prix sont indiqués toutes taxes comprises, en euros. ${EDITEUR.nom} peut les modifier à tout moment ; le tarif applicable est celui affiché au moment de la commande.</p>`)}
      ${bloc('3. Commande et paiement', `<p>Le paiement s'effectue en ligne via Stripe (carte bancaire et moyens proposés par Stripe). La commande est validée après confirmation du paiement. Une facture est disponible dans l'espace client.</p>`)}
      ${bloc('4. Résiliation', `<p>L'abonnement mensuel est résiliable à tout moment depuis le portail client Stripe accessible dans « Mon espace ». La résiliation prend effet à la fin de la période en cours ; aucun prorata n'est remboursé. Le Pass 48 heures n'est pas reconductible.</p>`)}
      ${bloc('5. Droit de rétractation', `
        <p>Conformément aux articles L221-18 et suivants du code de la consommation, le consommateur dispose de 14 jours pour se rétracter.</p>
        <p>En souscrivant, vous demandez expressément l'exécution immédiate du service et reconnaissez perdre votre droit de rétractation une fois le service pleinement exécuté (art. L221-28 13°). Pour l'abonnement mensuel, la rétractation reste possible tant qu'aucune simulation payante n'a été lancée.</p>`)}
      ${bloc('6. Disponibilité', `<p>Le service est fourni « en l'état ». ${EDITEUR.nom} met en œuvre les moyens raisonnables pour assurer sa disponibilité mais ne garantit pas une continuité absolue (maintenance, incident d'un prestataire tiers, indisponibilité du fournisseur de modèle d'IA).</p>`)}
      ${bloc('7. Responsabilité', `<p>PrepOral est un outil d'entraînement. Aucune obligation de résultat n'est due quant à la réussite d'un examen, d'un concours ou d'un recrutement.</p>`)}
      ${bloc('8. Droit applicable', `<p>Droit français. À défaut d'accord amiable, les tribunaux français sont compétents.</p>`)}
    `
  },

  confidentialite: {
    titre: 'Politique de confidentialité (RGPD)',
    contenu: `
      ${bloc('Responsable de traitement', `<p>${EDITEUR.nom}, ${EDITEUR.adresse}. Contact : ${EDITEUR.email}.</p>`)}
      ${bloc('Vos documents', `
        <p><strong class="text-soft">Vos CV, sujets, notes et réponses ne sont pas conservés.</strong> Les fichiers déposés sont lus directement dans votre navigateur : ils ne sont jamais téléversés sur nos serveurs.</p>
        <p>Le texte extrait est transmis au fournisseur de modèle d'IA le temps de générer les questions et la correction, puis n'est pas stocké côté PrepOral. Ces contenus ne sont ni revendus, ni cédés, ni utilisés pour entraîner un modèle.</p>`)}
      ${bloc('Données traitées', `
        <p>Compte : adresse e-mail, identifiant, date de création (base légale : exécution du contrat).</p>
        <p>Abonnement : identifiant client Stripe, statut et échéance (exécution du contrat et obligation comptable).</p>
        <p>Historique : type d'oral, date, note globale et notes par critère — pour afficher votre progression (exécution du contrat). Le contenu de vos réponses n'y est pas enregistré côté serveur.</p>
        <p>Audio : la reconnaissance vocale utilise l'API de votre navigateur. Selon le navigateur, l'audio peut être traité par son éditeur (Google, Apple, Microsoft). PrepOral ne reçoit ni ne stocke aucun enregistrement.</p>`)}
      ${bloc('Durées de conservation', `<p>Compte et historique : jusqu'à la suppression du compte, puis 30 jours. Pièces comptables : 10 ans (obligation légale). Données de navigation : 13 mois maximum.</p>`)}
      ${bloc('Sous-traitants', `<p>Vercel (hébergement), Supabase (base de données et authentification, région UE), Stripe (paiement), fournisseur de modèle d'IA pour la génération des questions et des corrections. Certains transferts hors UE sont encadrés par les clauses contractuelles types de la Commission européenne.</p>`)}
      ${bloc('Vos droits', `<p>Accès, rectification, effacement, limitation, opposition et portabilité : écrivez à ${EDITEUR.email}. Vous pouvez introduire une réclamation auprès de la CNIL (cnil.fr).</p>`)}
      ${bloc('Mineurs', `<p>Le service s'adresse notamment à des collégiens et lycéens. Pour les moins de 15 ans, la création d'un compte requiert l'accord du titulaire de l'autorité parentale.</p>`)}
    `
  },

  cookies: {
    titre: 'Cookies et stockage local',
    contenu: `
      ${bloc('Ce que nous utilisons', `
        <p>PrepOral n'utilise <strong class="text-soft">aucun cookie publicitaire ni traceur marketing</strong>.</p>
        <p>Stockage local du navigateur : compteur de simulations gratuites, historique de vos notes, avis déposés, préférences d'affichage. Ces informations restent sur votre appareil ; vous pouvez les effacer depuis « Mon espace » ou en vidant les données du site.</p>
        <p>Cookies strictement nécessaires : session d'authentification (Supabase) et sécurité du paiement (Stripe). Ils ne requièrent pas de consentement préalable.</p>`)}
    `
  }
};

export function brancherLegal() {
  $$('[data-legal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = TEXTES[btn.dataset.legal];
      if (!t) return;
      $('#legal-titre').textContent = t.titre;
      $('#legal-contenu').innerHTML = t.contenu;
      ouvrirModale('modal-legal');
    });
  });
}
