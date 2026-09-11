/* ═══════════════════════════════════════════════════════════
   auth.js — comptes (Supabase Auth)

   Trois façons d'entrer :
   • Google
   • e-mail + mot de passe (inscription et connexion distinctes)
   • lien magique, pour qui ne veut pas de mot de passe

   Sans clés Supabase renseignées, l'application reste utilisable
   en « mode local » : tout demeure dans le navigateur. Mais le
   quota gratuit n'est alors plus rattachable à personne — voir
   EXIGER_CONNEXION dans le README.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, $$, echappe, toast, ouvrirModale, fermerModale } from './ui.js';
import { langue, t, surChangementLangue } from './i18n.js';

export const session = { id: null, email: null, jeton: null, prenom: '', nom: '', pseudo: '', avatar: '', couleur: '' };
export const profil  = { premium: false, plan: null, premiumJusquA: null, stripeClientId: null, telephone: '' };

export let supabase = null;
export const configure = () => Boolean(CONFIG.supabase.url && CONFIG.supabase.anonKey);

/* Au-delà, on cesse d'attendre le CDN et l'application continue. */
const DELAI_CLIENT = 8000;

const abonnes = [];
export const surChangementCompte = fn => { abonnes.push(fn); fn(); };
const prevenir = () => abonnes.forEach(fn => fn());

/** Nom affiché : prénom si connu, sinon la partie locale de l'e-mail. */
/**
 * Nom affiché en haut de page, par ordre de préférence :
 *   1. le pseudonyme, s'il en a choisi un ;
 *   2. « Prénom N. » — l'initiale du nom suffit, et personne n'a envie
 *      de voir son adresse e-mail affichée en permanence ;
 *   3. le prénom seul, puis la partie locale de l'adresse en dernier
 *      recours (compte Google sans prénom renseigné, par exemple).
 */
export function nomAffiche() {
  if (session.pseudo) return session.pseudo;

  const prenom = (session.prenom || '').trim();
  const initiale = (session.nom || '').trim().charAt(0).toUpperCase();
  if (prenom && initiale) return `${prenom} ${initiale}.`;
  if (prenom) return prenom;
  return session.email ? session.email.split('@')[0] : '';
}

/* ── Erreurs renvoyées par les liens Supabase ───────────────
   Un lien de connexion périmé, déjà cliqué, ou pré-chargé par un
   antivirus de messagerie ne ramène pas une session : il ramène
   « #error=access_denied&error_code=otp_expired ». Sans lecture de
   ce fragment, le candidat retombe sur l'accueil, toujours
   déconnecté, sans la moindre explication — le symptôme le plus
   déroutant de toute l'authentification. */
const ERREURS_LIEN = {
  otp_expired: "Ce lien a expiré ou a déjà servi. Un lien de connexion ne fonctionne qu'une fois. Demandez-en un nouveau, ou connectez-vous avec votre mot de passe.",
  access_denied: "Ce lien n'est plus valable. Demandez-en un nouveau, ou connectez-vous avec votre mot de passe.",
  otp_disabled: "La connexion par lien est désactivée sur ce projet.",
  email_link_invalid: "Ce lien est invalide. Demandez-en un nouveau.",
  server_error: "Le service d'authentification n'a pas répondu. Réessayez dans un instant.",
  validation_failed: "Le lien reçu est incomplet. Demandez-en un nouveau."
};

