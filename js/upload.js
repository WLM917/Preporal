/* ═══════════════════════════════════════════════════════════
   upload.js — dépôt de fichiers et extraction de texte
   Tout se passe dans le navigateur : aucun fichier n'est envoyé
   à un serveur.
   ═══════════════════════════════════════════════════════════ */

import { $, toast } from './ui.js';
import { Dictee, dicteeSupportee } from './speech.js';
import { t, infoLangue } from './i18n.js';

/* pdf.js et mammoth sont servis par le site lui-même.
   Ils venaient d'un CDN, et c'était une mauvaise idée à trois titres :
   un CDN injoignable (réseau d'entreprise, bloqueur, panne) rendait
   l'import de documents inopérant sans le moindre message ; le worker
   de pdf.js, chargé depuis une autre origine, est un cas fragile ; et
   cela signalait à un tiers que quelqu'un dépose son CV ici.
   Tesseract reste distant : il pèse plusieurs mégaoctets et ne sert
   que de recours pour les PDF scannés et les images. */
const LIB = {
  pdf: './assets/vendor/pdf.min.js',
  pdfWorker: './assets/vendor/pdf.worker.min.js',
  mammoth: './assets/vendor/mammoth.browser.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js'
};

const TAILLE_MAX = 12 * 1024 * 1024; // 12 Mo
const DELAI_SCRIPT = 20000;          // au-delà, on renonce plutôt que d'attendre

const scriptsCharges = new Map();
function chargerScript(url) {
  const memo = scriptsCharges.get(url);
  if (memo) return memo;

  const p = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;

    /* Un script qui ne répond pas ne déclenche pas toujours onerror :
       sans ce délai, la promesse ne se résout jamais et l'interface
       reste bloquée sur « Lecture de… », indéfiniment. */
    const minuteur = setTimeout(() => {
      s.remove();
      ko(new Error('Bibliothèque de lecture injoignable : ' + url));
    }, DELAI_SCRIPT);

    s.onload = () => { clearTimeout(minuteur); ok(); };
    s.onerror = () => {
      clearTimeout(minuteur);
      s.remove();
      ko(new Error('Chargement impossible : ' + url));
    };
    document.head.appendChild(s);
  });

  /* On ne mémorise que les succès. Mémoriser un échec le figerait pour
     toute la durée de la page : un incident réseau passager
     condamnerait l'import jusqu'au rechargement. */
  scriptsCharges.set(url, p);
  p.catch(() => scriptsCharges.delete(url));
  return p;
}

const lireTexte = fichier => new Promise((ok, ko) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result || ''));
  fr.onerror = () => ko(new Error('Fichier illisible.'));
  fr.readAsText(fichier, 'utf-8');
});

const lireBuffer = fichier => new Promise((ok, ko) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result);
  fr.onerror = () => ko(new Error('Fichier illisible.'));
  fr.readAsArrayBuffer(fichier);
});

const lireDataURL = fichier => new Promise((ok, ko) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result));
  fr.onerror = () => ko(new Error('Image illisible.'));
  fr.readAsDataURL(fichier);
});

async function extrairePDF(fichier, onProgres) {
  await chargerScript(LIB.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(LIB.pdfWorker, location.href).href;
  const buffer = await lireBuffer(fichier);
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const morceaux = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgres && onProgres(`Lecture de la page ${p}/${doc.numPages}…`);
    const page = await doc.getPage(p);
    const contenu = await page.getTextContent();
    morceaux.push(contenu.items.map(i => i.str).join(' '));
  }
  const texte = morceaux.join('\n\n').replace(/[ \t]+/g, ' ').trim();
  if (texte.length < 40) {
    // PDF scanné : on bascule sur l'OCR de la première page rendue en image.
    onProgres && onProgres('PDF scanné détecté, lecture optique…');
    return await ocrDepuisPDF(doc, onProgres);
  }
  return texte;
}

async function ocrDepuisPDF(doc, onProgres) {
  await chargerScript(LIB.tesseract);
  const pages = Math.min(doc.numPages, 3);
  const textes = [];
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    onProgres && onProgres(`Lecture optique ${p}/${pages}…`);
    const { data } = await window.Tesseract.recognize(canvas, 'fra');
    textes.push(data.text);
  }
  return textes.join('\n\n').trim();
}

async function extraireDocx(fichier) {
  await chargerScript(LIB.mammoth);
  const buffer = await lireBuffer(fichier);
  const r = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return (r.value || '').trim();
}

async function extraireImage(fichier, onProgres) {
  await chargerScript(LIB.tesseract);
  const url = await lireDataURL(fichier);
  onProgres && onProgres('Lecture optique de l\'image…');
  const { data } = await window.Tesseract.recognize(url, 'fra', {
    logger: m => { if (m.status === 'recognizing text' && onProgres) onProgres(`Lecture optique ${Math.round(m.progress * 100)} %…`); }
  });
  return (data.text || '').trim();
}

