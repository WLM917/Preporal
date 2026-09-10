/* ═══════════════════════════════════════════════════════════
   report.js — tableau de bord de fin de simulation + export PDF
   ═══════════════════════════════════════════════════════════ */

import { typeParId } from './config.js';
import { $, echappe, formaterTemps, compterMots, couleurNote } from './ui.js';
import { t } from './i18n.js';
import { boutonEcoute, arreterEcoute } from './speech.js';

const CIRCONFERENCE = 326.73;   // 2πr, r = 52

/* Le rapport était entièrement muet : seule la question posée pouvait
   être entendue. Un candidat qui prépare un oral gagne à écouter sa
   correction plutôt qu'à la lire — et c'est indispensable pour qui ne
   peut pas lire l'écran. */
function placerEcouteBilan(score, bilan) {
  const zone = $('#ecoute-bilan');
  if (!zone) return;
  zone.innerHTML = '';

  const b = boutonEcoute({
    libelle: t('ecoute.bilan', 'Écouter le bilan'),
    libelleArret: t('ecoute.arreter', 'Arrêter'),
    classes: 'px-3 py-1.5',
    texte: () => {
      const criteres = Object.entries(bilan.criteres || {})
        .map(([nom, val]) => `${nom} : ${val} sur 100.`).join(' ');
      const conseils = (bilan.eloquence?.conseils || []).join(' ');
      return `Votre note globale est de ${score} sur 100. `
        + `${$('#verdict')?.textContent || ''}. `
        + `${$('#verdict-detail')?.textContent || ''} `
        + (criteres ? `Détail par critère. ${criteres} ` : '')
        + (conseils ? `Conseils d'éloquence. ${conseils}` : '');
    }
  });
  if (b) zone.appendChild(b);
}

/** Bouton d'écoute placé sur chaque correction question par question. */
function placerEcouteReponses(reponses, bilan) {
  $('#detail-reponses').querySelectorAll('[data-ecoute-reponse]').forEach(zone => {
    const i = Number(zone.dataset.ecouteReponse);
    const r = reponses[i];
    const d = (bilan.details || [])[i] || {};
    const b = boutonEcoute({
      libelle: t('ecoute.ecouter', 'Écouter la correction'),
      libelleArret: t('ecoute.arreter', 'Arrêter'),
      texte: () => [
        `Question ${i + 1}. ${r.question}`,
        `Note : ${d.note} sur 20.`,
        d.forts?.length ? `Ce qui fonctionne : ${d.forts.join('. ')}.` : '',
        d.axes?.length ? `À renforcer : ${d.axes.join('. ')}.` : '',
        d.reecriture ? `Réponse réécrite : ${d.reecriture}` : ''
      ].filter(Boolean).join(' ')
    });
    if (b) zone.appendChild(b);
  });
}

