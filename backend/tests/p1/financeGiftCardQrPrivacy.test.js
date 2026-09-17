// tests/p1/financeGiftCardQrPrivacy.test.js
// RX2.6 — Confidentialité : jamais le code/mot de passe/token complet ; AUCUNE mention d'expiration.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import GiftCard from '../../models/GiftCard.js';
import { getGiftCardFinanceDetail, listGiftCardFinanceCards } from '../../services/finance/giftCardFinanceService.js';

const oid = () => new mongoose.Types.ObjectId();
const FULL_CODE = 'SUPERSECRETCODE9';
const TOKEN_HASH = 'b'.repeat(64);

describe('RX2.6 — QR/privacy + no expiration wording', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('ni code complet, ni token, ni mot de passe dans le payload', async () => {
    const card = await GiftCard.create({
      code: FULL_CODE, userId: oid(), amount: 80, balance: 80, status: 'active', purchasedAt: new Date(),
      creationMode: 'manual_institute', paymentMode: 'on_site', qrTokenHash: TOKEN_HASH,
      passwordHash: 'HASHVALUE', passwordEncrypted: 'ENCVALUE',
    });
    const detail = await getGiftCardFinanceDetail(String(card._id));
    const json = JSON.stringify(detail);
    expect(json).not.toContain(FULL_CODE);
    expect(json).not.toContain(TOKEN_HASH);
    expect(json).not.toContain('HASHVALUE');
    expect(json).not.toContain('ENCVALUE');
    expect(detail.giftCard.maskedCode).toBe('••••ODE9');
    expect(detail.qr.maskedToken).toBe('••••');

    const list = await listGiftCardFinanceCards({});
    expect(JSON.stringify(list)).not.toContain(FULL_CODE);
  });

  it('aucun libellé ne mentionne l\'expiration', async () => {
    const card = await GiftCard.create({ code: FULL_CODE, userId: oid(), amount: 80, balance: 80, status: 'active', purchasedAt: new Date(), creationMode: 'manual_institute', paymentMode: 'on_site', qrTokenHash: TOKEN_HASH });
    const detail = await getGiftCardFinanceDetail(String(card._id));
    const json = JSON.stringify(detail).toLowerCase();
    expect(json).not.toContain('expir'); // ni "expire", ni "expiration"
  });
});
