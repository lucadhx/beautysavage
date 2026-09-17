import fs from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import Invoice from '../models/Invoice.js';
import { VAT_LEGAL_LABEL } from '../constants/tax.js';
import { resolveInstituteName, resolveInstituteEmail } from './system/systemConfigurationService.js';

const STORAGE_DIR = path.join(process.cwd(), 'storage', 'invoices');
const TEMPLATE_PATH = path.join(process.cwd(), 'templates', 'invoice.html');
const TYPE_LABELS = {
  product: 'Produit',
  formation: 'Formation',
  'gift-card': 'Carte cadeau',
  'formation-option': 'Option de formation'
};
// B1 — mention légale sourcée depuis le contrat fiscal central (V1 : franchise 293 B).
const LEGAL_MENTION = VAT_LEGAL_LABEL;
const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let templateCache = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return currencyFormatter.format(amount);
}

function formatDisplayDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('fr-FR');
}

function roundToCents(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(amount * 100) / 100;
}

function buildInvoiceNumber() {
  const now = new Date();
  const dateSegment = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `INV-${dateSegment}-${suffix}`;
}

async function loadTemplate() {
  if (templateCache) return templateCache;
  templateCache = await readFile(TEMPLATE_PATH, 'utf8');
  return templateCache;
}

async function ensureStorageDir() {
  await mkdir(STORAGE_DIR, { recursive: true });
}

function buildItemsPayload(items = []) {
  if (!items.length) {
    return [
      {
        name: 'Non renseigné',
        typeLabel: 'Article',
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0
      }
    ];
  }
  return items.map(entry => {
    const name = String(entry.name || 'Article').trim();
    const typeLabel = TYPE_LABELS[entry.type] || entry.type || 'Article';
    const unitPrice = Number.isFinite(Number(entry.finalPrice))
      ? Number(entry.finalPrice)
      : Number.isFinite(Number(entry.price))
        ? Number(entry.price)
        : 0;
    const quantity =
      Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) > 0
        ? Number(entry.quantity)
        : 1;
    const lineTotal = roundToCents(unitPrice * quantity);
    return {
      name,
      typeLabel,
      quantity,
      unitPrice,
      lineTotal
    };
  });
}