export function afficherRapport({ bilan, reponses, contexte, tempsTotal }) {
  arreterEcoute();
  const type = typeParId(contexte.typeId);
  const score = Math.round(bilan.global || 0);

  /* ── En-tête ── */
  $('#type-rapport').textContent = type.nom + (contexte.sousChoix ? ' · ' + contexte.sousChoix : '');
  $('#score-global').textContent = score;
  const arc = $('#arc-score');
  arc.setAttribute('stroke', couleurNote(score));
  requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', CIRCONFERENCE * (1 - score / 100)));

  $('#verdict').textContent = score >= 70 ? 'Vous êtes prêt' : score >= 45 ? 'Bonne base, à resserrer' : 'À retravailler avant le jour J';
  placerEcouteBilan(score, bilan);

  $('#verdict-detail').textContent = score >= 70
    ? "Vos réponses sont structurées et appuyées sur des faits. Reprenez seulement les questions les plus faibles ci-dessous, puis refaites une passe en conditions réelles."
    : "Travaillez d'abord les axes signalés question par question, puis relancez une simulation : c'est la répétition qui installe les réflexes.";

  const mots = reponses.reduce((s, r) => s + compterMots(r.texte), 0);
  $('#stat-questions').textContent = reponses.length;
  $('#stat-temps').textContent = formaterTemps(tempsTotal);
  $('#stat-mots').textContent = Math.round(mots / (reponses.length || 1));

  /* ── Critères ── */
  const criteres = bilan.criteres || {};
  $('#criteres').innerHTML = Object.entries(criteres).map(([nom, val]) => `
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-sm font-medium">${echappe(nom)}</p>
        <p class="font-display text-sm font-bold tabular-nums text-muted">${val}<span class="text-xs"> / 100</span></p>
      </div>
      <div class="barre mt-2 h-2 overflow-hidden rounded-full bg-line">
        <i style="width:0%;background:${couleurNote(val)}"></i>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => {
    $('#criteres').querySelectorAll('.barre > i').forEach((el, i) => {
      el.style.width = Math.max(2, Object.values(criteres)[i]) + '%';
    });
  });

  /* ── Éloquence ── */
  const e = bilan.eloquence || {};
  $('#eloq-note').textContent = (e.note ?? '–') + ' / 20';
  $('#eloq-debit').textContent = e.debit ? e.debit + ' mots/min' : 'non mesuré';
  $('#eloq-debit-note').textContent = e.debit
    ? (e.debit > 175 ? 'Trop rapide' : e.debit < 105 ? 'Un peu lent' : 'Rythme idéal')
    : 'Répondez au micro pour la mesure';
  $('#eloq-richesse').textContent = (e.richesse ?? 0) + ' / 100';
  $('#eloq-richesse-note').textContent = (e.richesse ?? 0) >= 55 ? 'Vocabulaire varié' : 'Vocabulaire à enrichir';
  $('#eloq-clarte').textContent = (e.clarte ?? 0) + ' / 100';
  $('#eloq-clarte-note').textContent = e.motsParPhrase ? `${e.motsParPhrase} mots par phrase en moyenne` : '';
  $('#eloq-conseils').innerHTML = (e.conseils || []).map(c =>
    `<li class="flex gap-2"><span class="text-iris2">•</span><span>${echappe(c)}</span></li>`).join('');

  /* ── Détail réponse par réponse ── */
  $('#detail-reponses').innerHTML = reponses.map((r, i) => {
    const d = (bilan.details || [])[i] || { note: 0, forts: [], axes: [], reecriture: '' };
    const teinte = d.note >= 14 ? 'text-mint' : d.note >= 9 ? 'text-amber' : 'text-coral';
    return `
    <details class="group rounded-2xl border border-line bg-surface shadow-lift" ${i === 0 ? 'open' : ''}>
      <summary class="flex cursor-pointer list-none items-start justify-between gap-4 p-5">
        <div>
          <p class="text-xs text-muted">Question ${i + 1}${r.categorie ? ' · ' + echappe(r.categorie) : ''}</p>
          <p class="mt-1 font-display font-bold leading-snug">${echappe(r.question)}</p>
        </div>
        <span class="shrink-0 font-display text-lg font-extrabold tabular-nums ${teinte}">${d.note}<span class="text-xs text-muted"> / 20</span></span>
      </summary>
      <div class="space-y-5 border-t border-line/70 p-5">
        <div data-ecoute-reponse="${i}" class="sans-impression"></div>
        <div>
          <p class="text-xs text-muted">Ce que vous avez répondu${r.dureeParole ? ` · ${Math.round(r.dureeParole)} s de parole` : ''}</p>
          <p class="mt-1 text-sm leading-relaxed text-soft/90">${r.texte ? echappe(r.texte) : '<span class="text-muted">Question passée.</span>'}</p>
        </div>
        ${d.forts?.length ? `<div>
          <p class="text-xs font-medium text-mint">Ce qui fonctionne</p>
          <ul class="mt-2 space-y-1.5 text-sm text-muted">${d.forts.map(f => `<li class="flex gap-2"><span class="text-mint">+</span><span>${echappe(f)}</span></li>`).join('')}</ul>
        </div>` : ''}
        ${d.axes?.length ? `<div>
          <p class="text-xs font-medium text-amber">À renforcer</p>
          <ul class="mt-2 space-y-1.5 text-sm text-muted">${d.axes.map(a => `<li class="flex gap-2"><span class="text-amber">→</span><span>${echappe(a)}</span></li>`).join('')}</ul>
        </div>` : ''}
        ${d.reecriture ? `<div class="rounded-xl border border-iris/30 bg-iris/5 p-4">
          <p class="text-xs font-medium text-iris2">Réponse réécrite</p>
          <p class="mt-2 text-sm leading-relaxed text-soft/90">${echappe(d.reecriture)}</p>
        </div>` : ''}
      </div>
    </details>`;
  }).join('');

  placerEcouteReponses(reponses, bilan);
}

/** Export PDF : on ouvre tous les blocs puis on laisse le navigateur imprimer. */
export function exporterPDF() {
  const ouverts = [...document.querySelectorAll('#detail-reponses details')];
  const etatInitial = ouverts.map(d => d.open);
  ouverts.forEach(d => (d.open = true));

  const titreInitial = document.title;
  document.title = `PrepOral - bilan du ${new Date().toLocaleDateString('fr-FR')}`;

  const restaurer = () => {
    ouverts.forEach((d, i) => (d.open = etatInitial[i]));
    document.title = titreInitial;
    window.removeEventListener('afterprint', restaurer);
  };
  window.addEventListener('afterprint', restaurer);

  setTimeout(() => window.print(), 120);
}