/** Lit une erreur d'authentification dans l'URL, et nettoie celle-ci. */
function erreurDansLUrl() {
  const lire = texte => new URLSearchParams(texte.replace(/^[#?]/, ''));
  const fragment = lire(location.hash);
  const requete = lire(location.search);
  const source = fragment.get('error') || fragment.get('error_code') ? fragment
               : requete.get('error') || requete.get('error_code') ? requete
               : null;
  if (!source) return null;

  const code = source.get('error_code') || source.get('error') || '';
  const description = source.get('error_description') || '';

  // On efface les paramètres d'erreur : rechargement propre, et rien
  // d'illisible qui traîne dans la barre d'adresse.
  if (source === fragment) {
    history.replaceState({}, '', location.pathname + location.search);
  } else {
    ['error', 'error_code', 'error_description'].forEach(c => requete.delete(c));
    const reste = requete.toString();
    history.replaceState({}, '', location.pathname + (reste ? '?' + reste : ''));
  }

  return { code, message: ERREURS_LIEN[code] || description.replace(/\+/g, ' ') || ERREURS_LIEN.access_denied };
}

/* ── Initialisation ────────────────────────────────────────── */
export async function initAuth() {
  brancherBoutons();
  surChangementLangue(code => { majInterface(); retraduireLesYeux(); memoriserLangue(code); });

  // À lire avant tout : le client Supabase nettoie le fragment au passage.
  const echec = erreurDansLUrl();

  if (!configure()) { majInterface(); return; }

  try {
    /* Le client vient d'un CDN. Un import qui ne répond pas ne rejette
       pas forcément : il peut rester en suspens indéfiniment, et toute
       l'initialisation reste alors bloquée sur ce await — en-tête figé
       sur « Connexion », menu de compte jamais dessiné. D'où le délai. */
    const { createClient } = await Promise.race([
      import('https://esm.sh/@supabase/supabase-js@2.45.4'),
      new Promise((_, rejeter) =>
        setTimeout(() => rejeter(new Error('client Supabase injoignable')), DELAI_CLIENT))
    ]);
    supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

    const { data } = await supabase.auth.getSession();
    await appliquerSession(data?.session);

    supabase.auth.onAuthStateChange(async (_evt, s) => { await appliquerSession(s); });
  } catch (e) {
    console.warn('Supabase indisponible, mode local activé.', e);
  }
  majInterface();

  // Le lien a échoué et aucune session ne s'est ouverte : on le dit, et on
  // rouvre la modale plutôt que de laisser l'accueil muet.
  if (echec && !session.email) {
    toast(t('auth.erreur_' + echec.code, echec.message), 'erreur');
    ouvrirAuth('connexion');
    dire(t('auth.erreur_' + echec.code, echec.message), true);
  }
}

async function appliquerSession(s) {
  if (s?.user) {
    session.id = s.user.id;
    session.email = s.user.email;
    session.jeton = s.access_token;
    const m = s.user.user_metadata || {};
    session.prenom = m.prenom || m.first_name || m.given_name || '';
    session.nom = m.nom || m.last_name || m.family_name || '';
    // Google renseigne avatar_url ou picture ; ailleurs, on affiche une silhouette.
    session.avatar = m.avatar_url || m.picture || '';
    session.pseudo = (m.pseudo || '').trim();
    session.couleur = m.couleur || '';
    await chargerProfil();
  } else {
    session.id = session.email = session.jeton = null;
    session.prenom = session.nom = session.pseudo = session.avatar = session.couleur = '';
    profil.premium = false; profil.plan = null; profil.premiumJusquA = null;
  }
  majInterface();
  prevenir();

  if (session.email) {
    // Connexion réussie : on referme la modale et on relance ce qui attendait.
    if (!$('#modal-auth')?.hidden) fermerModale('modal-auth');
    libererAttentes();
  }
}

async function chargerProfil() {
  if (!supabase || !session.id) return;
  try {
    const { data } = await supabase
      .from('profils')
      .select('premium, plan, premium_jusqu_au, stripe_client_id, telephone, pseudo, couleur, avatar_url')
      .eq('id', session.id)
      .maybeSingle();
    if (data) {
      const encoreValide = !data.premium_jusqu_au || new Date(data.premium_jusqu_au).getTime() > Date.now();
      profil.premium = Boolean(data.premium) && encoreValide;
      profil.plan = data.plan || null;
      profil.premiumJusquA = data.premium_jusqu_au || null;
      profil.stripeClientId = data.stripe_client_id || null;
      profil.telephone = data.telephone || '';

      /* La base complète ce que les métadonnées ne portent pas : un
         compte créé avant l'ajout du pseudonyme, ou modifié depuis un
         autre appareil, retrouve ainsi ses réglages. */
      session.pseudo = session.pseudo || data.pseudo || '';
      session.couleur = session.couleur || data.couleur || '';
      session.avatar = session.avatar || data.avatar_url || '';
    }
  } catch (e) { console.warn('Profil non chargé', e); }
}

/** Garde la langue du compte à jour côté Supabase.
    Les modèles d'e-mail lisent les métadonnées enregistrées, pas la
    langue de la page : sans cela, un message de réinitialisation de
    mot de passe repartirait dans la langue choisie à l'inscription. */
async function memoriserLangue(code) {
  if (!supabase || !session.id || !code) return;
  try { await supabase.auth.updateUser({ data: { langue: code } }); }
  catch (e) { console.warn('Langue du compte non enregistrée', e); }
}

/* ── Messages d'erreur lisibles ────────────────────────────── */
const MESSAGES = {
  'Invalid login credentials': "E-mail ou mot de passe incorrect.",
  'User already registered': "Un compte existe déjà avec cette adresse. Connectez-vous plutôt.",
  'Email not confirmed': "Confirmez d'abord votre adresse : le lien est dans votre boîte mail.",
  'Password should be at least 6 characters': 'Le mot de passe doit faire au moins 8 caractères.'
};
const lisible = e => MESSAGES[e?.message] || e?.message || 'Une erreur est survenue.';

/* Où revenir après authentification : sur son espace, pas sur l'accueil. */
const retour = () => new URL('./index.html?vue=compte', location.href).href;

/** Métadonnées jointes au compte : le prénom, et la langue de l'interface,
    que les modèles d'e-mail Supabase peuvent lire via {{ .Data.langue }}. */
const donnees = (extra = {}) => ({ langue: langue(), ...extra });

/* ── Actions ───────────────────────────────────────────────── */
/* ── Google ────────────────────────────────────────────────
   Quand le fournisseur n'est pas activé côté Supabase, la
   redirection n'atterrit pas chez Google : elle atterrit sur une
   réponse JSON brute — « Unsupported provider: provider is not
   enabled » — que le navigateur affiche telle quelle. Sur un
   écran sombre, cela ressemble à une page noire, et le candidat
   n'a plus qu'à revenir en arrière sans rien comprendre.

   On demande donc l'URL sans naviguer, on la sonde, et on ne
   quitte la page que si elle mène vraiment quelque part. Une
   redirection renvoie une réponse opaque ; une erreur renvoie un
   400 lisible. */
export async function connexionGoogle() {
  if (!supabase) return toast(t('auth.supabase_absent', "Connexion indisponible : Supabase n'est pas configuré."), 'erreur');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: retour(), skipBrowserRedirect: true }
  });
  if (error) return dire(lisible(error), true);
  if (!data?.url) return dire(t('auth.google_indisponible', MESSAGE_GOOGLE), true);

  const probleme = await sonderOAuth(data.url);
  if (probleme) return dire(probleme, true);

  location.assign(data.url);
}

