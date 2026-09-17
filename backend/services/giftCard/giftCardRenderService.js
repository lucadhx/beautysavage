import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';

import { getActiveGiftCardTemplateOrSeed } from './giftCardTemplateResolver.js';
import { generateGiftCardQrDataUrl, generateGiftCardQrPayload } from './giftCardQrService.js';
import { resolveInstituteName } from '../system/systemConfigurationService.js';

/**
 * M13 — Service de rendu carte cadeau.
 *
 * Deux artefacts complémentaires :
 *  - HTML : rend fidèlement le TEMPLATE actif (html + css du studio), QR inline. C'est la vraie
 *    représentation visuelle (preview, mail inline, sauvegarde locale).
 *  - PDF  : généré via pdfkit (déjà dans les dépendances). pdfkit ne rend pas du HTML/CSS arbitraire,
 *    on dessine donc une carte "structurée" (couleurs + textes + QR). C'est le format pièce jointe.
 *
 * Limite documentée : le PDF n'est PAS un rendu pixel-perfect du HTML du template (voir 206). Le HTML
 * reste la source visuelle de référence ; le PDF est un fallback portable et imprimable.
 */

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'giftcards');
// S1 — résolu au moment du rendu (config DB → fallback env), plus un const figé à l'import.
function getInstituteName() {
  return resolveInstituteName() || 'Beauty Savage';
}

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatGiftCardAmount(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? currencyFormatter.format(value) : '';
}

function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(d);
}

/**
 * Construit le dictionnaire de variables texte d'une carte (sans le QR, injecté séparément).
 * Les secrets (code/pin) ne sont fournis que si explicitement passés (jamais relus du hash).
 */
export function buildGiftCardVariables(giftCard = {}, { code = '', pin = '' } = {}) {
  return {
    recipientName: giftCard.recipientName || '',
    purchaserName: giftCard.purchaserName || '',
    amount: formatGiftCardAmount(giftCard.amount),
    code: code || giftCard.code || '',
    pin: pin || '',
    message: giftCard.message || '',
    createdAt: formatDate(giftCard.purchasedAt || giftCard.createdAt),
    paymentLabel: giftCard.paymentLabel || '',
    instituteName: getInstituteName()
  };
}

/**
 * Remplace les `{{variables}}` dans un template HTML. Toutes les valeurs texte sont échappées ;
 * `qrCode` est injecté comme balise <img> (HTML brut, jamais échappé) si un data URL est fourni.
 */
export function renderGiftCardHtmlFragment(templateHtml, variables = {}, { qrDataUrl = '' } = {}) {
  let html = String(templateHtml || '');
  const qrImg = qrDataUrl
    ? `<img src="${qrDataUrl}" alt="QR carte cadeau" width="120" height="120" />`
    : '';
  html = html.replace(/\{\{\s*qrCode\s*\}\}/g, qrImg);
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    html = html.replace(pattern, escapeHtml(value));
  }
  // Variables inconnues restantes -> vidées (évite d'afficher {{xxx}} sur la carte).
  html = html.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '');
  return html;
}