/** Aiguillage principal : rend le texte brut d'un fichier. */
export async function extraireTexte(fichier, onProgres) {
  if (fichier.size > TAILLE_MAX) throw new Error('Fichier trop lourd (12 Mo maximum).');
  const nom = fichier.name.toLowerCase();
  const type = fichier.type || '';

  if (type === 'application/pdf' || nom.endsWith('.pdf')) return extrairePDF(fichier, onProgres);
  if (nom.endsWith('.docx')) return extraireDocx(fichier);
  if (type.startsWith('image/')) return extraireImage(fichier, onProgres);
  if (type.startsWith('text/') || /\.(txt|md|rtf|csv|json)$/.test(nom)) return (await lireTexte(fichier)).trim();
  if (nom.endsWith('.doc')) throw new Error('Format .doc ancien non lisible : enregistrez en .docx ou en PDF.');

  // Dernier recours : on tente une lecture texte.
  const brut = await lireTexte(fichier);
  if (/[\x00-\x08\x0E-\x1F]/.test(brut.slice(0, 500))) throw new Error('Format non pris en charge.');
  return brut.trim();
}

/**
 * Branche une zone de dépôt sur une zone de texte.
 * @param {object} o { idInput, idZone, idEtat, idCible, onTexte }
 */
export function brancherDepot({ idInput, idZone, idEtat, idCible, onTexte }) {
  const input = $('#' + idInput), zone = $('#' + idZone), etat = $('#' + idEtat), cible = $('#' + idCible);
  if (!input || !zone || !cible) return;
  const libelleInitial = etat.textContent;

  const traiter = async fichier => {
    if (!fichier) return;
    zone.classList.remove('survol');
    etat.textContent = 'Lecture de ' + fichier.name + '…';
    try {
      const texte = await extraireTexte(fichier, msg => { etat.textContent = msg; });
      if (!texte || texte.length < 20) throw new Error('Aucun texte exploitable trouvé dans ce fichier.');
      cible.value = texte;
      cible.dispatchEvent(new Event('input', { bubbles: true }));
      etat.textContent = `${fichier.name} · ${texte.length.toLocaleString('fr-FR')} caractères importés`;
      onTexte && onTexte(texte);
      toast('Document importé. Vérifiez et corrigez si besoin.', 'succes');
    } catch (e) {
      etat.textContent = libelleInitial;
      toast(e.message || 'Import impossible.', 'erreur');
    }
  };

  input.addEventListener('change', () => traiter(input.files[0]));

  brancherDicteeChamp(cible, zone);

  ['dragenter', 'dragover'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('survol'); }));
  ['dragleave', 'drop'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('survol'); }));
  zone.addEventListener('drop', e => traiter(e.dataTransfer?.files?.[0]));
}


/* ═══════════════════════════════════════════════════════════
   Dictée dans un champ de document

   Tout le monde n'a pas son CV sous forme de fichier, et taper
   trois cents caractères au clavier sur un téléphone décourage
   avant même d'avoir commencé. On peut donc raconter à voix
   haute où l'on postule, ses notes, l'école ou le poste visé :
   la parole s'écrit dans le champ, où elle reste modifiable.
   ═══════════════════════════════════════════════════════════ */

const MICRO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>';
const CARRE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

/** Ajoute un bouton « Dicter » sous une zone de texte. */
export function brancherDicteeChamp(cible, apres) {
  if (!cible || cible.dataset.dictee) return null;
  cible.dataset.dictee = '1';

  const barre = document.createElement('div');
  barre.className = 'mt-2 flex flex-wrap items-center gap-2';

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'inline-flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-xs font-medium transition hover:border-iris/60';
  bouton.innerHTML = `${MICRO}<span>${t('sim.dicter', 'Dicter')}</span>`;

  const etat = document.createElement('span');
  etat.className = 'text-xs text-muted';
  etat.setAttribute('role', 'status');

  barre.append(bouton, etat);
  (apres || cible).insertAdjacentElement('afterend', barre);

  /* Sans reconnaissance vocale (Firefox, navigateurs anciens), on
     n'affiche pas un bouton qui ne ferait rien : on l'annonce. */
  if (!dicteeSupportee) {
    bouton.disabled = true;
    bouton.classList.add('opacity-50', 'cursor-not-allowed');
    etat.textContent = t('sim.dictee_indisponible', 'Dictée indisponible dans ce navigateur.');
    return bouton;
  }

  let dictee = null;
  let base = '';

  const arreter = () => {
    dictee?.arreter();
    dictee = null;
    bouton.innerHTML = `${MICRO}<span>${t('sim.dicter', 'Dicter')}</span>`;
    bouton.classList.remove('border-coral', 'text-coral');
    etat.textContent = '';
  };

  bouton.addEventListener('click', () => {
    if (dictee) return arreter();

    // On reprend là où le texte s'arrête, sans écraser ce qui est saisi.
    base = cible.value.trim();
    dictee = new Dictee({
      // On dicte dans la langue de l'interface, pas toujours en français.
      langue: infoLangue().voix,
      onDefinitif: segment => {
        base = (base ? base + ' ' : '') + segment;
        cible.value = base;
        cible.dispatchEvent(new Event('input', { bubbles: true }));
        etat.textContent = t('sim.a_l_ecoute', 'À l\'écoute…');
      },
      onProvisoire: texte => {
        cible.value = base + (texte ? (base ? ' ' : '') + texte : '');
        etat.textContent = texte ? '…' + texte.slice(-40) : t('sim.a_l_ecoute', 'À l\'écoute…');
      },
      onErreur: message => { toast(message, 'erreur'); arreter(); },
      onFin: () => { if (dictee) arreter(); }
    });

    dictee.demarrer();
    bouton.innerHTML = `${CARRE}<span>${t('sim.arreter_dictee', 'Arrêter')}</span>`;
    bouton.classList.add('border-coral', 'text-coral');
    etat.textContent = t('sim.a_l_ecoute', 'À l\'écoute…');
  });

  return bouton;
}
