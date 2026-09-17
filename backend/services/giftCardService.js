import crypto from 'node:crypto';
import argon2 from 'argon2';

import GiftCard from '../models/GiftCard.js';
import { requireSecret } from '../utils/secretEnv.js';
import { emitGiftCardEvent } from './businessEventService.js';

const GIFT_CARD_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GIFT_CARD_PASSWORD_LENGTH = 10;
const GIFT_CARD_PASSWORD_SECRET = requireSecret('GIFT_CARD_PASSWORD_SECRET', { fallback: 'SESSION_SECRET' });
const GIFT_CARD_PASSWORD_KEY = crypto
  .createHash('sha256')
  .update(String(GIFT_CARD_PASSWORD_SECRET))
  .digest();

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function generateGiftCardPassword(length = GIFT_CARD_PASSWORD_LENGTH) {
  const normalizedLength = Math.max(8, Math.min(12, Number(length) || GIFT_CARD_PASSWORD_LENGTH));
  let output = '';
  while (output.length < normalizedLength) {
    const randomIndex = crypto.randomInt(0, GIFT_CARD_PASSWORD_CHARSET.length);
    output += GIFT_CARD_PASSWORD_CHARSET.charAt(randomIndex);
  }
  return output;
}

function encryptGiftCardPassword(password) {
  const normalizedPassword = String(password || '').trim();
  if (!normalizedPassword) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', GIFT_CARD_PASSWORD_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedPassword, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(part => part.toString('base64url')).join('.');
}

async function hashGiftCardPassword(password) {
  return argon2.hash(String(password || '').trim(), {
    type: argon2.argon2id
  });
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await GiftCard.exists({ code });
    if (!exists) return code;
  }
  throw new Error('Impossible de generer un code unique pour la carte cadeau.');
}

export async function createCompensationGiftCard({
  userId,
  amount,
  saleId = ''
} = {}) {
  if (!userId) {
    throw new Error('Utilisateur requis pour creer une carte cadeau.');
  }
  const normalizedAmount = roundToCents(Math.max(0, Number(amount || 0)));
  if (normalizedAmount <= 0) {
    throw new Error('Montant de carte cadeau invalide.');
  }

  const password = generateGiftCardPassword();
  const giftCard = new GiftCard({
    code: await generateUniqueCode(),
    userId,
    amount: normalizedAmount,
    balance: normalizedAmount,
    saleId: String(saleId || '').trim(),
    purchasedAt: new Date(),
    passwordHash: await hashGiftCardPassword(password),
    passwordEncrypted: encryptGiftCardPassword(password)
  });
  await giftCard.save();
  // Audit-only event (best-effort). Never includes the gift-card password.
  await emitGiftCardEvent('gift_card.created', giftCard, { extra: { amount: normalizedAmount, saleId: String(saleId || '') || null } });

  return {
    giftCard,
    password
  };
}
