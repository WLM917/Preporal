/* ═══════════════════════════════════════════════════════════
   upload.js — dépôt de fichiers et extraction de texte
   Tout se passe dans le navigateur : aucun fichier n'est envoyé
   à un serveur.
   ═══════════════════════════════════════════════════════════ */

import { $, toast } from './ui.js';

const CDN = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js'
};

const TAILLE_MAX = 12 * 1024 * 1024; // 12 Mo

const scriptsCharges = new Map();
function chargerScript(url) {
  if (scriptsCharges.has(url)) return scriptsCharges.get(url);
  const p = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = ok;
    s.onerror = () => ko(new Error('Chargement impossible : ' + url));
    document.head.appendChild(s);
  });
  scriptsCharges.set(url, p);
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
  await chargerScript(CDN.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
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
  await chargerScript(CDN.tesseract);
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
  await chargerScript(CDN.mammoth);
  const buffer = await lireBuffer(fichier);
  const r = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return (r.value || '').trim();
}

async function extraireImage(fichier, onProgres) {
  await chargerScript(CDN.tesseract);
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

  ['dragenter', 'dragover'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('survol'); }));
  ['dragleave', 'drop'].forEach(ev =>
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('survol'); }));
  zone.addEventListener('drop', e => traiter(e.dataTransfer?.files?.[0]));
}