const MESSAGE_GOOGLE = "La connexion Google n'est pas encore activée sur ce site. Utilisez votre adresse e-mail et votre mot de passe, ou le lien sans mot de passe.";

/**
 * Sonde l'URL d'autorisation sans la suivre.
 * @returns {Promise<string|null>} un message à afficher, ou null si la voie est libre.
 */
async function sonderOAuth(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit' });

    // Une redirection vers Google : réponse opaque, statut 0. C'est le cas normal.
    if (r.type === 'opaqueredirect' || r.status === 0 || (r.status >= 300 && r.status < 400)) return null;

    if (r.status >= 400) {
      const corps = await r.json().catch(() => ({}));
      const brut = String(corps.msg || corps.error_description || corps.message || '');
      if (/not enabled|unsupported provider/i.test(brut)) {
        return t('auth.google_indisponible', MESSAGE_GOOGLE);
      }
      return brut || t('auth.google_indisponible', MESSAGE_GOOGLE);
    }
    return null;
  } catch {
    /* Le réseau, un bloqueur ou une politique inter-origines ont empêché
       la sonde : ce n'est pas une preuve de panne. On laisse passer
       plutôt que d'interdire une connexion qui marcherait. */
    return null;
  }
}

/** Inscription par e-mail et mot de passe.
    @returns {Promise<false|{confirmationRequise:boolean, dejaInscrit?:boolean}>} */
export async function inscription({ prenom, nom, pseudo, email, motDePasse }) {
  if (!supabase) { toast("Inscription indisponible : Supabase n'est pas configuré.", 'erreur'); return false; }
  const { data, error } = await supabase.auth.signUp({
    email,
    password: motDePasse,
    options: { data: donnees({ prenom, nom, pseudo: (pseudo || '').trim() }), emailRedirectTo: retour() }
  });
  if (error) { toast(lisible(error), 'erreur'); return false; }

  /* Adresse déjà inscrite et confirmée : pour ne pas révéler qui possède
     un compte, Supabase répond « succès » avec un utilisateur factice, et
     n'envoie AUCUN message. Le seul indice est identities, qui revient
     vide. Sans ce test, on affiche « regardez votre boîte mail » alors que
     rien n'a été envoyé — et le candidat attend un message qui ne viendra
     jamais. */
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { confirmationRequise: false, dejaInscrit: true };
  }

  /* Quand la confirmation par e-mail est active, signUp ne renvoie pas de
     session : le compte n'existe vraiment qu'après le clic dans le message. */
  if (!data.session) {
    return { confirmationRequise: true };
  }
  return { confirmationRequise: false };
}