function buildItemsRowsHtml(items) {
  return items
    .map(
      item => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.typeLabel)}</td>
          <td>${item.quantity}</td>
          <td>${escapeHtml(formatCurrency(item.unitPrice))}</td>
          <td>${escapeHtml(formatCurrency(item.lineTotal))}</td>
        </tr>
      `
    )
    .join('');
}

function replaceTemplateValues(template, values) {
  return Object.entries(values).reduce((acc, [key, value]) => {
    const safeValue = value ?? '';
    return acc.replace(new RegExp(`{{${key}}}`, 'g'), safeValue);
  }, template);
}

function drawTableHeader(doc, columns, y) {
  doc.font('Helvetica-Bold').fontSize(10);
  columns.forEach(column => {
    doc.text(column.label, column.x, y, {
      width: column.width,
      align: column.align || 'left'
    });
  });
}

function drawTableRow(doc, row, columns, y) {
  doc.font('Helvetica').fontSize(10);
  columns.forEach(column => {
    const content = row[column.key] ?? '';
    doc.text(content, column.x, y, {
      width: column.width,
      align: column.align || 'left'
    });
  });
}

function measureRowHeight(doc, row, columns) {
  doc.font('Helvetica').fontSize(10);
  const base = 16;
  return columns.reduce((max, column) => {
    const content = row[column.key] ?? '';
    const height = doc.heightOfString(content, {
      width: column.width,
      align: column.align || 'left'
    });
    return Math.max(max, height);
  }, base);
}

function renderPdf(targetPath, payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42 });
    const stream = fs.createWriteStream(targetPath);
    doc.pipe(stream);

    doc.font('Helvetica-Bold').fontSize(18).text('Facture client', {
      align: 'center'
    });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Facture ${payload.invoiceNumber}`, { align: 'left' });
    doc.text(`Émise le ${payload.invoiceDate}`, { align: 'left' });
    doc.text(`Vente ${payload.saleId}`, { align: 'left' });
    doc.moveDown(0.5);
    doc.text(`Client : ${payload.customerName}`);
    doc.text(`Email : ${payload.customerEmail}`);
    doc.moveDown(0.5);
    doc.text(`Institut : ${payload.vendorName}`);
    doc.text(`Contact : ${payload.vendorEmail}`);
    doc.moveDown(0.7);

    const startX = doc.x;
    const columnSpacing = 8;
    const columnSpecs = [
      { key: 'name', label: 'Article', ratio: 0.35 },
      { key: 'typeLabel', label: 'Type', ratio: 0.18, align: 'left' },
      { key: 'quantity', label: 'Quantité', ratio: 0.12, align: 'right' },
      { key: 'unitPrice', label: 'Prix unitaire', ratio: 0.2, align: 'right' },
      { key: 'lineTotal', label: 'Total', ratio: 0.15, align: 'right' }
    ];
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const contentWidth = availableWidth - columnSpacing * (columnSpecs.length - 1);
    let cursorX = startX;
    const columns = columnSpecs.map((spec, index) => {
      const width = Math.max(Math.floor(contentWidth * spec.ratio), 60);
      const column = { ...spec, x: cursorX, width };
      cursorX += width;
      if (index < columnSpecs.length - 1) {
        cursorX += columnSpacing;
      }
      return column;
    });
    const remaining = startX + availableWidth - cursorX;
    if (remaining > 0) {
      columns[columns.length - 1].width += remaining;
    }

    const headerY = doc.y + 6;
    drawTableHeader(doc, columns, headerY);
    const rowGap = 6;
    let cursorY = headerY + 18;

    function ensurePageSpace(rowHeight) {
      const threshold = doc.page.height - doc.page.margins.bottom - 40;
      if (cursorY + rowHeight > threshold) {
        doc.addPage();
        cursorY = doc.y + 6;
        drawTableHeader(doc, columns, cursorY);
        cursorY += 22;
      }
    }

    payload.items.forEach(row => {
      const rowData = {
        name: row.name,
        typeLabel: row.typeLabel,
        quantity: row.quantity.toString(),
        unitPrice: formatCurrency(row.unitPrice),
        lineTotal: formatCurrency(row.lineTotal)
      };
      const rowHeight = measureRowHeight(doc, rowData, columns);
      ensurePageSpace(rowHeight + rowGap);
      drawTableRow(doc, rowData, columns, cursorY);
      cursorY += rowHeight + rowGap;
    });

    doc.moveTo(doc.page.margins.left, cursorY + 4);
    doc.lineTo(doc.page.width - doc.page.margins.right, cursorY + 4);
    doc.strokeColor('#cccccc').stroke();

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(12).text(`Montant total : ${payload.totalAmount}`, {
      align: 'right'
    });
    // D2 — carte cadeau comme LIGNE DE RÈGLEMENT (pas une remise) + reste à payer.
    const gc = payload.giftCardReceipt;
    if (gc && Number(gc.giftCardPaymentAmount) > 0) {
      doc.font('Helvetica').fontSize(11).text(
        `Carte cadeau (règlement) : -${formatCurrency(gc.giftCardPaymentAmount)}`,
        { align: 'right' }
      );
      doc.font('Helvetica-Bold').fontSize(12).text(
        `Reste à payer : ${formatCurrency(gc.balanceDue)}`,
        { align: 'right' }
      );
      if (gc.fullyCoveredByGiftCard) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Oblique').fontSize(9).text(
          'Reçu d\'utilisation de carte cadeau — document interne, non fiscal.',
          { align: 'left' }
        );
      }
    }
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(9).text(LEGAL_MENTION, {
      align: 'left'
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Pré-React D2 — Info "carte cadeau comme règlement" pour le reçu interne.
 * La carte cadeau n'est PAS une remise : ligne de règlement, le prix vendu reste inchangé.
 * @param {object} sale
 * @returns {{ soldAmount:number, giftCardPaymentAmount:number, balanceDue:number, fullyCoveredByGiftCard:boolean }}
 */
export function buildGiftCardReceiptInfo(sale) {
  const soldAmount = roundToCents(sale?.totalAmount);
  const giftCardPaymentAmount = roundToCents(
    (Array.isArray(sale?.giftCardUsage) ? sale.giftCardUsage : []).reduce(
      (sum, g) => sum + Number(g?.amountUsed || 0),
      0
    )
  );
  const balanceDue = roundToCents(Math.max(0, soldAmount - giftCardPaymentAmount));
  return {
    soldAmount,
    giftCardPaymentAmount,
    balanceDue,
    fullyCoveredByGiftCard: giftCardPaymentAmount > 0 && balanceDue <= 0
  };
}

export async function createInvoiceForSale(sale) {
  if (!sale || !sale.saleId) {
    return null;
  }
  const existing = await Invoice.findOne({ saleId: sale.saleId });
  if (existing) {
    return existing;
  }
  const invoiceNumber = buildInvoiceNumber();
  const invoiceDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const items = buildItemsPayload(Array.isArray(sale.items) ? sale.items : []);
  const template = await loadTemplate();
  const htmlContent = replaceTemplateValues(template, {
    invoiceNumber,
    invoiceDate: formatDisplayDate(invoiceDate),
    saleId: sale.saleId,
    customerName: `${escapeHtml(sale.customer?.firstName || '')} ${escapeHtml(sale.customer?.lastName || '')}`.trim() || 'Client',
    customerEmail: escapeHtml(sale.customer?.email || 'non renseigné'),
    vendorName: escapeHtml(resolveInstituteName() || 'Institut Beauty Savage'),
    vendorEmail: escapeHtml(
      resolveInstituteEmail() || 'contact@beautysavage.fr'
    ),
    itemsRows: buildItemsRowsHtml(items),
    totalAmount: escapeHtml(formatCurrency(sale.totalAmount)),
    legalMention: LEGAL_MENTION
  });
  const fileName = `facture-${invoiceNumber}.pdf`;
  const filePath = path.join(STORAGE_DIR, fileName);
  await ensureStorageDir();
  // D2 — la carte cadeau apparaît comme ligne de RÈGLEMENT (pas une remise).
  const giftCardReceipt = buildGiftCardReceiptInfo(sale);
  await renderPdf(filePath, {
    vendorName: resolveInstituteName() || 'Institut Beauty Savage',
    vendorEmail: resolveInstituteEmail() || 'contact@beautysavage.fr',
    customerName: `${sale.customer?.firstName || ''} ${sale.customer?.lastName || ''}`.trim() || 'Client',
    customerEmail: sale.customer?.email || 'non renseigné',
    invoiceNumber,
    invoiceDate: formatDisplayDate(invoiceDate),
    saleId: sale.saleId,
    totalAmount: formatCurrency(sale.totalAmount),
    giftCardReceipt,
    items
  });
  const relativePath = path.relative(process.cwd(), filePath);
  const invoiceDoc = await Invoice.create({
    invoiceId: crypto.randomUUID(),
    invoiceNumber,
    saleId: sale.saleId,
    userId: sale.userId,
    totalAmount: Number.isFinite(Number(sale.totalAmount)) ? Number(sale.totalAmount) : 0,
    fileName,
    pdfPath: relativePath,
    htmlContent,
    invoiceDate,
    // C2/D2 — document interne NON fiscal. Si la commande est réglée 100 % en carte cadeau,
    // c'est un REÇU D'UTILISATION de carte cadeau (gift_card_usage_receipt) ; sinon un
    // snapshot interne. La facture officielle reste la facture Stripe (resolveOfficialInvoiceRef).
    documentKind: giftCardReceipt.fullyCoveredByGiftCard ? 'gift_card_usage_receipt' : 'internal_snapshot',
    official: false
  });
  return invoiceDoc;
}

/**
 * Pré-React C2 — Résout la référence de facture OFFICIELLE (fiscale) d'une vente.
 * La source officielle est la facture STRIPE ; le PDF interne n'est jamais officiel.
 * @param {object} invoice document Invoice (lean ou doc)
 * @returns {{ official: boolean, source: 'stripe'|'none', id: string|null, url: string|null }}
 */
export function resolveOfficialInvoiceRef(invoice) {
  const stripeInvoiceId = String(invoice?.stripeInvoiceId || '').trim();
  if (stripeInvoiceId) {
    return {
      official: true,
      source: 'stripe',
      id: stripeInvoiceId,
      url: String(invoice?.stripeHostedUrl || invoice?.stripeInvoicePdfUrl || '').trim() || null
    };
  }
  // Aucune facture Stripe (ex. 0 € / carte cadeau 100 %) → pas de document fiscal officiel.
  return { official: false, source: 'none', id: null, url: null };
}