/** Document HTML autonome (sandbox preview / sauvegarde) : <style>{css}</style> + fragment. */
export function renderGiftCardDocument(template = {}, variables = {}, { qrDataUrl = '' } = {}) {
  const fragment = renderGiftCardHtmlFragment(template.html, variables, { qrDataUrl });
  const css = String(template.css || '');
  return [
    '<!DOCTYPE html>',
    '<html lang="fr"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>Carte cadeau ${getInstituteName()}</title>`,
    `<style>body{margin:0;padding:24px;display:flex;justify-content:center;background:#f5f4ef;}${css}</style>`,
    '</head><body>',
    fragment,
    '</body></html>'
  ].join('\n');
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/**
 * Dessine une carte cadeau "structurée" en PDF (pdfkit). Retourne le chemin écrit.
 */
export function renderGiftCardPdf(targetPath, { variables = {}, qrDataUrl = '' } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [420, 560], margin: 32 });
      const stream = fs.createWriteStream(targetPath);
      doc.pipe(stream);

      const left = 32;
      const width = 420 - 64;

      // Bandeau de marque.
      doc.fillColor('#5f4ff7').rect(0, 0, 420, 110).fill();
      doc.fillColor('#ffffff').fontSize(18).text(variables.instituteName || getInstituteName(), left, 36);
      if (variables.paymentLabel) {
        doc.fontSize(10).fillColor('#ffffff').text(variables.paymentLabel, left, 64);
      }

      // Montant.
      doc.fillColor('#0f172a').fontSize(40).text(variables.amount || '', left, 140);

      // Destinataire / acheteur.
      doc.fillColor('#0f172a').fontSize(13);
      doc.text(`Pour ${variables.recipientName || ''}`, left, 200);
      doc.fillColor('#475569').fontSize(11).text(`De la part de ${variables.purchaserName || ''}`, left, 220);
      if (variables.message) {
        doc.fillColor('#475569').fontSize(11).text(variables.message, left, 244, { width });
      }

      // Code + mot de passe.
      let y = 300;
      doc.fillColor('#64748b').fontSize(9).text('CODE', left, y);
      doc.fillColor('#0f172a').fontSize(16).text(variables.code || '', left, y + 12);
      doc.fillColor('#64748b').fontSize(9).text('MOT DE PASSE', left + 200, y);
      doc.fillColor('#0f172a').fontSize(16).text(variables.pin || '', left + 200, y + 12);

      // QR.
      const qrBuffer = dataUrlToBuffer(qrDataUrl);
      if (qrBuffer) {
        doc.image(qrBuffer, 420 / 2 - 60, 360, { width: 120, height: 120 });
      }

      // Pied de page.
      doc
        .fillColor('#94a3b8')
        .fontSize(9)
        .text(`Émise le ${variables.createdAt || ''}`, left, 500, { width, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(targetPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Rendu de PREVIEW (studio / librairie admin) : aucun envoi, aucune écriture.
 * Génère un QR FACTICE (token fictif) pour visualiser la carte.
 * @returns {Promise<{ html: string, qrDataUrl: string }>}
 */
export async function renderGiftCardPreview(template = {}, overrides = {}) {
  const previewData = { ...(template.previewData || {}), ...(overrides || {}) };
  const variables = {
    recipientName: previewData.recipientName || 'Camille Martin',
    purchaserName: previewData.purchaserName || 'Léa Dubois',
    amount: previewData.amount || formatGiftCardAmount(80),
    code: previewData.code || 'A3F2B9E1',
    pin: previewData.pin || 'K7M2P9QXTV',
    message: previewData.message || 'Joyeux anniversaire !',
    createdAt: previewData.createdAt || formatDate(new Date('2026-06-30')),
    paymentLabel: previewData.paymentLabel || 'Paiement sur place',
    instituteName: previewData.instituteName || getInstituteName()
  };
  const fakePayload = generateGiftCardQrPayload({ token: 'PREVIEW_FAKE_TOKEN_NON_FONCTIONNEL' });
  const qrDataUrl = await generateGiftCardQrDataUrl(fakePayload).catch(() => '');
  const html = renderGiftCardDocument(template, variables, { qrDataUrl });
  return { html, qrDataUrl };
}

/**
 * Génère et PERSISTE les artefacts d'une carte réelle (html + pdf) dans storage/giftcards/.
 * Utilise le template actif (ou celui figé sur la carte si fourni). Renvoie les chemins relatifs
 * + le data URL du QR + le HTML (pour le mail inline) + le buffer PDF (pour la pièce jointe).
 *
 * @param {object} giftCard  Document carte (avec recipientName, amount, code, paymentLabel, qrPayloadVersion...).
 * @param {{ code: string, pin: string, qrPayload: string, template?: object }} opts
 */
export async function generateGiftCardAssets(giftCard, { code = '', pin = '', qrPayload = '', template = null } = {}) {
  const activeTemplate = template || (await getActiveGiftCardTemplateOrSeed());
  const variables = buildGiftCardVariables(giftCard, { code, pin });
  const qrDataUrl = qrPayload ? await generateGiftCardQrDataUrl(qrPayload).catch(() => '') : '';
  const html = renderGiftCardDocument(activeTemplate || {}, variables, { qrDataUrl });

  await mkdir(STORAGE_DIR, { recursive: true });
  const baseName = `giftcard-${giftCard._id?.toString() || Date.now()}`;
  const htmlPath = path.join(STORAGE_DIR, `${baseName}.html`);
  const pdfPath = path.join(STORAGE_DIR, `${baseName}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf8');
  await renderGiftCardPdf(pdfPath, { variables, qrDataUrl });
  const pdfBuffer = fs.readFileSync(pdfPath);

  return {
    html,
    qrDataUrl,
    variables,
    templateId: activeTemplate?._id || activeTemplate?.id || null,
    cardVisualUrl: `/storage/giftcards/${baseName}.html`,
    generatedPdfUrl: `/storage/giftcards/${baseName}.pdf`,
    pdfPath,
    pdfBase64: pdfBuffer.toString('base64'),
    pdfFileName: `${baseName}.pdf`
  };
}

export default {
  formatGiftCardAmount,
  buildGiftCardVariables,
  renderGiftCardHtmlFragment,
  renderGiftCardDocument,
  renderGiftCardPdf,
  renderGiftCardPreview,
  generateGiftCardAssets
};