/** Connexion par e-mail et mot de passe. */
export async function connexionMotDePasse(email, motDePasse) {
  if (!supabase) { toast("Connexion indisponible : Supabase n'est pas configuré.", 'erreur'); return false; }
  const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) { toast(lisible(error), 'erreur'); return false; }
  return true;
}

/** Lien magique, pour qui ne veut pas retenir de mot de passe. */
export async function connexionEmail(email) {
  if (!estEmail(email)) return toast('Saisissez une adresse e-mail valide.', 'erreur');
  if (!supabase) return toast("Connexion indisponible : Supabase n'est pas configuré.", 'erreur');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { data: donnees(), emailRedirectTo: retour() }
  });
  if (error) return dire(lisible(error), true);
  dire(t('auth.lien_envoye', 'Lien envoyé. Ouvrez votre boîte mail pour vous connecter.'));
}

/** Réinitialisation du mot de passe. */
export async function motDePasseOublie(email) {
  if (!estEmail(email)) return toast('Saisissez votre adresse e-mail au-dessus.', 'erreur');
  if (!supabase) return toast("Indisponible : Supabase n'est pas configuré.", 'erreur');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: retour() });
  toast(error ? lisible(error) : 'Message envoyé : suivez le lien pour choisir un nouveau mot de passe.',
        error ? 'erreur' : 'succes');
}

export async function deconnexion() {
  if (supabase) await supabase.auth.signOut();
  await appliquerSession(null);
  toast(t('auth.deconnecte', 'Vous êtes déconnecté.'));
}

export const estEmail = e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test((e || '').trim());

/** Force minimale : huit caractères. Au-delà, on informe sans bloquer. */
export function forceMotDePasse(mdp = '') {
  const n = mdp.length;
  if (n === 0) return { valide: false, niveau: 0, message: '' };
  if (n < 8) return { valide: false, niveau: 1,
    message: t('auth.force_court', 'Trop court : huit caractères au minimum.') };

  const varietes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(mdp)).length;
  if (varietes <= 1 || n < 10) return { valide: true, niveau: 2,
    message: t('auth.force_moyen', 'Correct. Un chiffre et une majuscule le rendraient plus solide.') };
  return { valide: true, niveau: 3, message: t('auth.force_bon', 'Bon mot de passe.') };
}

/* ── Exiger un compte avant une action ─────────────────────
   Le simulateur appelle ceci avant de lancer quoi que ce soit :
   sans compte, le quota gratuit ne tient pas (il suffirait de
   vider son navigateur pour repartir à zéro). La promesse se
   résout à true dès que la session existe, false si la modale
   est fermée sans se connecter. */
export function exigerCompte(raison = '') {
  if (session.email) return Promise.resolve(true);

  // Sans Supabase configuré, l'application tourne en mode local :
  // on ne peut demander un compte qui n'existe pas.
  if (!configure()) return Promise.resolve(true);

  ouvrirAuth('inscription');

  const message = $('#auth-raison');
  if (message) {
    message.textContent = raison || t('auth.raison_simulation',
      'Créez votre compte gratuit pour lancer votre simulation : vos deux simulations offertes y sont rattachées.');
    message.classList.remove('hidden');
  }

  return new Promise(resolve => {
    let fini = false;
    const terminer = valeur => {
      if (fini) return;
      fini = true;
      document.removeEventListener('preporal:modale-fermee', surFermeture);
      resolve(valeur);
    };
    const surFermeture = () => { if (!session.email) terminer(false); };

    attentes.push(() => terminer(true));
    document.addEventListener('preporal:modale-fermee', surFermeture);
  });
}

/* Rappels à exécuter dès qu'une session s'ouvre. */
const attentes = [];
function libererAttentes() {
  while (attentes.length) attentes.shift()();
}

