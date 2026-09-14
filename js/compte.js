/* ═══════════════════════════════════════════════════════════
   compte.js — « Gérer mon compte »

   Tout ce qui touche à l'identité et à l'abonnement, en un
   endroit. Deux principes tiennent la page :

   • Les coordonnées bancaires ne transitent jamais par ici.
     Saisir un numéro de carte sur nos pages ferait entrer
     Oralixia dans le périmètre PCI-DSS, avec les audits qui
     vont avec, pour un service que Stripe rend déjà. Le bouton
     « Gérer mes moyens de paiement » ouvre donc le portail
     Stripe, qui gère aussi la résiliation et le changement de
     formule.

   • Les métadonnées du compte font foi pour l'affichage
     (pseudonyme, couleur, photo), et la table « profils » les
     reçoit en copie pour être lisible en SQL. Écrire aux deux
     endroits évite d'avoir à interroger la base à chaque page.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, OFFRES } from './config.js';
import { $, $$, echappe, toast } from './ui.js';
import { t, langue } from './i18n.js';
import { brancherNavigation } from './nav.js';
import {
  session, profil, supabase, configure, nomAffiche, deconnexion,
  couleurAvatar, COULEURS_AVATAR, surChangementCompte, ouvrirAuth,
  photoCassee, signalerPhotoCassee
} from './auth.js';
import { quotaRestant, estPremium, ouvrirPaywall, ouvrirPortail } from './paywall.js';

const TAILLE_PHOTO_MAX = 2 * 1024 * 1024;   // 2 Mo, comme le compartiment Supabase

/* ── Affichage ─────────────────────────────────────────────── */

function rendre() {
  const connecte = Boolean(session.email);
  $('#compte-anonyme')?.classList.toggle('hidden', connecte);
  $('#compte-connecte')?.classList.toggle('hidden', !connecte);
  if (!connecte) return;

  rendreAvatar();
  rendreCouleurs();
  remplirFormulaire();
  rendreAbonnement();
  rendreSimulations();
}

function rendreAvatar() {
  const zone = $('#apercu-avatar');
  if (!zone) return;

  zone.innerHTML = (session.avatar && !photoCassee)
    ? `<img src="${echappe(session.avatar)}" alt="" referrerpolicy="no-referrer" data-avatar
         class="h-20 w-20 rounded-full border border-line object-cover">`
    : `<span class="grid h-20 w-20 place-items-center rounded-full text-white" style="background:${couleurAvatar()}">
         <svg viewBox="0 0 24 24" width="52%" height="52%" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
         </svg>
       </span>`;

  // Rien à retirer si la photo ne s'affiche même pas.
  $('#btn-retirer-photo')?.classList.toggle('hidden', !session.avatar || photoCassee);
}

function rendreCouleurs() {
  const zone = $('#choix-couleurs');
  if (!zone) return;

  /* Avec une photo VISIBLE, la couleur ne sert plus à rien : on grise le
     choix plutôt que de le faire disparaître. Une photo qui ne s'affiche
     pas, en revanche, ne doit rien condamner — la pastille montre alors
     la silhouette, et sa couleur redevient le seul réglage utile. */
  const inutile = Boolean(session.avatar) && !photoCassee;
  zone.classList.toggle('opacity-40', inutile);
  zone.classList.toggle('pointer-events-none', inutile);

  const actuelle = session.couleur || nomDeLaCouleur(couleurAvatar());
  zone.innerHTML = Object.entries(COULEURS_AVATAR).map(([nom, teinte]) => {
    const actif = nom === actuelle;
    return `<button type="button" role="radio" data-couleur="${nom}" aria-checked="${actif}"
      aria-label="${echappe(nom)}" title="${echappe(nom)}"
      class="h-9 w-9 rounded-full ring-offset-2 ring-offset-surface transition ${actif ? 'ring-2 ring-soft' : 'hover:ring-2 hover:ring-line'}"
      style="background:${teinte}"></button>`;
  }).join('');

  $$('#choix-couleurs [data-couleur]').forEach(b =>
    b.addEventListener('click', () => choisirCouleur(b.dataset.couleur)));
}

/** Retrouve le nom d'une teinte à partir de sa valeur hexadécimale. */
const nomDeLaCouleur = hex =>
  Object.keys(COULEURS_AVATAR).find(n => COULEURS_AVATAR[n] === hex) || '';

