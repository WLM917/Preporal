/* ═══════════════════════════════════════════════════════════
   app.js — chef d'orchestre de PrepOral
   ═══════════════════════════════════════════════════════════ */

import { TYPES_ORAL, typeParId } from './config.js';
import { $, $$, echappe, formaterTemps, compterMots, toast, brancherReglages, reglerGroupe, ouvrirModale } from './ui.js';
import { Voix, Dictee, dicteeSupportee, langueDeLEpreuve } from './speech.js';
import { brancherDepot } from './upload.js';
import { genererQuestions, modeDemo as demoQuestions, ErreurQuota } from './questions.js';
import { evaluer } from './feedback.js';
import { afficherRapport, exporterPDF } from './report.js';
import { initAuth, surChangementCompte, session } from './auth.js';
import { brancherPaywall, peutLancer, estPremium, consommerSimulation, quotaRestant, ouvrirPaywall, majJauge } from './paywall.js';
import { brancherHistorique, enregistrerSimulation, chargerDepuisServeur } from './history.js';
import { brancherAvis, chargerAvisPublies } from './reviews.js';
import { initCoach, arreterCoach } from './coach.js';
import { brancherLegal } from './legal.js';
import { brancherTheme, brancherCookies } from './theme.js';
import { brancherAge, chargerAgeProfil, demanderAgeSiNecessaire } from './age.js';

const CIRCONFERENCE = 326.73;

const etat = {
  typeId: 'entretien',
  sousChoix: '',
  nbQuestions: 5,
  duree: 120,
  niveau: 'standard',
  modeReel: false,
  lectureAuto: true,
  questions: [],
  index: 0,
  reponses: [],
  restant: 0,
  timer: null,
  enPause: false,
  tempsTotal: 0,
  dictee: null,
  debutParole: 0,
  paroleQuestion: 0
};

/* ═══ Navigation entre vues ═══ */
const VUES = ['simulateur', 'coach', 'compte'];
function allerVue(nom) {
  VUES.forEach(v => $('#vue-' + v).classList.toggle('hidden', v !== nom));
  $$('.onglet').forEach(b => {
    const actif = b.dataset.vue === nom;
    b.classList.toggle('bg-iris', actif);
    b.classList.toggle('text-white', actif);
    b.classList.toggle('font-semibold', actif);
    b.classList.toggle('text-muted', !actif);
  });
  if (nom !== 'coach') arreterCoach();
  if (nom !== 'simulateur') { Voix.stop(); etat.dictee?.arreter(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-vue]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); allerVue(b.dataset.vue); }));