/* ── Interface ─────────────────────────────────────────────── */
export function majInterface() {
  const connecte = Boolean(session.email);

  majBoutonCompte(connecte);
  majCarteCompte(connecte);

  // Les deux boutons d'entrée disparaissent une fois connecté.
  $('#btn-connexion-2')?.classList.toggle('hidden', connecte);
  $('#btn-inscription-2')?.classList.toggle('hidden', connecte);
  $('#btn-deconnexion')?.classList.toggle('hidden', !connecte);
  $('#btn-portail')?.classList.toggle('hidden', !(connecte && profil.premium));

  const textePremium = $('#texte-premium');
  if (textePremium && profil.premium) {
    textePremium.textContent = profil.premiumJusquA
      ? t('compte.actif_jusquau', "Actif jusqu'au {date}")
          .replace('{date}', new Date(profil.premiumJusquA).toLocaleDateString(langue() === 'fr' ? 'fr-FR' : langue()))
      : t('compte.abonnement_actif', 'Abonnement actif. Merci !');
    const btnPremium = $('#btn-premium');
    if (btnPremium) btnPremium.textContent = t('accueil.gerer_mon_abonnement', 'Gérer mon abonnement');
  }
}

/* Silhouette par défaut : le jour où une photo de profil sera
   téléversée, il suffira de renseigner session.avatar. Les comptes
   Google en apportent déjà une. */
/* La silhouette occupait 60 % de la pastille : trop grande, elle
   débordait visuellement du cercle. 52 % la laisse respirer. */
const SILHOUETTE = '<svg viewBox="0 0 24 24" width="52%" height="52%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

/* Huit teintes, toutes assez sombres pour qu'une silhouette blanche
   s'y détache. Deux personnes peuvent partager la même : le but est
   de ne pas voir huit pastilles violettes identiques, pas d'attribuer
   une couleur unique à chacun. */
export const COULEURS_AVATAR = {
  iris:   '#7C5CFF',
  ocean:  '#2563EB',
  menthe: '#0E9F6E',
  ambre:  '#B45309',
  corail: '#DC2626',
  rose:   '#DB2777',
  prune:  '#7E22CE',
  ardoise:'#475569'
};
const NOMS_COULEURS = Object.keys(COULEURS_AVATAR);

/** Couleur d'un compte : celle qu'il a choisie, sinon une tirée de son identifiant. */
export function couleurAvatar(id = session.id, choix = session.couleur) {
  if (choix && COULEURS_AVATAR[choix]) return COULEURS_AVATAR[choix];
  const graine = String(id || session.email || '?');
  let somme = 0;
  for (let i = 0; i < graine.length; i++) somme = (somme * 31 + graine.charCodeAt(i)) >>> 0;
  return COULEURS_AVATAR[NOMS_COULEURS[somme % NOMS_COULEURS.length]];
}

/** Pastille de compte : photo si on en a une, silhouette colorée sinon. */
function avatar(taille) {
  if (session.avatar) {
    return `<img src="${echappe(session.avatar)}" alt="" referrerpolicy="no-referrer"
      class="${taille} shrink-0 rounded-full border border-line object-cover">`;
  }
  return `<span class="${taille} grid shrink-0 place-items-center rounded-full text-white"
    style="background:${couleurAvatar()}">${SILHOUETTE}</span>`;
}

/** Le bouton d'en-tête devient un menu de compte une fois connecté. */
function majBoutonCompte(connecte) {
  const btn = $('#btn-compte');
  if (!btn) return;

  if (!connecte) {
    btn.innerHTML = `<span>${t('accueil.connexion', 'Connexion')}</span>`;
    btn.className = 'hidden rounded-lg px-3 py-2 text-sm text-muted transition hover:text-soft sm:block';
    btn.setAttribute('aria-label', t('auth.se_connecter', 'Se connecter'));
    btn.setAttribute('aria-expanded', 'false');
    $('#menu-compte')?.classList.add('hidden');
    return;
  }

  btn.innerHTML = `
    ${avatar('h-7 w-7')}
    <span class="hidden max-w-[9rem] truncate sm:inline">${echappe(nomAffiche())}</span>`;
  btn.className = 'flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm transition hover:border-iris/50';
  btn.setAttribute('aria-label', t('compte.mon_compte', 'Mon compte'));
  btn.setAttribute('aria-haspopup', 'menu');

  const menu = $('#menu-compte');
  if (!menu) return;
  menu.innerHTML = `
    <p class="border-b border-line px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wider text-muted">
      ${echappe(t('compte.mon_compte', 'Mon compte'))}
    </p>
    <div class="flex items-start gap-3 border-b border-line px-4 py-3">
      ${avatar('h-10 w-10 shrink-0')}
      <div class="min-w-0">
        <p class="truncate font-display text-sm font-bold">${echappe(nomAffiche() + (session.nom ? ' ' + session.nom : ''))}</p>
        <p class="mt-0.5 truncate text-xs text-muted">${echappe(session.email)}</p>
        <p class="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${
          profil.premium ? 'border-mint/50 bg-mint/10 text-mint' : 'border-line text-muted'}">
          ${echappe(profil.premium
            ? t('compte.premium_actif', 'Premium actif')
            : t('compte.offre_gratuite', 'Offre gratuite'))}
        </p>
      </div>
    </div>
    <a href="./compte.html" role="menuitem" class="block px-4 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-soft">${echappe(t('compte.gerer_mon_compte', 'Gérer mon compte'))}</a>
    <a href="./index.html?vue=compte" role="menuitem" class="block px-4 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-soft">${echappe(t('accueil.mes_simulations_passees', 'Mes simulations passées'))}</a>
    <button type="button" data-compte="abonnement" role="menuitem" class="block w-full px-4 py-2.5 text-left text-sm text-muted transition hover:bg-raised hover:text-soft">
      ${echappe(profil.premium
        ? t('accueil.gerer_mon_abonnement', 'Gérer mon abonnement')
        : t('accueil.voir_les_offres', 'Voir les offres'))}
    </button>
    <button type="button" data-compte="deconnexion" role="menuitem" class="block w-full border-t border-line px-4 py-2.5 text-left text-sm text-muted transition hover:bg-raised hover:text-coral">${echappe(t('accueil.se_deconnecter', 'Se déconnecter'))}</button>`;
}

