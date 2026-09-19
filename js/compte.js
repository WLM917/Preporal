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
import { t, langue, region } from './i18n.js';
import { ajusterAuBudget } from './photo.js';
import { brancherNavigation } from './nav.js';
import {
  session, profil, supabase, configure, nomAffiche, deconnexion,
  couleurAvatar, COULEURS_AVATAR, surChangementCompte, ouvrirAuth,
  photoCassee, signalerPhotoCassee, jetonAcces
} from './auth.js';
import { quotaRestant, estPremium, ouvrirPaywall, ouvrirPortail } from './paywall.js';

/* Ce que le candidat a le droit de CHOISIR, et non ce qui part sur le
   réseau. La distinction n'est pas théorique : une photo prise avec un
   iPhone pèse trois à cinq mégaoctets, et le site la refusait d'emblée
   — « Photo trop lourde : 2 Mo maximum » — alors qu'il s'apprêtait à la
   réduire à quelques kilooctets. On refusait une photo à cause d'un
   poids qu'on allait soi-même faire disparaître.

   Vingt-cinq mégaoctets restent une borne utile : au-delà, décoder
   l'image dans une toile fait tomber l'onglet sur un téléphone. Le vrai
   plafond de ce qui part, lui, est vérifié côté serveur. */
const TAILLE_PHOTO_MAX = 25 * 1024 * 1024;

/* La photo est réduite avant d'être envoyée. Une photo prise au
   téléphone pèse plusieurs mégaoctets et finit affichée dans un rond
   de quatre-vingts pixels : la ramener à 512 pixels de côté la fait
   tenir en quelques dizaines de kilooctets. L'envoi devient immédiat,
   même en 4G, et la limite de taille des fonctions serveur n'est
   jamais approchée. */
const COTE_PHOTO = 512;

/* Quand le stockage n'est pas disponible, la photo voyage dans le compte
   lui-même. Or les métadonnées du compte sont recopiées dans le jeton
   d'accès, et ce jeton part en en-tête à chaque requête : une photo de
   quelques dizaines de kilooctets rendrait l'en-tête plus gros que ce
   que la plupart des serveurs acceptent, et tout le site tomberait.

   D'où ces deux bornes. Cent vingt-huit pixels suffisent pour un rond de
   quatre-vingts, et la qualité descend jusqu'à ce que la photo tienne
   dans le budget — on ne parie pas sur le poids d'une photo inconnue,
   on le vérifie. */
