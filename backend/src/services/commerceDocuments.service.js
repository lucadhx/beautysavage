import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { config } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_JPG = path.resolve(__dirname, '../assets/gift-card/beautysavage-master.jpg');
const MASTER_PDF = path.resolve(__dirname, '../assets/gift-card/beautysavage-master.pdf');

/**
 * Texte que les polices standard du PDF savent écrire (WinAnsi).
 *
 * `Intl` en français sépare les milliers par une ESPACE FINE INSÉCABLE
 * (U+202F), que WinAnsi ne connaît pas : « 3 000,00 € » faisait échouer tout
 * le document — carte cadeau ou facture dès 1 000 €, donc l'émission elle-même.
 * Les espaces spéciales deviennent des espaces, et tout caractère hors
 * WinAnsi est retiré plutôt que de faire tomber le PDF.
 */
function pdfSafe(value) {
  return String(value ?? '')
    .replace(/[    ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e¡-ÿ€–—…]/g, '');
}

function euros(cents) {
  return pdfSafe(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100));
}

function publicUploadUrl(relativePath) {
  return `${config.publicUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;
}

function fittedText(font, text, { maxChars, maxWidth, maxSize, minSize }) {
  const value = pdfSafe(text).slice(0, maxChars).trim();
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(value, size) > maxWidth) size -= 1;
  return { value, size };
}

async function writeUpload(relativePath, bytes) {
  const absolutePath = path.join(config.paths.uploads, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes);
  return publicUploadUrl(relativePath);
}

async function embedGiftCardBackground(pdfDoc, page) {
  const jpgBytes = await fs.readFile(MASTER_JPG);
  const jpg = await pdfDoc.embedJpg(jpgBytes);
  const { width, height } = page.getSize();
  page.drawImage(jpg, { x: 0, y: 0, width, height });
}

export async function ensureGiftCardMasterPdf() {
  const jpgBytes = await fs.readFile(MASTER_JPG);
  const pdfDoc = await PDFDocument.create();
  const jpg = await pdfDoc.embedJpg(jpgBytes);
  const page = pdfDoc.addPage([jpg.width, jpg.height]);
  page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
  const bytes = await pdfDoc.save();
  await fs.writeFile(MASTER_PDF, bytes);
  return MASTER_PDF;
}

export async function generateGiftCardPdf({ cardId, codeMasked, code, senderName, recipientName, amountCents, message, siteUrl = '' }) {
  await ensureGiftCardMasterPdf();
  const pdfDoc = await PDFDocument.create();
  const jpgBytes = await fs.readFile(MASTER_JPG);
  const jpg = await pdfDoc.embedJpg(jpgBytes);
  const page = pdfDoc.addPage([jpg.width, jpg.height]);
  await embedGiftCardBackground(pdfDoc, page);

  const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const sans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.07, 0.06);
  const muted = rgb(0.35, 0.32, 0.29);
  /**
   * LE VISUEL N'A PLUS DE TRAITS À REMPLIR : le texte se pose sur la LIGNE DE
   * BASE de chaque libellé, juste après lui. Coordonnées mesurées sur le
   * visuel (1549 × 1137 px) — libellés « DE LA PART », « POUR », « MONTANT »
   * — et partagées avec l'aperçu de la vitrine (`GIFT_CARD_FIELDS`).
   */
  const fields = [
    { text: senderName, x: 1127, baseline: 453, maxChars: 30, maxWidth: 270 },
    { text: recipientName, x: 1078, baseline: 559, maxChars: 30, maxWidth: 320 },
    { text: euros(amountCents), x: 1110, baseline: 680, maxChars: 16, maxWidth: 290 },
  ];
  for (const field of fields) {
    const fitted = fittedText(serif, field.text, { maxChars: field.maxChars, maxWidth: field.maxWidth, maxSize: 30, minSize: 14 });
    page.drawText(fitted.value, { x: field.x, y: jpg.height - field.baseline, size: fitted.size, font: serif, color: ink });
  }
  if (message) {
    page.drawText(pdfSafe(message).slice(0, 120), { x: 949, y: jpg.height - 770, size: 20, font: serif, color: muted, maxWidth: 440, lineHeight: 26 });
  }
  page.drawText(`Code : ${code || codeMasked}`, { x: 949, y: jpg.height - 945, size: 18, font: sans, color: muted });
  const siteHost = String(siteUrl || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'beautysavage.ly-solution.com';
  page.drawText(pdfSafe(`Valable sur ${siteHost}`), { x: 949, y: jpg.height - 975, size: 15, font: sans, color: muted });

  return writeUpload(`gift-cards/${cardId}.pdf`, await pdfDoc.save());
}

export async function generateSaleInvoicePdf(sale, customer) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.08, 0.08, 0.08);
  const muted = rgb(0.35, 0.35, 0.35);
  const invoiceNumber = sale.invoice?.number || `FAC-${sale.saleNumber}`;

  page.drawText('BeautySavage', { x: 48, y: 780, size: 24, font: bold, color: black });
  page.drawText('Facture e-commerce', { x: 48, y: 748, size: 14, font, color: muted });
  page.drawText(invoiceNumber, { x: 380, y: 780, size: 16, font: bold, color: black });
  page.drawText(new Date().toLocaleDateString('fr-FR'), { x: 380, y: 756, size: 11, font, color: muted });
  page.drawText(pdfSafe(`Client : ${customer?.firstName || ''} ${customer?.lastName || ''}`.trim()), { x: 48, y: 705, size: 11, font, color: black });
  page.drawText(pdfSafe(`Email : ${customer?.email || ''}`), { x: 48, y: 686, size: 11, font, color: black });

  let y = 630;
  page.drawText('Designation', { x: 48, y, size: 11, font: bold, color: black });
  page.drawText('Qt.', { x: 395, y, size: 11, font: bold, color: black });
  page.drawText('Total TTC', { x: 455, y, size: 11, font: bold, color: black });
  y -= 24;
  for (const line of sale.lines || []) {
    page.drawText(pdfSafe(line.productSnapshot?.title || 'Article').slice(0, 58), { x: 48, y, size: 10, font, color: black });
    page.drawText(String(line.quantity || 1), { x: 400, y, size: 10, font, color: black });
    page.drawText(euros(line.totalCents), { x: 455, y, size: 10, font, color: black });
    y -= 16;
    // Les options choisies, sous l'article, avec leur prix (comprises dans le total de la ligne).
    for (const option of line.optionsSnapshot || []) {
      page.drawText(pdfSafe(`  + ${option.label}${option.priceCents > 0 ? ` (${euros(option.priceCents)})` : ' (incluse)'}`).slice(0, 70), { x: 56, y, size: 9, font, color: muted });
      y -= 14;
    }
    y -= 6;
  }
  y -= 10;
  page.drawText(`Regle par Stripe : ${euros(sale.stripeAmountCents || sale.totalCents)}`, { x: 320, y, size: 10, font, color: muted });
  y -= 20;
  page.drawText(`Regle par carte cadeau : ${euros(sale.giftCardAmountCents || 0)}`, { x: 320, y, size: 10, font, color: muted });
  y -= 28;
  page.drawText(`Total TTC : ${euros(sale.totalCents)}`, { x: 320, y, size: 14, font: bold, color: black });
  page.drawText('Document genere automatiquement depuis la commande payee.', { x: 48, y: 80, size: 9, font, color: muted });

  return writeUpload(`invoices/${invoiceNumber}.pdf`, await pdfDoc.save());
}

export async function generateCreditNotePdf(sale, customer, { amountCents, reason }) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const number = sale.creditNote?.number || `AV-${sale.saleNumber}`;
  page.drawText('BeautySavage', { x: 48, y: 780, size: 24, font: bold });
  page.drawText('Avoir e-commerce', { x: 48, y: 748, size: 14, font });
  page.drawText(number, { x: 380, y: 780, size: 16, font: bold });
  page.drawText(pdfSafe(`Client : ${customer?.email || ''}`), { x: 48, y: 700, size: 11, font });
  page.drawText(`Commande : ${sale.saleNumber}`, { x: 48, y: 676, size: 11, font });
  page.drawText(`Montant rembourse : ${euros(amountCents)}`, { x: 48, y: 630, size: 14, font: bold });
  page.drawText(pdfSafe(`Motif : ${String(reason || 'Remboursement').slice(0, 120)}`), { x: 48, y: 604, size: 11, font });
  return writeUpload(`credit-notes/${number}.pdf`, await pdfDoc.save());
}