function majCarteCompte(connecte) {
  const etat = $('#etat-compte');
  if (!etat) return;

  if (!configure()) {
    etat.textContent = t('compte.mode_local',
      'Mode local : votre historique est enregistré dans ce navigateur uniquement. Renseignez vos clés Supabase pour synchroniser vos appareils.');
  } else if (connecte) {
    etat.innerHTML = `<span class="flex items-start gap-3">
        ${avatar('h-11 w-11')}
        <span class="min-w-0">
          <span class="block truncate font-medium text-soft">${echappe(nomAffiche() + (session.nom ? ' ' + session.nom : ''))}</span>
          <span class="block truncate text-xs">${echappe(session.email)}</span>
          <span class="block text-xs">${echappe(profil.premium
            ? t('compte.premium_actif', 'Premium actif')
            : t('compte.offre_gratuite', 'Offre gratuite'))}</span>
        </span>
      </span>`;
  } else {
    etat.textContent = t('accueil.vous_n_etes_pas_connecte', "Vous n'êtes pas connecté.");
  }
}

/* ── Câblage ───────────────────────────────────────────────── */
function brancherBoutons() {
  // Menu de compte de l'en-tête.
  $('#btn-compte')?.addEventListener('click', e => {
    e.stopPropagation();
    if (!session.email) { ouvrirAuth('connexion'); return; }
    const menu = $('#menu-compte');
    const ouvert = menu?.classList.toggle('hidden') === false;
    $('#btn-compte').setAttribute('aria-expanded', String(ouvert));
  });
  document.addEventListener('click', () => fermerMenuCompte());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fermerMenuCompte(); });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-compte]');
    if (!b) return;
    if (b.dataset.compte === 'deconnexion') deconnexion();
    if (b.dataset.compte === 'abonnement') {
      fermerMenuCompte();
      ($('#btn-portail') && profil.premium ? $('#btn-portail') : $('#btn-premium'))?.click();
    }
  });

  $('#btn-connexion-2')?.addEventListener('click', () => ouvrirAuth('connexion'));
  $('#btn-inscription-2')?.addEventListener('click', () => ouvrirAuth('inscription'));
  $('#btn-google')?.addEventListener('click', connexionGoogle);
  $('#btn-deconnexion')?.addEventListener('click', deconnexion);

  brancherModale();

  // compte.html modifie le profil : l'en-tête doit suivre sans rechargement.
  document.addEventListener('preporal:compte-modifie', majInterface);
}

/* ── Afficher / masquer un mot de passe ─────────────────────
   Un mot de passe qu'on ne peut pas relire se tape deux fois de
   travers, et la confirmation ne sert alors qu'à répéter la même
   faute de frappe. L'œil est ajouté en JavaScript pour que les
   trois champs, sur les trois pages, se comportent pareil. */
const OEIL_OUVERT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const OEIL_BARRE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a15.8 15.8 0 0 1-2.8 3.6M6.6 6.6A15.9 15.9 0 0 0 2 13s3.6 7 10 7a9.7 9.7 0 0 0 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/></svg>';