const COTE_PHOTO_REPLI = 128;
const POIDS_REPLI_MAX = 3 * 1024;
const QUALITES_REPLI = [0.7, 0.55, 0.45, 0.35, 0.25];

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

  /* La couleur reste modifiable en toute circonstance.

     Elle était grisée dès qu'une photo existait, au motif qu'elle ne
     servait plus à rien. Mais elle sert toujours : c'est elle qui
     s'affiche si la photo est retirée, ou si elle ne se charge pas. Et
     comme le site prenait le monogramme fourni par Google pour une
     photo, le choix se retrouvait verrouillé sans que rien ne
     l'explique — un réglage qu'on voit et sur lequel on ne peut pas
     appuyer. */

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
    ? finLe.toLocaleDateString(region(),
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
 * Enregistre le profil.
 *
 * Deux endroits reçoivent la même information, et l'ordre compte :
 *
 * • Les métadonnées du compte font foi pour l'affichage. C'est d'elles
 *   que la session se remplit à l'ouverture, et elles l'emportent sur
 *   la table. Ce sont aussi du JSON : aucune colonne ne peut y manquer,
 *   et l'écriture aboutit ou échoue tout de suite.
 *
 * • La table « profils » en reçoit une copie, pour être lisible en SQL.
 *
 * C'est donc la première qu'on attend. L'inverse était fait, et la
 * copie commandait tout : tant que la base ne répondait pas, le
 * candidat regardait « Enregistrement… » jusqu'au délai de garde, puis
 * lisait « Le serveur n'a pas répondu » — pour un changement de
 * pseudonyme déjà acquis dans son compte. La copie part maintenant en
 * arrière-plan ; si elle échoue, rien de ce qu'il voit n'est faux, et
 * la console dit quoi rejouer.
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

  /* Une colonne absente de la base fait échouer l'écriture entière, y
     compris pour les champs qui, eux, existent. Cela arrive dès que le
     schéma SQL n'a pas été rejoué après une mise à jour. */
  const colonneInconnue = message =>
    /could not find|does not exist|schema cache|column/i.test(String(message || ''));

  const copierEnBase = async champsBase => {
    const premier = await tenter('profils', () => supabase.from('profils')
      .update({ ...champsBase, maj_le: new Date().toISOString() }).eq('id', session.id));
    if (premier.ok || !colonneInconnue(premier.message)) return premier;

    /* Second essai, réduit aux colonnes présentes depuis la création de
       la table. Les autres attendront que supabase/schema.sql soit
       rejoué — sans quoi, rien à signaler au candidat : son compte,
       lui, est à jour. */
    const sures = {};
    for (const cle of ['prenom', 'nom', 'email']) {
      if (cle in champsBase) sures[cle] = champsBase[cle];
    }
    if (!Object.keys(sures).length) return premier;

    console.warn('Colonne absente du schéma : copie réduite. Rejouez supabase/schema.sql.');
    return tenter('profils (réduit)', () => supabase.from('profils')
      .update({ ...sures, maj_le: new Date().toISOString() }).eq('id', session.id));
  };

  /* La copie part tout de suite, mais personne ne l'attend. Le .catch
     est là pour qu'un échec ne remonte pas en rejet non traité. */
  if (Object.keys(colonnes).length) {
    copierEnBase(colonnes).catch(e => console.warn('Copie en base abandonnée', e));
  }

  if (Object.keys(champs).length) {
    const meta = await tenter('métadonnées', () => supabase.auth.updateUser({ data: champs }));
    if (!meta.ok) return meta.message;
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


  /* Le bouton dit lui-même où il en est : « Enregistrer », puis
     « Enregistrement… », puis « Enregistré » en vert. Le message à côté
     ne servait qu'à ça, et il restait affiché bien après coup. */
  if (bouton) { bouton.disabled = true; bouton.textContent = t('compte.enregistrement', 'Enregistrement…'); }
  if (etat) etat.textContent = '';

  let resultat;
  try {
    resultat = await enregistrer({ prenom, nom, pseudo }, { prenom, nom, pseudo });
  } catch (e) {
    resultat = e?.message || t('compte.echec', "L'enregistrement a échoué.");
  }

  const reussi = resultat === true;
  if (reussi) {
    rafraichirEntete(); majApercuNom();
    marquerEnregistre(bouton);
  } else {
    /* try/finally à la main : le bouton doit toujours redevenir
       utilisable, y compris après une exception. */
    if (bouton) { bouton.disabled = false; bouton.textContent = t('compte.enregistrer', 'Enregistrer'); }
    // Un échec muet serait pire qu'un échec : on affiche toujours la raison.
    if (etat) {
      etat.textContent = String(resultat);
      etat.className = 'text-sm text-coral';
    }
  }
}

/* Deux secondes de vert, puis le bouton reprend son libellé. */
const CLASSES_SUCCES = ['bg-mint', 'text-ink', 'border-mint'];
function marquerEnregistre(bouton) {
  if (!bouton) return;
  bouton.disabled = false;
  bouton.textContent = t('compte.enregistre_court', 'Enregistré');
  bouton.classList.add(...CLASSES_SUCCES);
  clearTimeout(bouton._minuteurSucces);
  bouton._minuteurSucces = setTimeout(() => {
    bouton.classList.remove(...CLASSES_SUCCES);
    bouton.textContent = t('compte.enregistrer', 'Enregistrer');
  }, 2000);
}

/** Charge le fichier choisi dans une image, pour pouvoir le redimensionner. */
function chargerImage(fichier) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error(
      t('compte.photo_illisible', "Cette image n'a pas pu être lue."))); };
    img.src = url;
  });
}

/** Dessine l'image à la taille voulue et rend une adresse « data: ». */
function dessiner(img, cote, qualite) {
  // On ne l'agrandit jamais : une petite photo reste à sa taille.
  const grandCote = Math.max(img.naturalWidth, img.naturalHeight);
  const facteur = Math.min(1, cote / grandCote);
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(img.naturalWidth * facteur));
  toile.height = Math.max(1, Math.round(img.naturalHeight * facteur));
  toile.getContext('2d').drawImage(img, 0, 0, toile.width, toile.height);
  return toile.toDataURL('image/jpeg', qualite);
}

/** Réduit la photo et la rend en base64, prête à partir. */
async function reduirePhoto(fichier) {
  const img = await chargerImage(fichier);
  if (!Math.max(img.naturalWidth, img.naturalHeight)) {
    throw new Error(t('compte.photo_illisible', "Cette image n'a pas pu être lue."));
  }
  const donnees = dessiner(img, COTE_PHOTO, 0.85);
  return { contenu: donnees.slice(donnees.indexOf(',') + 1), type: 'image/jpeg' };
}