function remplirFormulaire() {
  const v = (sel, valeur) => { const el = $(sel); if (el) el.value = valeur || ''; };
  v('#c-prenom', session.prenom);
  v('#c-nom', session.nom);
  v('#c-pseudo', session.pseudo);
  v('#c-email', session.email);
  v('#c-telephone', afficherTelephone(profil.telephone));
  majApercuNom();
}

/** Montre à quoi ressemblera le nom affiché, avant d'enregistrer. */
function majApercuNom() {
  const el = $('#apercu-nom');
  if (!el) return;
  const prenom = ($('#c-prenom')?.value || '').trim();
  const initiale = ($('#c-nom')?.value || '').trim().charAt(0).toUpperCase();
  el.textContent = prenom && initiale ? `${prenom} ${initiale}.` : (prenom || nomAffiche());
}

function rendreAbonnement() {
  const zone = $('#etat-abonnement');
  const actions = $('#actions-abonnement');
  if (!zone || !actions) return;

  const offre = profil.plan ? OFFRES[profil.plan] : null;
  const finLe = profil.premiumJusquA ? new Date(profil.premiumJusquA) : null;
  const dateLisible = finLe
    ? finLe.toLocaleDateString(langue() === 'fr' ? 'fr-FR' : langue(),
        { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  if (!estPremium()) {
    zone.innerHTML = `
      <p class="inline-flex rounded-full border border-line px-2.5 py-1 text-xs text-muted">
        ${echappe(t('compte.offre_gratuite', 'Offre gratuite'))}
      </p>
      <p class="leading-relaxed text-muted">${echappe(t('compte.aucun_abonnement',
        "Aucun abonnement en cours. Vos simulations offertes restent disponibles."))}</p>`;
    actions.innerHTML = `
      <button type="button" data-action="offres"
        class="w-full rounded-xl bg-inverse px-4 py-3 font-display font-bold text-sur-inverse transition hover:opacity-90">
        ${echappe(t('accueil.voir_les_offres', 'Voir les offres'))}
      </button>`;
  } else {
    zone.innerHTML = `
      <p class="inline-flex rounded-full border border-mint/50 bg-mint/10 px-2.5 py-1 text-xs text-mint">
        ${echappe(t('compte.premium_actif', 'Premium actif'))}
      </p>
      <p class="font-display text-base font-bold">${echappe(offre?.nom || t('compte.abonnement', 'Abonnement'))}</p>
      ${offre ? `<p class="text-muted">${echappe(offre.prix)} · ${echappe(offre.periode)}</p>` : ''}
      <p class="leading-relaxed text-muted">${echappe(dateLisible
        ? t('compte.actif_jusquau', "Actif jusqu'au {date}").replace('{date}', dateLisible)
        : t('compte.reconduction', 'Reconduit automatiquement. Résiliable à tout moment.'))}</p>`;

    actions.innerHTML = `
      <button type="button" data-action="portail"
        class="w-full rounded-xl bg-inverse px-4 py-3 font-display font-bold text-sur-inverse transition hover:opacity-90">
        ${echappe(t('compte.gerer_abonnement', 'Résilier ou changer de formule'))}
      </button>
      <p class="text-xs leading-relaxed text-muted">${echappe(t('compte.resiliation_aide',
        "Une résiliation prend effet à la fin de la période déjà payée : vous gardez l'accès jusque-là."))}</p>`;
  }

  $$('#actions-abonnement [data-action]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.action === 'portail') ouvrirPortail();
    else ouvrirPaywall('fin');
  }));
}

function rendreSimulations() {
  const compteur = $('#compteur-simulations');
  const detail = $('#detail-simulations');
  if (!compteur || !detail) return;

  if (estPremium()) {
    compteur.textContent = '∞';
    detail.textContent = t('quota.premium', 'Premium · simulations illimitées');
    return;
  }
  const reste = quotaRestant();
  compteur.textContent = String(reste);
  detail.textContent = reste > 0
    ? t('compte.simulations_restantes', 'simulations offertes restantes sur {total}')
        .replace('{total}', CONFIG.simulationsGratuites)
    : t('quota.epuisees', 'Simulations gratuites épuisées');
}

/* ── Écritures ─────────────────────────────────────────────── */

/* Au-delà, on cesse d'attendre le réseau : un enregistrement qui ne
   revient jamais laisserait le bouton bloqué sur « Enregistrement… ».
   Vingt secondes, parce que douze suffisaient à peine sur un réseau
   mobile lent et faisaient échouer des enregistrements qui allaient
   aboutir. */
const DELAI_ECRITURE = 20000;

