// FORMATION-EVALUATION — Génération réelle du diplôme (pdfkit + QR), idempotence.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import Certificate from '../../models/Certificate.js';
import { issueCertificate } from '../../services/evaluation/certificateService.js';

const user = { _id: new mongoose.Types.ObjectId(), firstName: 'Camille', lastName: 'Durand', email: 'c@d.fr' };
const formation = { _id: new mongoose.Types.ObjectId(), name: 'Extensions de cils' };

describe('certificat', () => {
  beforeAll(async () => { await mongoose.connect(await startMemoryDb(), { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('génère un certificat + PDF (base64 %PDF) avec numéro opaque BS-DIP-', async () => {
    const attempt = await EvaluationAttempt.create({ formationId: formation._id, userId: user._id, status: 'submitted' });
    const { certificate, pdfBase64 } = await issueCertificate({ user, formation, attempt });
    expect(certificate.certificateNumber).toMatch(/^BS-DIP-[0-9A-F]+$/);
    expect(certificate.qrToken).toBeTruthy();
    expect(certificate.clientNameSnapshot).toBe('Camille Durand');
    expect(certificate.formationNameSnapshot).toBe('Extensions de cils');
    // base64 d'un PDF commence par "JVBERi0" (== "%PDF-")
    expect(pdfBase64.startsWith('JVBERi0')).toBe(true);
    const stored = await Certificate.findById(certificate._id).lean();
    expect(stored.pdfGeneratedAt).toBeTruthy();
  });

  it('idempotent : un seul certificat par tentative', async () => {
    const attempt = await EvaluationAttempt.create({ formationId: formation._id, userId: user._id, status: 'submitted' });
    const a = await issueCertificate({ user, formation, attempt });
    const b = await issueCertificate({ user, formation, attempt });
    expect(a.certificate.certificateNumber).toBe(b.certificate.certificateNumber);
    expect(await Certificate.countDocuments({ attemptId: attempt._id })).toBe(1);
  });
});
