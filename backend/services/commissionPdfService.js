import PDFDocument from 'pdfkit';
import { resolvePlatformName, resolveInstituteName } from './system/systemConfigurationService.js';

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

function formatCurrency(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return currencyFormatter.format(amount);
}

function formatDate(date) {
  if (!date) return 'Date inconnue';
  const candidate = new Date(date);
  if (Number.isNaN(candidate.getTime())) return 'Date inconnue';
  return candidate.toLocaleDateString('fr-FR');
}

function formatCommissionType(type, value, sourceType = 'sale') {
  if (sourceType === 'refund_adjustment') {
    return 'Ajustement remboursement';
  }
  if (sourceType === 'refund_reversal') {
    return 'Reversal remboursement';
  }
  if (type === 'percentage') {
    return `${Number(value || 0)}%`;
  }
  return formatCurrency(value);
}

function drawTableHeader(doc, x, y, columns) {
  doc.font('Helvetica-Bold').fontSize(10);
  columns.forEach(column => {
    doc.text(column.label, column.x, y, { width: column.width, align: column.align || 'left' });
  });
}

function drawTableRow(doc, row, x, y, columns) {
  doc.font('Helvetica').fontSize(10);
  columns.forEach(column => {
    const content = row[column.key] ?? '';
    doc.text(content, column.x, y, { width: column.width, align: column.align || 'left' });
  });
}

function measureRowHeight(doc, row, columns) {
  doc.font('Helvetica').fontSize(10);
  const baseHeight = 18;
  return columns.reduce((max, column) => {
    const content = row[column.key] ?? '';
    const height = doc.heightOfString(content, { width: column.width, align: column.align || 'left' });
    return Math.max(max, height);
  }, baseHeight);
}

export function buildCommissionPdf(entries, options = {}) {
  const {
    platformName = resolvePlatformName() || 'Beauty Savage',
    instituteName = resolveInstituteName() || 'Institut Beauty Savage',
    periodLabel = '',
    periodRangeLabel = '',
    generatedAt = new Date(),
    totalCommission = 0,
    invoiceNumber,
    issuer = {},
    recipient = {},
    title = 'Devis de commission',
    footerNote = 'Facture de commission - génération automatique'
  } = options;

  const issuerName = issuer.name || platformName;
  const issuerCompany = issuer.company || '';
  const issuerAddress = issuer.address || '';
  const issuerEmail = issuer.email || '';
  const recipientName = recipient.name || instituteName;
  const recipientAddress = recipient.address || '';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
    doc.moveDown(0.25);
    doc.fontSize(10);
    doc.font('Helvetica-Bold').text(`Facture n° ${invoiceNumber || '—'}`, { align: 'right' });
    doc.font('Helvetica').text(`Date d'émission : ${formatDate(generatedAt)}`, { align: 'right' });
    doc.text(`Période : ${periodLabel}`, { align: 'right' });
    if (periodRangeLabel) {
      doc.text(periodRangeLabel, { align: 'right' });
    }

    doc.moveDown(0.7);
    doc.font('Helvetica-Bold').text('Émetteur', { underline: true });
    doc.moveDown(0.1);
    doc.font('Helvetica').text(`${issuerName}${issuerCompany ? ` • ${issuerCompany}` : ''}`);
    if (issuerAddress) {
      doc.text(issuerAddress);
    }
    if (issuerEmail) {
      doc.text(`Email : ${issuerEmail}`);
    }
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Destinataire', { underline: true });
    doc.moveDown(0.1);
    doc.font('Helvetica').text(recipientName);
    if (recipientAddress) {
      doc.text(recipientAddress);
    }

    doc.moveDown(1);
    doc.fontSize(11).text('Détail des commissions', { underline: true });
    doc.moveDown(0.5);

    const startX = doc.x;
    const columnSpacing = 6;
    const columnSpecs = [
      { key: 'date', label: 'Date de vente', ratio: 0.12 },
      { key: 'saleId', label: 'ID de vente', ratio: 0.17 },
      { key: 'formationName', label: 'Nom de la formation', ratio: 0.34 },
      { key: 'price', label: 'Prix de vente', ratio: 0.12, align: 'right' },
      { key: 'commissionTypeLabel', label: 'Type', ratio: 0.12 },
      { key: 'commissionAmountLabel', label: 'Montant', ratio: 0.13, align: 'right' }
    ];
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const contentWidth = availableWidth - columnSpacing * (columnSpecs.length - 1);
    let cursorX = startX;
    const columns = columnSpecs.map((spec, index) => {
      const width = Math.max(Math.floor(contentWidth * spec.ratio), 60);
      const column = { ...spec, x: cursorX, width, align: spec.align };
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

    const headerY = doc.y;
    drawTableHeader(doc, startX, headerY, columns);
    const ROW_GAP = 10;
    const HEADER_GAP = 12;
    let cursorY = headerY + 18 + HEADER_GAP;

    function ensurePageSpace(nextRowHeight) {
      const threshold = doc.page.height - doc.page.margins.bottom - 40;
      if (cursorY + nextRowHeight > threshold) {
        doc.addPage();
        doc.fontSize(11).text('Détail des commissions (suite)', { underline: true });
        doc.moveDown(0.5);
        drawTableHeader(doc, startX, doc.y, columns);
        cursorY = doc.y + 18 + HEADER_GAP;
      }
    }

    entries.forEach(entry => {
      const row = {
        date: formatDate(entry.date),
        saleId: entry.saleId || 'N/A',
        formationName: entry.formationName || 'Formation inconnue',
        price: formatCurrency(entry.price),
        commissionTypeLabel: formatCommissionType(entry.commissionType, entry.commissionValue),
        commissionAmountLabel: formatCurrency(entry.commissionAmount)
      };
      const rowHeight = measureRowHeight(doc, row, columns);
      ensurePageSpace(rowHeight + ROW_GAP);
      drawTableRow(doc, row, startX, cursorY, columns);
      cursorY += rowHeight + ROW_GAP;
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total des commissions : ${formatCurrency(totalCommission)}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9);
    doc.text(footerNote, { align: 'center' });

    doc.end();
  });
}