/** Rejette si la promesse n'a pas abouti dans le délai imparti. */
const avecDelai = (promesse, ms = DELAI_ECRITURE) => {
  let minuteur;
  return Promise.race([
    Promise.resolve(promesse).finally(() => clearTimeout(minuteur)),
    new Promise((_, ko) => { minuteur = setTimeout(
      () => ko(new Error(t('compte.delai', "Le serveur n'a pas répondu. Réessayez."))), ms); })
  ]);
};

/**
 * Enregistre le profil à deux endroits, en parallèle.
 *
 * La table « profils » est la source durable : c'est elle qu'on
 * interroge en SQL, et elle qui repeuple la session au chargement
 * suivant. Les métadonnées du compte ne servent qu'à afficher le nom
 * sans attendre une requête.
 *
 * Les deux écritures étaient enchaînées, et la première commandait
 * tout : quand `auth.updateUser` traînait ou échouait, l'enregistrement
 * entier était déclaré perdu alors que la base aurait accepté. Elles
 * partent donc ensemble, et il suffit que l'une aboutisse.
 *
 * @returns {Promise<true|string>} true, ou le message d'erreur à afficher.
 */
async function enregistrer(champs, colonnes = champs) {
  if (!supabase || !session.id) {
    return t('compte.hors_ligne', "Enregistrement impossible : vous n'êtes pas connecté.");
  }

  const tenter = async (nom, executer) => {
    try {
      const r = await avecDelai(executer());
      if (r?.error) throw new Error(r.error.message || String(r.error));
      return { nom, ok: true };
    } catch (e) {
      console.warn(`Écriture « ${nom} » en échec :`, e?.message || e);
      return { nom, ok: false, message: e?.message || String(e) };
    }
  };

  /* Les deux écritures partent ensemble, mais on n'attend que la base :
     c'est elle qui conserve durablement le profil. Les métadonnées ne
     servent qu'à afficher le nom sans requête au chargement suivant ;
     les attendre faisait patienter le candidat — jusqu'au délai de
     garde — pour un enregistrement déjà acquis. */
  const ecritureBase = Object.keys(colonnes).length
    ? tenter('profils', () => supabase.from('profils')
        .update({ ...colonnes, maj_le: new Date().toISOString() }).eq('id', session.id))
    : Promise.resolve({ nom: 'profils', ok: true });

  const ecritureMeta = Object.keys(champs).length
    ? tenter('métadonnées', () => supabase.auth.updateUser({ data: champs }))
    : Promise.resolve({ nom: 'métadonnées', ok: true });

  const base = await ecritureBase;

  if (!base.ok) {
    /* La base a refusé : les métadonnées deviennent le dernier recours,
       et là seulement il vaut la peine de les attendre. */
    const meta = await ecritureMeta;
    if (!meta.ok) return base.message || meta.message;
  }

  Object.assign(session, champs);
  Object.assign(profil, colonnes);
  return true;
}

async function choisirCouleur(nom) {
  if (!COULEURS_AVATAR[nom]) return;
  session.couleur = nom;               // retour visuel immédiat
  rendreAvatar(); rendreCouleurs();
  const r = await enregistrer({ couleur: nom });
  if (r === true) rafraichirEntete(); else toast(r, 'erreur');
}

async function enregistrerInfos() {
  const bouton = $('#btn-enregistrer');
  const etat = $('#etat-infos');
  const prenom = ($('#c-prenom')?.value || '').trim();
  const nom = ($('#c-nom')?.value || '').trim();
  const pseudo = ($('#c-pseudo')?.value || '').trim();
  const telephone = ($('#c-telephone')?.value || '').trim();

  const numero = normaliserTelephone(telephone);
  if (telephone && !numero) {
    if (etat) { etat.textContent = t('compte.telephone_invalide',
      'Numéro invalide. Exemple : 06 12 34 56 78, ou +33 6 12 34 56 78.'); etat.className = 'text-sm text-coral'; }
    return;
  }

  /* try/finally : sans lui, une exception ou une requête qui ne revient
     jamais laissait le bouton bloqué sur « Enregistrement… », désactivé,
     sans un mot d'explication. Reproduit dans un navigateur. */
  if (bouton) { bouton.disabled = true; bouton.textContent = t('compte.enregistrement', 'Enregistrement…'); }
  let resultat;
  try {
    resultat = await enregistrer({ prenom, nom, pseudo }, { prenom, nom, pseudo, telephone: numero });
  } catch (e) {
    resultat = e?.message || t('compte.echec', "L'enregistrement a échoué.");
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = t('compte.enregistrer', 'Enregistrer'); }
  }

  const reussi = resultat === true;
  if (etat) {
    // Un échec muet était pire qu'un échec : on affiche toujours la raison.
    etat.textContent = reussi ? t('compte.enregistre', 'Enregistré.') : String(resultat);
    etat.className = 'text-sm ' + (reussi ? 'text-mint' : 'text-coral');
  }
  if (reussi) { rafraichirEntete(); majApercuNom(); }
}