function brancherOeil(champ) {
  if (!champ || champ.dataset.oeil) return;
  champ.dataset.oeil = '1';

  // Le bouton se pose dans l'encadré : il faut un parent positionné.
  const enveloppe = document.createElement('div');
  enveloppe.className = 'relative';
  champ.parentNode.insertBefore(enveloppe, champ);
  enveloppe.appendChild(champ);
  champ.classList.add('pr-12');

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted transition hover:text-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-iris';
  bouton.innerHTML = OEIL_OUVERT;
  bouton.setAttribute('aria-pressed', 'false');
  // Le bouton ne doit pas être un jalon de tabulation entre les champs.
  bouton.tabIndex = -1;
  bouton.dataset.oeilPour = champ.id;

  bouton.addEventListener('click', () => {
    const visible = champ.type === 'password';
    champ.type = visible ? 'text' : 'password';
    bouton.innerHTML = visible ? OEIL_BARRE : OEIL_OUVERT;
    bouton.setAttribute('aria-pressed', String(visible));
    etiqueterOeil(bouton);
    // On rend la main au champ, au bon endroit dans la saisie.
    const fin = champ.value.length;
    champ.focus();
    try { champ.setSelectionRange(fin, fin); } catch {}
  });

  enveloppe.appendChild(bouton);
  etiqueterOeil(bouton);
  return bouton;
}

/** Libellé d'un œil, selon son état et la langue courante. */
function etiqueterOeil(bouton) {
  const libelle = bouton.getAttribute('aria-pressed') === 'true'
    ? t('auth.masquer_mot_de_passe', 'Masquer le mot de passe')
    : t('auth.afficher_mot_de_passe', 'Afficher le mot de passe');
  bouton.setAttribute('aria-label', libelle);
  bouton.title = libelle;
}

/* Ces boutons sont créés en JavaScript : appliquerTraductions() ne les
   voit pas, il faut les réétiqueter à la main. */
const retraduireLesYeux = () => $$('[data-oeil-pour]').forEach(etiqueterOeil);

/** Remet tous les champs en « masqué » à l'ouverture de la modale. */
function masquerLesMotsDePasse() {
  $$('#modal-auth input[type="text"][data-oeil], #modal-auth input[type="password"][data-oeil]')
    .forEach(champ => {
      if (champ.type !== 'password') champ.parentNode.querySelector('button')?.click();
    });
}

function fermerMenuCompte() {
  $('#menu-compte')?.classList.add('hidden');
  $('#btn-compte')?.setAttribute('aria-expanded', 'false');
}