/* ═══ Écrans du simulateur ═══ */
const ECRANS = ['accueil', 'chargement', 'simulation', 'rapport'];
function allerEcran(nom) {
  ECRANS.forEach(e => $('#ecran-' + e).classList.toggle('hidden', e !== nom));
  const el = $('#ecran-' + nom);
  el.classList.remove('entree'); void el.offsetWidth; el.classList.add('entree');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══ Étape 1 : choix de l'épreuve ═══ */
function rendreTypes() {
  $('#grille-types').innerHTML = TYPES_ORAL.map(t => `
    <button type="button" data-type="${t.id}"
      class="carte-type rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-iris/60">
      <span class="text-2xl">${t.emoji}</span>
      <span class="mt-2 block font-display text-sm font-bold leading-tight">${echappe(t.court)}</span>
      <span class="mt-1 block text-xs leading-snug text-muted">${echappe(t.nom)}</span>
    </button>`).join('');

  $$('[data-type]').forEach(b => b.addEventListener('click', () => choisirType(b.dataset.type)));
  choisirType(etat.typeId);
}

function choisirType(id) {
  etat.typeId = id;
  const type = typeParId(id);

  $$('[data-type]').forEach(b => {
    const actif = b.dataset.type === id;
    b.classList.toggle('border-iris', actif);
    b.classList.toggle('bg-iris/10', actif);
    b.classList.toggle('border-line', !actif);
    b.classList.toggle('bg-surface', !actif);
    b.setAttribute('aria-pressed', String(actif));
  });

  // Sous-choix (matière, certification)
  const zone = $('#zone-sous-choix'), select = $('#sous-choix');
  if (type.sousChoix) {
    zone.classList.remove('hidden');
    $('#label-sous-choix').textContent = type.sousChoix.label;
    select.innerHTML = type.sousChoix.options.map(o => `<option>${echappe(o)}</option>`).join('');
    etat.sousChoix = type.sousChoix.options[0];
  } else {
    zone.classList.add('hidden');
    etat.sousChoix = '';
  }

  // Libellés des deux zones de dépôt
  $('#label-A').textContent = type.champA.label;
  $('#aide-A').textContent = type.champA.aide;
  $('#champA').placeholder = type.champA.placeholder;
  $('#min-A').textContent = `Minimum ${type.champA.min} caractères.`;
  $('#label-B').textContent = type.champB.label;
  $('#aide-B').textContent = type.champB.aide;
  $('#champB').placeholder = type.champB.placeholder;
  $('#min-B').textContent = `Minimum ${type.champB.min} caractères.`;

  reglerGroupe('duree', type.duree);
  verifierFormulaire();
}

$('#sous-choix')?.addEventListener('change', e => { etat.sousChoix = e.target.value; });

/* ═══ Étape 2 : compteurs et formulaire ═══ */
function brancherCompteur(idChamp, idCompteur) {
  const champ = $('#' + idChamp), compteur = $('#' + idCompteur);
  const maj = () => {
    const n = champ.value.trim().length;
    const min = typeParId(etat.typeId)[idChamp === 'champA' ? 'champA' : 'champB'].min;
    compteur.textContent = n.toLocaleString('fr-FR');
    compteur.classList.toggle('text-mint', n >= min);
    compteur.classList.toggle('text-muted', n < min);
    verifierFormulaire();
  };
  champ.addEventListener('input', maj);
  maj();
}

function verifierFormulaire() {
  const type = typeParId(etat.typeId);
  const a = $('#champA').value.trim(), b = $('#champB').value.trim();
  const pret = a.length >= type.champA.min && b.length >= type.champB.min;
  $('#btn-lancer').disabled = !pret;

  const aide = $('#aide-action');
  if (!pret) aide.textContent = 'Complétez les deux champs pour démarrer.';
  else if (!peutLancer()) aide.textContent = 'Vos simulations gratuites sont utilisées : passez au Premium pour continuer.';
  else aide.textContent = `Durée estimée : environ ${Math.round(etat.nbQuestions * etat.duree / 60)} minutes.`;

  // Compteurs recalculés au changement de type
  ['champA:compteur-A', 'champB:compteur-B'].forEach(paire => {
    const [idChamp, idCompteur] = paire.split(':');
    const n = $('#' + idChamp).value.trim().length;
    const min = type[idChamp === 'champA' ? 'champA' : 'champB'].min;
    $('#' + idCompteur).classList.toggle('text-mint', n >= min);
    $('#' + idCompteur).classList.toggle('text-muted', n < min);
  });
}

/* ═══ Lancement ═══ */
$('#btn-lancer').addEventListener('click', async () => {
  // Première simulation : on demande la tranche d'âge avant de commencer.
  if (demanderAgeSiNecessaire()) return;
  if (!peutLancer()) { ouvrirPaywall('quota'); return; }

  etat.index = 0;
  etat.reponses = [];
  etat.tempsTotal = 0;
  etat.modeReel = $('#mode-reel').checked;
  etat.lectureAuto = $('#lecture-auto').checked;
  Voix.activee = etat.lectureAuto;

  const langue = langueDeLEpreuve(etat.typeId, etat.sousChoix);
  if (etat.dictee) etat.dictee.changerLangue(langue);

  $('#titre-chargement').textContent = 'Lecture de vos documents';
  $('#sous-titre-chargement').textContent = "Préparation des questions de l'examinateur…";
  allerEcran('chargement');

  try {
    etat.questions = await genererQuestions({
      typeId: etat.typeId,
      sousChoix: etat.sousChoix,
      champA: $('#champA').value.trim(),
      champB: $('#champB').value.trim(),
      nbQuestions: etat.nbQuestions,
      niveau: etat.niveau,
      jeton: session.jeton
    });
  } catch (e) {
    // Le serveur a refusé : on revient à l'accueil et on ouvre la bonne modale.
    allerEcran('accueil');
    if (e instanceof ErreurQuota && e.code === 'connexion') {
      toast(e.message, 'erreur');
      ouvrirModale('modal-auth');
    } else {
      ouvrirPaywall('quota');
    }
    majJauge();
    verifierFormulaire();
    return;
  }

  if (demoQuestions) {
    // L'API n'a pas répondu : on ne facture pas au candidat une de ses
    // simulations gratuites pour une panne qui ne vient pas de lui.
    toast("Mode démo : l'API n'a pas répondu, questions et correction générées localement. Cette simulation ne décompte pas votre quota gratuit.");
  } else {
    consommerSimulation();
  }
  $('#total-questions').textContent = etat.questions.length;
  $('#segments').innerHTML = etat.questions.map(() => '<span class="h-1.5 flex-1 rounded-full bg-line"></span>').join('');
  $('#btn-pause').classList.toggle('hidden', etat.modeReel);

  allerEcran('simulation');
  afficherQuestion();
});

/* ═══ Déroulé de la simulation ═══ */
function afficherQuestion() {
  const q = etat.questions[etat.index];
  $('#categorie').textContent = q.categorie || 'Question';
  $('#question').textContent = q.texte;
  $('#num-question').textContent = etat.index + 1;
  $('#reponse').value = '';
  $('#interim').textContent = '';
  $('#compteur-reponse').textContent = '0 mot';
  $('#btn-suivant').textContent = etat.index === etat.questions.length - 1 ? 'Terminer et voir le rapport' : 'Valider et continuer';
  etat.paroleQuestion = 0;

  [...$('#segments').children].forEach((s, i) => {
    s.className = 'h-1.5 flex-1 rounded-full ' + (i < etat.index ? 'bg-mint' : i === etat.index ? 'bg-iris' : 'bg-line');
  });

  lireQuestion();
  demarrerChrono(etat.duree);
}

function lireQuestion() {
  if (!etat.lectureAuto) return;
  const langue = langueDeLEpreuve(etat.typeId, etat.sousChoix);
  Voix.activee = true;
  Voix.parler(etat.questions[etat.index].texte, { langue, debit: 0.97 });
}

$('#btn-relire').addEventListener('click', () => {
  Voix.activee = true;
  Voix.parler(etat.questions[etat.index]?.texte || '', { langue: langueDeLEpreuve(etat.typeId, etat.sousChoix) });
});

/* ── Chronomètre ── */
function demarrerChrono(secondes) {
  clearInterval(etat.timer);
  etat.restant = secondes;
  etat.enPause = false;
  $('#btn-pause').textContent = 'Mettre en pause';
  peindreChrono();
  etat.timer = setInterval(() => {
    if (etat.enPause) return;
    etat.restant--;
    etat.tempsTotal++;
    peindreChrono();
    if (etat.modeReel && etat.restant <= 0) { clearInterval(etat.timer); enregistrer($('#reponse').value.trim()); }
  }, 1000);
}

function peindreChrono() {
  const part = Math.max(0, etat.restant) / etat.duree;
  const arc = $('#arc');
  arc.setAttribute('stroke-dashoffset', String(CIRCONFERENCE * (1 - part)));
  arc.setAttribute('stroke', etat.restant < 0 ? '#FF5D6C' : part > 0.5 ? '#7C5CFF' : part > 0.25 ? '#F5A524' : '#FF5D6C');
  $('#chrono').textContent = formaterTemps(etat.restant);
  $('#chrono').style.color = etat.restant < 0 ? '#FF5D6C' : '';
  $('#etat-chrono').textContent = etat.modeReel
    ? (etat.restant <= 10 ? 'Conditions réelles : passage automatique dans ' + etat.restant + ' s.' : 'Conditions réelles : pas de pause.')
    : etat.restant < 0 ? 'Vous dépassez le temps conseillé. Concluez.'
    : etat.enPause ? 'En pause.' : 'Le chrono tourne, il ne vous coupe pas.';
}

$('#btn-pause').addEventListener('click', () => {
  if (etat.modeReel) return toast('Le mode conditions réelles interdit la pause.');
  etat.enPause = !etat.enPause;
  $('#btn-pause').textContent = etat.enPause ? 'Reprendre' : 'Mettre en pause';
  peindreChrono();
});

/* ── Micro ── */
function brancherMicroSimulation() {
  const bouton = $('#btn-micro'), libelle = $('#libelle-micro'), etatTxt = $('#etat-micro');

  if (!dicteeSupportee) {
    bouton.disabled = true;
    bouton.classList.add('opacity-50', 'cursor-not-allowed');
    etatTxt.textContent = "La réponse vocale n'est pas disponible sur ce navigateur. Utilisez Chrome, Edge ou Safari, ou écrivez votre réponse.";
    return;
  }

  etat.dictee = new Dictee({
    langue: 'fr-FR',
    onDefinitif: seg => {
      const z = $('#reponse');
      z.value = (z.value + ' ' + seg).trim();
      z.dispatchEvent(new Event('input'));
    },
    onProvisoire: txt => { $('#interim').textContent = txt ? '« ' + txt + ' »' : ''; },
    onErreur: msg => toast(msg, 'erreur'),
    onFin: () => {
      bouton.classList.remove('micro-actif');
      libelle.textContent = 'Répondre à l\'oral';
      etatTxt.textContent = 'Enregistrement arrêté. Relisez et corrigez si besoin.';
      $('#interim').textContent = '';
      etat.paroleQuestion += (Date.now() - etat.debutParole) / 1000;
    }
  });

  bouton.addEventListener('click', () => {
    Voix.stop();
    if (etat.dictee.enMarche) { etat.dictee.arreter(); return; }
    if (etat.dictee.demarrer()) {
      etat.debutParole = Date.now();
      bouton.classList.add('micro-actif');
      libelle.textContent = "J'écoute — appuyez pour arrêter";
      etatTxt.textContent = 'Parlez normalement, votre réponse s\'écrit toute seule.';
    } else {
      toast("Le micro n'a pas pu démarrer.", 'erreur');
    }
  });
}

$('#reponse').addEventListener('input', e => {
  const n = compterMots(e.target.value);
  $('#compteur-reponse').textContent = n + ' mot' + (n > 1 ? 's' : '');
});

/* ── Enchaînement ── */
function enregistrer(texte) {
  etat.dictee?.arreter();
  Voix.stop();
  const q = etat.questions[etat.index];
  etat.reponses.push({
    question: q.texte,
    categorie: q.categorie,
    texte,
    duree: etat.duree - etat.restant,
    dureeParole: Math.round(etat.paroleQuestion)
  });
  etat.index++;
  if (etat.index < etat.questions.length) afficherQuestion();
  else { clearInterval(etat.timer); terminer(); }
}

$('#btn-suivant').addEventListener('click', () => enregistrer($('#reponse').value.trim()));
$('#btn-passer').addEventListener('click', () => enregistrer(''));
$('#btn-abandon').addEventListener('click', () => {
  clearInterval(etat.timer);
  etat.dictee?.arreter();
  Voix.stop();
  allerEcran('accueil');
});

/* ═══ Fin : rapport ═══ */
async function terminer() {
  $('#titre-chargement').textContent = 'Analyse de votre prestation';
  $('#sous-titre-chargement').textContent = 'Contenu, structure, éloquence…';
  allerEcran('chargement');

  const bilan = await evaluer({
    typeId: etat.typeId,
    sousChoix: etat.sousChoix,
    champA: $('#champA').value.trim(),
    champB: $('#champB').value.trim(),
    questions: etat.questions,
    reponses: etat.reponses,
    jeton: session.jeton
  });

  afficherRapport({
    bilan,
    reponses: etat.reponses,
    contexte: { typeId: etat.typeId, sousChoix: etat.sousChoix },
    tempsTotal: etat.tempsTotal
  });
  allerEcran('rapport');

  await enregistrerSimulation({
    typeId: etat.typeId,
    sousChoix: etat.sousChoix,
    score: bilan.global,
    eloquence: bilan.eloquence?.note ?? null,
    nbQuestions: etat.reponses.length,
    criteres: bilan.criteres,
    details: bilan.details
  });

  majJauge();
  verifierFormulaire();

  // Paywall à la fin de la simulation, sauf pour les abonnés.
  if (!estPremium()) setTimeout(() => ouvrirPaywall(quotaRestant() > 0 ? 'fin' : 'quota'), 1400);
}

$('#btn-pdf').addEventListener('click', exporterPDF);
$('#btn-modifier').addEventListener('click', () => allerEcran('accueil'));
$('#btn-rejouer').addEventListener('click', () => {
  if (!peutLancer()) return ouvrirPaywall('quota');
  allerEcran('accueil');
  setTimeout(() => $('#btn-lancer').click(), 200);
});

/* ═══ Démarrage ═══ */
function demarrer() {
  $('#annee').textContent = new Date().getFullYear();

  brancherReglages(etat, () => verifierFormulaire());
  rendreTypes();
  brancherCompteur('champA', 'compteur-A');
  brancherCompteur('champB', 'compteur-B');

  brancherDepot({ idInput: 'fichier-A', idZone: 'depot-A', idEtat: 'etat-fichier-A', idCible: 'champA' });
  brancherDepot({ idInput: 'fichier-B', idZone: 'depot-B', idEtat: 'etat-fichier-B', idCible: 'champB' });

  brancherMicroSimulation();
  brancherTheme();
  brancherCookies();
  brancherAge();
  brancherPaywall();
  brancherHistorique();
  brancherAvis();
  brancherLegal();
  initCoach();

  $('#btn-essai')?.addEventListener('click', () => {
    allerVue('simulateur');
    allerEcran('accueil');
    $('#configurer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#mode-reel').addEventListener('change', e => {
    etat.modeReel = e.target.checked;
    if (e.target.checked) toast('Mode conditions réelles : chrono strict, aucune pause.');
  });
  $('#lecture-auto').addEventListener('change', e => {
    etat.lectureAuto = e.target.checked;
    Voix.activee = e.target.checked;
    if (!e.target.checked) Voix.stop();
  });

  initAuth().then(() => {
    surChangementCompte(() => { majJauge(); verifierFormulaire(); });
    chargerDepuisServeur();
    chargerAvisPublies();
    chargerAgeProfil();
  });

  allerVue('simulateur');
  verifierFormulaire();

  // Reprise d'une session interrompue par un paiement.
  if (new URLSearchParams(location.search).get('vue') === 'compte') allerVue('compte');
}

demarrer();
