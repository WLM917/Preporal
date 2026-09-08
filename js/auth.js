/* ═══════════════════════════════════════════════════════════
   auth.js — espace membre (Supabase Auth)
   Sans clés Supabase renseignées, l'application fonctionne en
   « mode local » : tout reste dans le navigateur.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, toast, ouvrirModale, fermerModale } from './ui.js';

export const session = { id: null, email: null, jeton: null };
export const profil  = { premium: false, plan: null, premiumJusquA: null, stripeClientId: null };

export let supabase = null;
export const configure = () => Boolean(CONFIG.supabase.url && CONFIG.supabase.anonKey);

const abonnes = [];
export const surChangementCompte = fn => { abonnes.push(fn); fn(); };
const prevenir = () => abonnes.forEach(fn => fn());

/* ── Initialisation ────────────────────────────────────────── */
export async function initAuth() {
  brancherBoutons();
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
    await chargerProfil();
  } else {
    session.id = session.email = session.jeton = null;
    profil.premium = false; profil.plan = null; profil.premiumJusquA = null;
  }
  majInterface();
  prevenir();
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

/* ── Actions ───────────────────────────────────────────────── */
export async function connexionGoogle() {
  if (!supabase) return toast("Connexion indisponible : Supabase n'est pas configuré.", 'erreur');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast(error.message, 'erreur');
}

export async function connexionEmail(email) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    return toast('Saisissez une adresse e-mail valide.', 'erreur');
  }
  if (!supabase) return toast("Connexion indisponible : Supabase n'est pas configuré.", 'erreur');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  const msg = $('#auth-message');
  if (error) { if (msg) msg.textContent = error.message; return; }
  if (msg) msg.textContent = 'Lien envoyé. Ouvrez votre boîte mail pour vous connecter.';
}

export async function deconnexion() {
  if (supabase) await supabase.auth.signOut();
  await appliquerSession(null);
  toast('Vous êtes déconnecté.');
}

/* ── Interface ─────────────────────────────────────────────── */
export function majInterface() {
  const btn = $('#btn-compte');
  const etat = $('#etat-compte');
  const connecte = Boolean(session.email);

  if (btn) btn.textContent = connecte ? (session.email.split('@')[0]) : 'Connexion';

  if (etat) {
    if (!configure()) {
      etat.innerHTML = 'Mode local : votre historique est enregistré dans ce navigateur uniquement.<br>Renseignez vos clés Supabase pour synchroniser vos appareils.';
    } else if (connecte) {
      etat.textContent = `Connecté avec ${session.email}` + (profil.premium ? ' · Premium actif' : ' · offre gratuite');
    } else {
      etat.textContent = "Vous n'êtes pas connecté.";
    }
  }

  $('#btn-connexion-2')?.classList.toggle('hidden', connecte);
  $('#btn-deconnexion')?.classList.toggle('hidden', !connecte);
  $('#btn-portail')?.classList.toggle('hidden', !(connecte && profil.premium));

  const cartePremium = $('#carte-premium');
  const textePremium = $('#texte-premium');
  if (cartePremium && textePremium) {
    if (profil.premium) {
      textePremium.textContent = profil.premiumJusquA
        ? 'Actif jusqu\'au ' + new Date(profil.premiumJusquA).toLocaleDateString('fr-FR')
        : 'Abonnement actif. Merci !';
      $('#btn-premium').textContent = 'Gérer mon abonnement';
    }
  }
}

function brancherBoutons() {
  $('#btn-compte')?.addEventListener('click', () => {
    if (session.email) { document.querySelector('[data-vue="compte"]')?.click(); }
    else ouvrirModale('modal-auth');
  });
  $('#btn-connexion-2')?.addEventListener('click', () => ouvrirModale('modal-auth'));
  $('#btn-google')?.addEventListener('click', connexionGoogle);
  $('#btn-lien-magique')?.addEventListener('click', () => connexionEmail($('#auth-email')?.value.trim()));
  $('#auth-email')?.addEventListener('keydown', e => { if (e.key === 'Enter') connexionEmail(e.target.value.trim()); });
  $('#btn-deconnexion')?.addEventListener('click', deconnexion);
}

export { fermerModale };