/* ── Les deux formulaires de la modale ─────────────────────── */
function brancherModale() {
  ['#auth-motdepasse', '#inscr-motdepasse', '#inscr-confirmation'].forEach(sel => brancherOeil($(sel)));

  $$('[data-onglet-auth]').forEach(b =>
    b.addEventListener('click', () => basculerOnglet(b.dataset.ongletAuth)));

  /* ─ Connexion ─ */
  const btnConnexion = $('#btn-connexion-mdp');
  btnConnexion?.addEventListener('click', async () => {
    const email = $('#auth-email')?.value.trim() || '';
    const mdp = $('#auth-motdepasse')?.value || '';
    if (!estEmail(email)) return dire(t('auth.email_invalide', 'Saisissez une adresse e-mail valide.'), true);
    if (!mdp) return dire(t('auth.mdp_requis', 'Saisissez votre mot de passe.'), true);

    await pendant(btnConnexion, t('auth.connexion_en_cours', 'Connexion…'), async () => {
      if (await connexionMotDePasse(email, mdp)) {
        toast(t('auth.bienvenue', 'Vous voilà connecté.'), 'succes');
      }
    });
  });

  $('#btn-lien-magique')?.addEventListener('click', () =>
    connexionEmail($('#auth-email')?.value.trim() || ''));

  $('#btn-oubli')?.addEventListener('click', () =>
    motDePasseOublie($('#auth-email')?.value.trim() || ''));

  /* ─ Inscription ─ */
  $('#inscr-motdepasse')?.addEventListener('input', e => {
    const p = $('#force-motdepasse');
    if (!p) return;
    const f = forceMotDePasse(e.target.value);
    p.textContent = f.message;
    p.className = 'mt-2 text-xs ' + (f.niveau >= 3 ? 'text-mint' : f.niveau === 2 ? 'text-amber' : f.niveau === 1 ? 'text-coral' : 'text-muted');
  });

  const btnInscrire = $('#btn-inscrire');
  btnInscrire?.addEventListener('click', async () => {
    const prenom = $('#inscr-prenom')?.value.trim() || '';
    const nom = $('#inscr-nom')?.value.trim() || '';
    const pseudo = $('#inscr-pseudo')?.value.trim() || '';
    const email = $('#inscr-email')?.value.trim() || '';
    const mdp = $('#inscr-motdepasse')?.value || '';
    const confirmation = $('#inscr-confirmation')?.value || '';

    if (!prenom) return dire(t('auth.prenom_requis', 'Indiquez votre prénom.'), true, '#inscr-prenom');
    if (!estEmail(email)) return dire(t('auth.email_invalide', 'Saisissez une adresse e-mail valide.'), true, '#inscr-email');
    if (!forceMotDePasse(mdp).valide)
      return dire(t('auth.force_court', 'Trop court : huit caractères au minimum.'), true, '#inscr-motdepasse');
    if (mdp !== confirmation)
      return dire(t('auth.confirmation_differente', 'Les deux mots de passe ne correspondent pas.'), true, '#inscr-confirmation');

    await pendant(btnInscrire, t('auth.creation_en_cours', 'Création du compte…'), async () => {
      const r = await inscription({ prenom, nom, pseudo, email, motDePasse: mdp });
      if (!r) return;

      if (r.dejaInscrit) {
        // On bascule sur la connexion, adresse déjà remplie : c'est ce
        // qu'il faut faire, et personne n'a envie de la retaper.
        basculerOnglet('connexion');
        const champ = $('#auth-email');
        if (champ) champ.value = email;
        dire(t('auth.deja_inscrit',
          'Cette adresse a déjà un compte. Connectez-vous, ou utilisez « Mot de passe oublié ? ».'), true);
        $('#auth-motdepasse')?.focus();
        return;
      }

      if (r.confirmationRequise) {
        dire(t('auth.confirmez_boite_mail',
          'Compte créé. Ouvrez votre boîte mail et cliquez sur le lien pour l’activer. Regardez aussi dans les indésirables.'));
      } else {
        toast(t('auth.compte_cree', 'Compte créé. Vos deux simulations gratuites vous attendent.'), 'succes');
      }
    });
  });

  // Entrée valide le formulaire visible.
  $('#modal-auth')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const inscription = !$('#form-inscription')?.classList.contains('hidden');
    (inscription ? $('#btn-inscrire') : $('#btn-connexion-mdp'))?.click();
  });
}

/** Message sous les formulaires, et focus sur le champ fautif. */
function dire(texte, erreur = false, focus = null) {
  const msg = $('#auth-message');
  if (msg) {
    msg.textContent = texte;
    msg.className = 'mt-3 text-sm ' + (erreur ? 'text-coral' : 'text-mint');
  }
  if (focus) $(focus)?.focus();
}

/** Désactive un bouton le temps d'un aller-retour réseau. */
async function pendant(bouton, texte, action) {
  const initial = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = texte;
  try { await action(); }
  finally { bouton.disabled = false; bouton.textContent = initial; }
}

/* ── Modale : deux onglets ─────────────────────────────────── */
export function ouvrirAuth(onglet = 'connexion') {
  basculerOnglet(onglet);
  masquerLesMotsDePasse();
  ouvrirModale('modal-auth');
  // Ouvert sans motif particulier : on efface l'invite d'une fois précédente.
  const raison = $('#auth-raison');
  if (raison && !raison.dataset.garder) { raison.textContent = ''; raison.classList.add('hidden'); }
}

export function basculerOnglet(onglet) {
  const inscription = onglet === 'inscription';
  $$('[data-onglet-auth]').forEach(b => {
    const actif = b.dataset.ongletAuth === onglet;
    b.classList.toggle('bg-iris', actif);
    b.classList.toggle('text-white', actif);
    b.classList.toggle('text-muted', !actif);
    b.setAttribute('aria-selected', String(actif));
  });
  $('#form-connexion')?.classList.toggle('hidden', inscription);
  $('#form-inscription')?.classList.toggle('hidden', !inscription);

  const titre = $('#auth-titre');
  if (titre) titre.textContent = inscription
    ? t('auth.creer_mon_compte', 'Créer mon compte')
    : t('auth.se_connecter', 'Se connecter');

  const msg = $('#auth-message');
  if (msg) { msg.textContent = ''; msg.className = 'mt-3 text-sm text-muted'; }
}

export { fermerModale };
