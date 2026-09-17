// services/evaluation/certificateService.js
// FORMATION-EVALUATION — Génération du diplôme (PDF + QR).
//
// Mirroir de attestationRenderService (C3) : PDF pdfkit dans storage/certificates/<number>.pdf
// (gitignoré, jamais servi statiquement → téléchargement streamé), numéro opaque BS-DIP-…, idempotent.
// QR = librairie `qrcode` (comme giftCardQrService), encode un token opaque (BSDIP.v1.<token>) pour
// une future vérification d'authenticité — AUCUN secret dans le QR, pas d'endpoint de vérif dans ce lot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { resolveInstituteName } from '../system/systemConfigurationService.js';
import Certificate from '../../models/Certificate.js';

const CERT_DIR = path.join(process.cwd(), 'storage', 'certificates');

export function certificatePathForNumber(certificateNumber) {
  return path.join(CERT_DIR, `${certificateNumber}.pdf`);
}

export function generateCertificateNumber() {
  return `BS-DIP-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
}

export function generateCertificateQrToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function buildQrPayload(qrToken) {
  return `BSDIP.v1.${qrToken}`;
}

async function generateQrDataUrl(payload) {
  try {
    const { default: QRCode } = await import('qrcode');
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M', margin: 1, width: 160,
      color: { dark: '#1f2937', light: '#FFFFFF' }
    });
  } catch (err) {
    console.warn('[certificate] QR indisponible:', err?.message || err);
    return '';
  }
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

/** Rend le PDF du diplôme (A4 paysage, cadre, en-tête institut, nom client, formation, date, n°, QR, signature). */
export function renderCertificatePdf(targetPath, { variables, qrDataUrl }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48 });
      const stream = fs.createWriteStream(targetPath);
      doc.pipe(stream);

      const pageW = doc.page.width;
      const pageH = doc.page.height;

      // Cadre
      doc.save();
      doc.lineWidth(2).strokeColor('#c9a26a').rect(28, 28, pageW - 56, pageH - 56).stroke();
      doc.lineWidth(0.5).strokeColor('#c9a26a').rect(36, 36, pageW - 72, pageH - 72).stroke();
      doc.restore();

      // En-tête institut
      doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(20)
        .text(String(variables.instituteName || 'Beauty Savage'), 0, 70, { align: 'center' });

      // Titre
      doc.moveDown(1.2);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(34)
        .text('Diplôme de formation', { align: 'center' });

      // Corps
      doc.moveDown(1.2);
      doc.fillColor('#374151').font('Helvetica').fontSize(15)
        .text('Décerné à', { align: 'center' });
      doc.moveDown(0.4);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(26)
        .text(String(variables.clientName || 'Apprenant'), { align: 'center' });
      doc.moveDown(0.6);
      doc.fillColor('#374151').font('Helvetica').fontSize(15)
        .text('pour la réussite de la formation', { align: 'center' });
      doc.moveDown(0.4);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20)
        .text(String(variables.formationName || ''), { align: 'center' });

      doc.moveDown(1.2);
      doc.fillColor('#6b7280').font('Helvetica').fontSize(12)
        .text(`Délivré le ${variables.issuedAt || ''}`, { align: 'center' });

      // QR (bas gauche)
      const qrBuf = dataUrlToBuffer(qrDataUrl);
      if (qrBuf) {
        doc.image(qrBuf, 60, pageH - 150, { width: 90, height: 90 });
        doc.fillColor('#9ca3af').fontSize(8)
          .text('Vérification', 60, pageH - 56, { width: 90, align: 'center' });
      }

      // Numéro (bas centre)
      doc.fillColor('#6b7280').font('Helvetica').fontSize(10)
        .text(`N° ${variables.certificateNumber || ''}`, 0, pageH - 70, { align: 'center' });

      // Signature (bas droite)
      const sigX = pageW - 240;
      doc.lineWidth(0.8).strokeColor('#9ca3af').moveTo(sigX, pageH - 90).lineTo(sigX + 160, pageH - 90).stroke();
      doc.fillColor('#6b7280').fontSize(10)
        .text('Signature', sigX, pageH - 84, { width: 160, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(targetPath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function buildCertificateVariables(certificate) {
  const issued = certificate.issuedAt ? new Date(certificate.issuedAt) : new Date();
  return {
    instituteName: certificate.instituteNameSnapshot || resolveInstituteName() || 'Beauty Savage',
    clientName: certificate.clientNameSnapshot || 'Apprenant',
    formationName: certificate.formationNameSnapshot || '',
    certificateNumber: certificate.certificateNumber,
    issuedAt: issued.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  };
}

/**
 * Garantit l'existence du PDF pour un certificat (idempotent). Renvoie { pdfPath, pdfBase64 }.
 */
export async function ensureCertificatePdf(certificate) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const pdfPath = certificatePathForNumber(certificate.certificateNumber);
  if (!fs.existsSync(pdfPath)) {
    const variables = buildCertificateVariables(certificate);
    const qrDataUrl = await generateQrDataUrl(buildQrPayload(certificate.qrToken || ''));
    await renderCertificatePdf(pdfPath, { variables, qrDataUrl });
    if (!certificate.pdfGeneratedAt) {
      certificate.pdfGeneratedAt = new Date();
      if (typeof certificate.save === 'function') await certificate.save().catch(() => {});
    }
  }
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  return { pdfPath, pdfBase64 };
}

/**
 * Crée un certificat pour une décision de validation + rend le PDF. Idempotent par tentative
 * (au plus un certificat par attempt). Renvoie { certificate, pdfBase64 }.
 */
export async function issueCertificate({ user, formation, attempt, decisionId, reviewerId }) {
  const existing = await Certificate.findOne({ attemptId: attempt._id });
  if (existing) {
    const { pdfBase64 } = await ensureCertificatePdf(existing);
    return { certificate: existing, pdfBase64 };
  }
  const clientName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
    || user?.email || 'Apprenant';
  const certificate = await Certificate.create({
    certificateNumber: generateCertificateNumber(),
    userId: user?._id || attempt.userId,
    formationId: attempt.formationId,
    attemptId: attempt._id,
    decisionId: decisionId || null,
    qrToken: generateCertificateQrToken(),
    clientNameSnapshot: clientName,
    formationNameSnapshot: formation?.name || '',
    instituteNameSnapshot: resolveInstituteName() || 'Beauty Savage',
    issuedAt: new Date(),
    reviewerId: reviewerId || null
  });
  const { pdfBase64 } = await ensureCertificatePdf(certificate);
  return { certificate, pdfBase64 };
}

/** Stream le PDF en téléchargement (comme les attestations). */
export function streamCertificatePdf(res, pdfPath, formationName) {
  const safe = String(formationName || 'formation').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="diplome-${safe}.pdf"`);
  res.sendFile(pdfPath);
}

export default { issueCertificate, ensureCertificatePdf, streamCertificatePdf, certificatePathForNumber, generateCertificateNumber };
