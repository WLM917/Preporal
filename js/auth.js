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

export const session = { id: null, email: null, jeton: null, prenom: '', nom: '' };
export const profil  = { premium: false, plan: null, premiumJusquA: null, stripeClientId: null };

export let supabase = null;
export const configure = () => Boolean(CONFIG.supabase.url && CONFIG.supabase.anonKey);

const abonnes = [];
export const surChangementCompte = fn => { abonnes.push(fn); fn(); };
const prevenir = () => abonnes.forEach(fn => fn());

/** Nom affiché : prénom si connu, sinon la partie locale de l'e-mail. */
export const nomAffiche = () =>
  session.prenom || (session.email ? session.email.split('@')[0] : '');

/* ── Initialisation ────────────────────────────────────────── */
export async function initAuth() {
  brancherBoutons();
  surChangementLangue(majInterface);
  if (!configure()) { majInterface(); return; }

  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

    const { data } = await supabase.auth.getSession();
    await appliquerSession(data?.session);

    supabase.auth.onAuthStateChange(async (_evt, s) => { await appliquerSession(s); });
  } catch (e) {
    console.warn('Supabase indisponible, mode local activé.', e);
  }
  majInterface();
}

async function appliquerSession(s) {
  if (s?.user) {
    session.id = s.user.id;
    session.email = s.user.email;
    session.jeton = s.access_token;
    const m = s.user.user_metadata || {};
    session.prenom = m.prenom || m.first_name || m.given_name || '';
    session.nom = m.nom || m.last_name || m.family_name || '';
    await chargerProfil();
  } else {
    session.id = session.email = session.jeton = null;
    session.prenom = session.nom = '';
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
      .select('premium, plan, premium_jusqu_au, stripe_client_id')
      .eq('id', session.id)
      .maybeSingle();
    if (data) {
      const encoreValide = !data.premium_jusqu_au || new Date(data.premium_jusqu_au).getTime() > Date.now();
      profil.premium = Boolean(data.premium) && encoreValide;
      profil.plan = data.plan || null;
      profil.premiumJusquA = data.premium_jusqu_au || null;
      profil.stripeClientId = data.stripe_client_id || null;
    }
  } catch (e) { console.warn('Profil non chargé', e); }
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
export async function connexionGoogle() {
  if (!supabase) return toast("Connexion indisponible : Supabase n'est pas configuré.", 'erreur');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: retour() }
  });
  if (error) toast(lisible(error), 'erreur');
}

/** Inscription par e-mail et mot de passe. */
export async function inscription({ prenom, nom, email, motDePasse }) {
  if (!supabase) { toast("Inscription indisponible : Supabase n'est pas configuré.", 'erreur'); return false; }
  const { data, error } = await supabase.auth.signUp({
    email,
    password: motDePasse,
    options: { data: donnees({ prenom, nom }), emailRedirectTo: retour() }
  });
  if (error) { toast(lisible(error), 'erreur'); return false; }

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

  const initiale = (nomAffiche()[0] || '?').toUpperCase();
  btn.innerHTML = `
    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-iris text-xs font-bold text-white">${initiale}</span>
    <span class="hidden max-w-[9rem] truncate sm:inline">${nomAffiche()}</span>`;
  btn.className = 'flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm transition hover:border-iris/50';
  btn.setAttribute('aria-label', t('compte.mon_compte', 'Mon compte'));
  btn.setAttribute('aria-haspopup', 'menu');

  const menu = $('#menu-compte');
  if (!menu) return;
  menu.innerHTML = `
    <div class="border-b border-line px-4 py-3">
      <p class="truncate font-display text-sm font-bold">${echappe(nomAffiche() + (session.nom ? ' ' + session.nom : ''))}</p>
      <p class="mt-0.5 truncate text-xs text-muted">${echappe(session.email)}</p>
      <p class="mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${
        profil.premium ? 'border-mint/50 bg-mint/10 text-mint' : 'border-line text-muted'}">
        ${echappe(profil.premium
          ? t('compte.premium_actif', 'Premium actif')
          : t('compte.offre_gratuite', 'Offre gratuite'))}
      </p>
    </div>
    <a href="./index.html?vue=compte" role="menuitem" class="block px-4 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-soft">${echappe(t('compte.gerer_mon_compte', 'Gérer mon compte'))}</a>
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
    etat.innerHTML = `<span class="font-medium text-soft">${echappe(nomAffiche() + (session.nom ? ' ' + session.nom : ''))}</span>`
      + `<br><span class="text-xs">${echappe(session.email)}</span>`
      + `<br><span class="text-xs">${echappe(profil.premium
          ? t('compte.premium_actif', 'Premium actif')
          : t('compte.offre_gratuite', 'Offre gratuite'))}</span>`;
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
}

function fermerMenuCompte() {
  $('#menu-compte')?.classList.add('hidden');
  $('#btn-compte')?.setAttribute('aria-expanded', 'false');
}

/* ── Les deux formulaires de la modale ─────────────────────── */
function brancherModale() {
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
      const r = await inscription({ prenom, nom, email, motDePasse: mdp });
      if (!r) return;
      if (r.confirmationRequise) {
        dire(t('auth.confirmez_boite_mail',
          'Compte créé. Ouvrez votre boîte mail et cliquez sur le lien pour l’activer.'));
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
