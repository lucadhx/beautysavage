// tests/p1/giftCardQrService.test.js
// M13 — QR carte cadeau : le payload ne contient JAMAIS le secret ; le token est opaque ; un QR
// invalide est rejeté ; la rotation produit un nouveau hash. Tests purs (pas de DB requise).
import { describe, it, expect } from 'vitest';
import {
  generateGiftCardQrToken,
  generateGiftCardQrPayload,
  parseGiftCardQrPayload,
  hashGiftCardQrToken,
  rotateGiftCardQrToken,
  GIFT_CARD_QR_CURRENT_VERSION
} from '../../services/giftCard/giftCardQrService.js';

describe('M13 — giftCardQrService', () => {
  it('génère un token opaque + hash + version', () => {
    const { token, tokenHash, version } = generateGiftCardQrToken();
    expect(token).toBeTruthy();
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(version).toBe(GIFT_CARD_QR_CURRENT_VERSION);
    expect(token).not.toBe(tokenHash); // le clair ≠ le hash stocké
  });

  it('le payload QR NE contient PAS le code secret ni le mot de passe ni le montant', () => {
    const { token } = generateGiftCardQrToken();
    const secretCode = 'A3F2B9E1';
    const secretPin = 'K7M2P9QXTV';
    const payload = generateGiftCardQrPayload({ token });
    expect(payload).toContain('BSGC');
    expect(payload).toContain(token);
    expect(payload).not.toContain(secretCode);
    expect(payload).not.toContain(secretPin);
    // Aucune valeur monétaire : ni "80.00" ni "80,00".
    expect(payload).not.toContain('80.00');
    expect(payload).not.toContain('80,00');
  });

  it('parse correctement un payload valide et rejette les invalides', () => {
    const { token } = generateGiftCardQrToken();
    const payload = generateGiftCardQrPayload({ token });
    const parsed = parseGiftCardQrPayload(payload);
    expect(parsed).toEqual({ version: GIFT_CARD_QR_CURRENT_VERSION, token });

    expect(parseGiftCardQrPayload('')).toBeNull();
    expect(parseGiftCardQrPayload('NOPE.v1.abc')).toBeNull();
    expect(parseGiftCardQrPayload('BSGC.xx.abc')).toBeNull();
    expect(parseGiftCardQrPayload('BSGC.v1')).toBeNull();
  });

  it('hashGiftCardQrToken est stable et déterministe', () => {
    const { token } = generateGiftCardQrToken();
    expect(hashGiftCardQrToken(token)).toBe(hashGiftCardQrToken(token));
    expect(hashGiftCardQrToken('')).toBe('');
  });

  it('rotateGiftCardQrToken met à jour le hash + la version sur la carte', () => {
    const card = { qrTokenHash: '', qrPayloadVersion: 0 };
    const { token, payload } = rotateGiftCardQrToken(card);
    expect(card.qrTokenHash).toBe(hashGiftCardQrToken(token));
    expect(card.qrPayloadVersion).toBe(GIFT_CARD_QR_CURRENT_VERSION);
    expect(payload).toContain(token);
    // Une 2e rotation change le hash.
    const previousHash = card.qrTokenHash;
    rotateGiftCardQrToken(card);
    expect(card.qrTokenHash).not.toBe(previousHash);
  });
});
