// C3 — Génération attestation de fin de formation (PDF). Réutilise pdfkit (comme M13 gift cards).
// V1 : rendu structuré pdfkit (pas de HTML/CSS pixel-perfect — voir évolution future). Le HTML
// AttestationTemplate sert au preview studio + à un rendu HTML simple (substitution variables).
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import PDFDocument from 'pdfkit';

import AttestationTemplate from '../../models/AttestationTemplate.js';
import { resolveInstituteName } from '../system/systemConfigurationService.js';

const ATTESTATION_DIR = path.join(process.cwd(), 'storage', 'attestations');

function formatDate(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Variables d'attestation à partir des entités. instituteName via S1 (config DB → env). */
export function buildAttestationVariables({ formation, user, progress, certificateId }) {
  const clientName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || 'Apprenant';
  return {
    clientName,
    formationTitle: formation?.name || 'Formation',
    completedAt: formatDate(progress?.completedAt),
    instituteName: resolveInstituteName() || 'Beauty Savage',
    certificateId: certificateId || '',
    progressPercent: '100'
  };
}

/** Rendu HTML simple (substitution {{var}} dans le template). Sert au preview + usage léger. */
export function renderAttestationHtml({ template, variables }) {
  let html = template?.html || '<div style="font-family:sans-serif;text-align:center"><h1>Attestation de réussite</h1><p>{{clientName}} a terminé {{formationTitle}} le {{completedAt}}.</p><p>{{instituteName}}</p><p style="color:#94a3b8">Réf. {{certificateId}}</p></div>';
  for (const [k, v] of Object.entries(variables || {})) {
    html = html.replaceAll(`{{${k}}}`, String(v));
  }
  return html;
}

/** Dessine l'attestation en PDF (pdfkit, A4 paysage). Retourne le chemin écrit. */
export function renderAttestationPdf(targetPath, { variables = {} } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48 });
      const stream = fs.createWriteStream(targetPath);
      doc.pipe(stream);

      const pageW = doc.page.width;
      const left = 48;
      const width = pageW - 96;

      // Cadre.
      doc.lineWidth(2).strokeColor('#5f4ff7').rect(24, 24, pageW - 48, doc.page.height - 48).stroke();

      // En-tête institut.
      doc.fillColor('#5f4ff7').fontSize(14).text(variables.instituteName || '', left, 56, { width, align: 'center' });

      // Titre.
      doc.fillColor('#0f172a').fontSize(34).text('Attestation de réussite', left, 130, { width, align: 'center' });

      // Corps.
      doc.fillColor('#475569').fontSize(14).text('Nous attestons que', left, 210, { width, align: 'center' });
      doc.fillColor('#0f172a').fontSize(26).text(variables.clientName || '', left, 240, { width, align: 'center' });
      doc.fillColor('#475569').fontSize(14).text('a suivi et terminé avec succès la formation', left, 290, { width, align: 'center' });
      doc.fillColor('#0f172a').fontSize(20).text(variables.formationTitle || '', left, 320, { width, align: 'center' });

      // Date.
      doc.fillColor('#475569').fontSize(13).text(`Terminée le ${variables.completedAt || ''}`, left, 372, { width, align: 'center' });

      // Pied : référence certificat (opaque, aucune donnée sensible).
      doc.fillColor('#94a3b8').fontSize(9).text(`Référence : ${variables.certificateId || ''}`, left, doc.page.height - 80, { width, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(targetPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

export function attestationPathForCertificate(certificateId) {
  return path.join(ATTESTATION_DIR, `${certificateId}.pdf`);
}

async function loadActiveTemplate() {
  let t = await AttestationTemplate.findOne({ active: true }).lean();
  if (!t) t = (await AttestationTemplate.create({})).toObject();
  return t;
}

/**
 * Génère (ou réutilise) l'attestation PDF pour une progression TERMINÉE. Idempotent : si un
 * certificateId existe déjà et que le fichier est présent, on le renvoie. Sinon on (re)génère.
 * @returns {Promise<{ certificateId, pdfPath, generatedAt, variables }>}
 */
export async function getOrCreateAttestationForProgress(progressDoc, { formation, user }) {
  await mkdir(ATTESTATION_DIR, { recursive: true });

  const existingId = progressDoc.attestation?.certificateId;
  if (existingId) {
    const p = attestationPathForCertificate(existingId);
    if (fs.existsSync(p)) {
      const variables = buildAttestationVariables({ formation, user, progress: progressDoc, certificateId: existingId });
      return { certificateId: existingId, pdfPath: p, generatedAt: progressDoc.attestation.generatedAt, variables };
    }
  }

  const certificateId = `BS-CERT-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
  const variables = buildAttestationVariables({ formation, user, progress: progressDoc, certificateId });
  const pdfPath = attestationPathForCertificate(certificateId);
  const template = await loadActiveTemplate();
  // Le HTML du template est rendu (preview/usage léger) ; le PDF est dessiné en pdfkit V1.
  void renderAttestationHtml({ template, variables });
  await renderAttestationPdf(pdfPath, { variables });

  progressDoc.attestation = { certificateId, generatedAt: new Date() };
  await progressDoc.save();

  return { certificateId, pdfPath, generatedAt: progressDoc.attestation.generatedAt, variables };
}
