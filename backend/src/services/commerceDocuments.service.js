import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { config } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_JPG = path.resolve(__dirname, '../assets/gift-card/beautysavage-master.jpg');
const MASTER_PDF = path.resolve(__dirname, '../assets/gift-card/beautysavage-master.pdf');

function euros(cents) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100);
}

function publicUploadUrl(relativePath) {
  return `${config.publicUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;
}

function fittedText(font, text, { maxChars, maxWidth, maxSize, minSize }) {
  const value = String(text || '').slice(0, maxChars).trim();
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

export async function generateGiftCardPdf({ cardId, codeMasked, code, senderName, recipientName, amountCents, message }) {
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
  const left = 1130;
  const sender = fittedText(serif, senderName, { maxChars: 30, maxWidth: 245, maxSize: 30, minSize: 16 });
  const recipient = fittedText(serif, recipientName, { maxChars: 30, maxWidth: 245, maxSize: 30, minSize: 16 });
  const amount = fittedText(serif, euros(amountCents), { maxChars: 16, maxWidth: 230, maxSize: 32, minSize: 18 });
  page.drawText(sender.value, { x: left, y: 660, size: sender.size, font: serif, color: ink });
  page.drawText(recipient.value, { x: left, y: 556, size: recipient.size, font: serif, color: ink });
  page.drawText(amount.value, { x: left, y: 433, size: amount.size, font: serif, color: ink });
  if (message) {
    page.drawText(String(message).slice(0, 95), { x: 950, y: 340, size: 20, font: serif, color: muted, maxWidth: 430, lineHeight: 24 });
  }
  page.drawText(`Code : ${code || codeMasked}`, { x: 950, y: 245, size: 18, font: sans, color: muted });
  page.drawText('Valable sur beautysavage.ly-solution.com', { x: 950, y: 218, size: 15, font: sans, color: muted });

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
  page.drawText(`Client : ${customer?.firstName || ''} ${customer?.lastName || ''}`.trim(), { x: 48, y: 705, size: 11, font, color: black });
  page.drawText(`Email : ${customer?.email || ''}`, { x: 48, y: 686, size: 11, font, color: black });

  let y = 630;
  page.drawText('Designation', { x: 48, y, size: 11, font: bold, color: black });
  page.drawText('Qt.', { x: 395, y, size: 11, font: bold, color: black });
  page.drawText('Total TTC', { x: 455, y, size: 11, font: bold, color: black });
  y -= 24;
  for (const line of sale.lines || []) {
    page.drawText(String(line.productSnapshot?.title || 'Article').slice(0, 58), { x: 48, y, size: 10, font, color: black });
    page.drawText(String(line.quantity || 1), { x: 400, y, size: 10, font, color: black });
    page.drawText(euros(line.totalCents), { x: 455, y, size: 10, font, color: black });
    y -= 22;
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
  page.drawText(`Client : ${customer?.email || ''}`, { x: 48, y: 700, size: 11, font });
  page.drawText(`Commande : ${sale.saleNumber}`, { x: 48, y: 676, size: 11, font });
  page.drawText(`Montant rembourse : ${euros(amountCents)}`, { x: 48, y: 630, size: 14, font: bold });
  page.drawText(`Motif : ${String(reason || 'Remboursement').slice(0, 120)}`, { x: 48, y: 604, size: 11, font });
  return writeUpload(`credit-notes/${number}.pdf`, await pdfDoc.save());
}