/**
 * La photo réduite jusqu'à tenir dans le budget, pour voyager dans le
 * compte quand le stockage n'est pas disponible.
 *
 * On essaie les qualités l'une après l'autre et on mesure : le poids
 * d'un JPEG dépend de ce qu'il y a dessus, pas seulement de ses
 * dimensions. Un portrait sur fond uni et une photo de foule ne pèsent
 * pas du tout pareil à qualité égale.
 */
async function photoDeRepli(fichier) {
  const img = await chargerImage(fichier);
  if (!Math.max(img.naturalWidth, img.naturalHeight)) {
    throw new Error(t('compte.photo_illisible', "Cette image n'a pas pu être lue."));
  }

  const rendu = ajusterAuBudget((cote, qualite) => dessiner(img, cote, qualite), {
    budget: POIDS_REPLI_MAX, qualites: QUALITES_REPLI,
    cote: COTE_PHOTO_REPLI, coteDernier: 96
  });
  if (!rendu) {
    throw new Error(t('compte.photo_trop_detaillee',
      'Cette photo est trop chargée pour être enregistrée ici. Essayez-en une autre.'));
  }
  return rendu;
}

/** Appelle /api/avatar, qui agit avec les droits nécessaires. */
async function appelerApiAvatar(corps) {
  const jeton = await jetonAcces();
  const reponse = await avecDelai(fetch('/api/avatar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jeton ? { Authorization: 'Bearer ' + jeton } : {})
    },
    body: JSON.stringify(corps)
  }));
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(donnees.erreur || t('compte.photo_echec', "L'envoi de la photo a échoué."));
    erreur.statut = reponse.status;   // 503 : le stockage n'est pas activé
    throw erreur;
  }
  return donnees;
}

async function televerserPhoto(fichier) {
  const etat = $('#etat-avatar');
  const dire = (texte, erreur = false) => {
    if (etat) { etat.textContent = texte; etat.className = 'mt-3 text-xs ' + (erreur ? 'text-coral' : 'text-muted'); }
  };

  if (!fichier) return;
  if (fichier.size > TAILLE_PHOTO_MAX) {
    return dire(t('compte.photo_trop_lourde', 'Photo trop lourde : 25 Mo maximum.'), true);
  }
  if (!session.id) {
    return dire(t('compte.hors_ligne', "Enregistrement impossible : vous n'êtes pas connecté."), true);
  }

  dire(t('compte.envoi_photo', 'Envoi de la photo…'));
  try {
    /* Le dépôt passe par notre API, et non plus directement par le
       stockage Supabase : le compartiment « avatars » n'existe pas
       forcément, et le navigateur n'a pas le droit de le créer. Le
       serveur, lui, l'a — il le crée au premier envoi.

       Et si le stockage n'est pas encore activé sur ce site, la photo
       ne part pas à la poubelle pour autant : elle voyage alors dans le
       compte lui-même, réduite pour y tenir. Le jour où la clé de
       service sera posée, le chemin normal reprendra tout seul, sans
       rien changer ici. */
    let url;
    try {
      ({ url } = await appelerApiAvatar(await reduirePhoto(fichier)));
    } catch (e) {
      if (e?.statut !== 503) throw e;
      console.warn('Stockage inactif : la photo est gardée dans le compte.');
      url = await photoDeRepli(fichier);
    }
    if (!url) throw new Error(t('compte.photo_url', 'URL de la photo introuvable.'));

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
  rendreAvatar(); rendreCouleurs(); rafraichirEntete();

  /* Le fichier part aussi du stockage : le retirer de l'affichage sans
     l'effacer laisserait une photo de quelqu'un sur un serveur, à une
     adresse publique, après qu'il a demandé son retrait. */
  appelerApiAvatar({ supprimer: true })
    .catch(e => console.warn('Photo non effacée du stockage', e));

  const r = await enregistrer({ avatar_url: '' }, { avatar_url: null });
  if (r !== true) return toast(r, 'erreur');
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

  const objet = encodeURIComponent(t('compte.suppression_objet', 'Suppression de mon compte Oralixia'));
  const corps = encodeURIComponent(t('compte.suppression_corps',
    'Bonjour,\n\nJe demande la suppression de mon compte Oralixia.\n\nAdresse du compte : {email}\n\nMerci.')
    .replace('{email}', session.email || ''));
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