async function televerserPhoto(fichier) {
  const etat = $('#etat-avatar');
  const dire = (texte, erreur = false) => {
    if (etat) { etat.textContent = texte; etat.className = 'mt-3 text-xs ' + (erreur ? 'text-coral' : 'text-muted'); }
  };

  if (!fichier) return;
  if (fichier.size > TAILLE_PHOTO_MAX) {
    return dire(t('compte.photo_trop_lourde', 'Photo trop lourde : 2 Mo maximum.'), true);
  }
  if (!supabase || !session.id) {
    return dire(t('compte.hors_ligne', "Enregistrement impossible : vous n'êtes pas connecté."), true);
  }

  dire(t('compte.envoi_photo', 'Envoi de la photo…'));
  try {
    /* Le chemin commence par l'identifiant du compte : c'est ce que
       vérifie la règle de sécurité du compartiment. Le nom change à
       chaque envoi pour contourner les caches. */
    const extension = (fichier.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const chemin = `${session.id}/photo-${Date.now()}.${extension}`;

    const { error } = await supabase.storage.from('avatars')
      .upload(chemin, fichier, { upsert: true, contentType: fichier.type });
    if (error) throw error;

    const { data } = supabase.storage.from('avatars').getPublicUrl(chemin);
    const url = data?.publicUrl;
    if (!url) throw new Error('URL de la photo introuvable.');

    session.avatar = url;
    const r = await enregistrer({ avatar_url: url }, { avatar_url: url });
    if (r !== true) throw new Error(r);
    dire(t('compte.photo_enregistree', 'Photo enregistrée.'));
    rendreAvatar(); rendreCouleurs(); rafraichirEntete();
  } catch (e) {
    dire(e.message || t('compte.photo_echec', "L'envoi de la photo a échoué."), true);
  }
}

async function retirerPhoto() {
  session.avatar = '';
  const r = await enregistrer({ avatar_url: '' }, { avatar_url: null });
  if (r !== true) return toast(r, 'erreur');
  rendreAvatar(); rendreCouleurs(); rafraichirEntete();
  const etat = $('#etat-avatar');
  if (etat) etat.textContent = t('compte.photo_retiree', 'Photo retirée.');
}

async function changerEmail() {
  const nouvelle = ($('#c-email')?.value || '').trim();
  const etat = $('#etat-connexion');
  const dire = (texte, erreur = false) => {
    if (etat) { etat.textContent = texte; etat.className = 'mt-3 text-sm ' + (erreur ? 'text-coral' : 'text-mint'); }
  };

  if (!nouvelle || nouvelle === session.email) {
    return dire(t('compte.email_identique', 'Saisissez une nouvelle adresse.'), true);
  }
  if (!supabase) return dire(t('compte.hors_ligne', "Enregistrement impossible : vous n'êtes pas connecté."), true);

  const { error } = await supabase.auth.updateUser({ email: nouvelle });
  if (error) return dire(error.message, true);
  dire(t('compte.email_confirmation',
    "Un lien de confirmation part vers l'ancienne et la nouvelle adresse. Le changement prend effet une fois les deux confirmées."));
}

async function changerMotDePasse() {
  const etat = $('#etat-connexion');
  if (!supabase || !session.email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(session.email, {
    redirectTo: new URL('./compte.html', location.href).href
  });
  if (etat) {
    etat.textContent = error ? error.message
      : t('compte.mdp_envoye', 'Message envoyé : suivez le lien pour choisir un nouveau mot de passe.');
    etat.className = 'mt-3 text-sm ' + (error ? 'text-coral' : 'text-mint');
  }
}

/** La suppression définitive exige la clé de service : elle passe par nous. */
function demanderSuppression() {
  const confirme = window.confirm(t('compte.supprimer_confirmation',
    'Supprimer définitivement votre compte, vos simulations passées et votre compteur d\'usage ? Cette action est irréversible.'));
  if (!confirme) return;

  const objet = encodeURIComponent('Suppression de mon compte Oralixia');
  const corps = encodeURIComponent(
    `Bonjour,\n\nJe demande la suppression de mon compte Oralixia.\n\nAdresse du compte : ${session.email}\n\nMerci.`);
  const destinataire = CONFIG.editeur.email;

  if (!destinataire) {
    toast(t('compte.suppression_sans_contact',
      "L'adresse de contact n'est pas encore renseignée sur ce site. Écrivez à l'éditeur pour demander la suppression."), 'erreur');
    return;
  }
  location.href = `mailto:${destinataire}?subject=${objet}&body=${corps}`;
}

/* L'en-tête est dessiné par auth.js : on lui demande de se redessiner. */
function rafraichirEntete() {
  document.dispatchEvent(new CustomEvent('preporal:compte-modifie'));
}

/* ── Démarrage ─────────────────────────────────────────────── */
async function demarrer() {
  await brancherNavigation();

  $('#btn-enregistrer')?.addEventListener('click', enregistrerInfos);
  $('#btn-changer-email')?.addEventListener('click', changerEmail);
  $('#btn-changer-mdp')?.addEventListener('click', changerMotDePasse);
  $('#btn-supprimer-compte')?.addEventListener('click', demanderSuppression);
  $('#btn-retirer-photo')?.addEventListener('click', retirerPhoto);
  $('#fichier-avatar')?.addEventListener('change', e => televerserPhoto(e.target.files?.[0]));
  $('#btn-portail')?.addEventListener('click', ouvrirPortail);
  $('#btn-deconnexion-compte')?.addEventListener('click', deconnexion);
  ['#c-prenom', '#c-nom'].forEach(sel => $(sel)?.addEventListener('input', majApercuNom));

  surChangementCompte(rendre);
  // Le profil peut aussi changer depuis l'en-tête (déconnexion, retour de
  // paiement) : la page se redessine sans rechargement.
  document.addEventListener('preporal:compte-modifie', rendre);
  document.addEventListener('preporal:photo-cassee', rendre);

  // Sans Supabase configuré, la page n'a rien à gérer : on le dit.
  if (!configure()) {
    $('#compte-anonyme')?.classList.remove('hidden');
    const titre = $('#compte-anonyme h1');
    if (titre) titre.textContent = t('compte.mode_local_titre', 'Comptes indisponibles en mode local');
  }
}

demarrer();


/* ═══════════════════════════════════════════════════════════
   Téléphone : un simple moyen de rappeler quelqu'un

   Le numéro est facultatif et sert à joindre un candidat en
   cas de problème sur son compte. Rien de plus.

   La vérification par SMS a été retirée : elle imposait un
   fournisseur payant chez Supabase, facturait chaque tentative,
   et rattachait le numéro à l'authentification du compte — donc
   une panne du SMS devenait une panne de l'enregistrement. Pour
   un champ purement informatif, le prix était absurde.

   Le format E.164 (+33612345678) est conservé : il reste
   valable si le candidat passe une frontière, et se compose
   directement depuis un téléphone.
   ═══════════════════════════════════════════════════════════ */

/** Indicatif appliqué à un numéro national sans préfixe. */
const INDICATIF_DEFAUT = '+33';

/**
 * @returns {string} le numéro en E.164, ou '' s'il est invalide.
 *          Une chaîne vide en entrée rend une chaîne vide : effacer
 *          son numéro est un choix légitime, pas une erreur.
 */
export function normaliserTelephone(brut) {
  const saisi = String(brut || '').trim();
  if (!saisi) return '';

  // On ne garde que les chiffres, et le + s'il ouvre le numéro.
  const international = saisi.startsWith('+');
  const chiffres = saisi.replace(/\D/g, '');
  if (!chiffres) return '';

  if (international) {
    return chiffres.length >= 8 && chiffres.length <= 15 ? '+' + chiffres : '';
  }

  /* Numéro national français : dix chiffres commençant par zéro.
     Le zéro tombe, l'indicatif le remplace. */
  if (/^0[1-9]\d{8}$/.test(chiffres)) return INDICATIF_DEFAUT + chiffres.slice(1);

  // Tout le reste est ambigu : mieux vaut refuser que deviner un pays.
  return '';
}

/** Affichage lisible : +33612345678 → +33 6 12 34 56 78 */
export function afficherTelephone(e164) {
  const n = String(e164 || '');
  if (!n.startsWith('+33') || n.length !== 12) return n;
  return '+33 ' + n.slice(3).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
}


