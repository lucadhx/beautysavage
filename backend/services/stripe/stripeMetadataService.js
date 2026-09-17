// services/stripe/stripeMetadataService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE des helpers de métadonnées Stripe (partagés
// entre la création de PaymentIntent et la reconstruction de contexte côté webhook). Aucune
// modification de comportement : fonctions déplacées verbatim.

export function normalizeCurrency(value, fallback = 'eur') {
  return String(value || fallback).toLowerCase();
}

export function normalizeStripeId(value) {
  return String(value || '').trim();
}

export function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

export function stringifyMetadataValue(value, maxLength = 500) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
}

export function buildPaymentIntentCheckoutMetadata({ intentId, userId, checkoutState } = {}) {
  const item = checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const selectedOptionIds = Array.isArray(item?.selectedOptions)
    ? item.selectedOptions
        .map(option => String(option?.optionId || '').trim())
        .filter(Boolean)
    : [];
  const appliedGiftCards = Array.isArray(checkoutState?.appliedGiftCards)
    ? checkoutState.appliedGiftCards
        .map(entry => {
          const code = String(entry?.code || '').trim().toUpperCase();
          const amount = Number(entry?.amount ?? entry?.amountUsed);
          if (!code || !Number.isFinite(amount) || amount <= 0) return '';
          return `${encodeURIComponent(code)}~${Math.round(amount * 100) / 100}`;
        })
        .filter(Boolean)
    : [];

  return {
    intentId: stringifyMetadataValue(intentId, 120),
    userId: stringifyMetadataValue(userId, 120),
    itemType: stringifyMetadataValue(item?.type || '', 24),
    itemId: stringifyMetadataValue(item?.id || '', 120),
    sessionId: stringifyMetadataValue(item?.sessionId || '', 120),
    giftCardAmount: stringifyMetadataValue(
      item?.amount ?? checkoutState?.totals?.subtotal ?? checkoutState?.totals?.remainingToPay ?? '',
      32
    ),
    giftCardRemainingToPay: stringifyMetadataValue(checkoutState?.totals?.remainingToPay ?? '', 32),
    giftCardName: stringifyMetadataValue(item?.name || 'Carte cadeau', 120),
    giftCardRecipientName: stringifyMetadataValue(item?.recipientName || '', 120),
    giftCardRecipientEmail: stringifyMetadataValue(item?.recipientEmail || '', 120),
    giftCardMessage: stringifyMetadataValue(item?.message || '', 350),
    selectedOptions: stringifyMetadataValue(selectedOptionIds.join(','), 500),
    appliedGiftCards: stringifyMetadataValue(appliedGiftCards.join('|'), 500)
  };
}

export function parseSelectedOptionsMetadata(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) return [];
  return value
    .split(',')
    .map(entry => String(entry || '').trim())
    .filter(Boolean)
    .map(optionId => ({ optionId }));
}

export function parseAppliedGiftCardsMetadata(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) return [];
  return value
    .split('|')
    .map(entry => String(entry || '').trim())
    .filter(Boolean)
    .map(entry => {
      const [rawCode, rawAmount] = entry.split('~');
      const code = String(rawCode || '').trim();
      const amount = Number(rawAmount);
      if (!code || !Number.isFinite(amount) || amount <= 0) return null;
      let decodedCode = '';
      try {
        decodedCode = decodeURIComponent(code).trim().toUpperCase();
      } catch (_error) {
        decodedCode = code.trim().toUpperCase();
      }
      if (!decodedCode) return null;
      return {
        code: decodedCode,
        amount: Math.round(amount * 100) / 100
      };
    })
    .filter(Boolean);
}

export function buildWebhookFallbackPayload(paymentIntent = null) {
  const metadata = paymentIntent?.metadata && typeof paymentIntent.metadata === 'object'
    ? paymentIntent.metadata
    : {};
  const userId = stringifyMetadataValue(metadata?.userId, 120);
  const metadataItemType = stringifyMetadataValue(metadata?.itemType, 24).toLowerCase();
  const itemType = ['formation', 'product', 'gift-card', 'service'].includes(metadataItemType)
    ? metadataItemType
    : 'formation';
  const itemId = stringifyMetadataValue(metadata?.itemId, 120) || (itemType === 'gift-card' ? 'gift-card' : '');
  if (!userId || !itemId) return null;
  const sessionId = stringifyMetadataValue(metadata?.sessionId, 120) || null;
  const giftCardAmount = Number(metadata?.giftCardAmount);
  const giftCardRemainingToPay = Number(metadata?.giftCardRemainingToPay);
  const normalizedGiftCardAmount = Number.isFinite(giftCardAmount) && giftCardAmount > 0
    ? roundToCents(giftCardAmount)
    : 0;
  const normalizedGiftCardRemaining = Number.isFinite(giftCardRemainingToPay) && giftCardRemainingToPay >= 0
    ? roundToCents(giftCardRemainingToPay)
    : normalizedGiftCardAmount;
  const giftCardName = stringifyMetadataValue(metadata?.giftCardName || 'Carte cadeau', 120) || 'Carte cadeau';
  const giftCardRecipientName = stringifyMetadataValue(metadata?.giftCardRecipientName || '', 120);
  const giftCardRecipientEmail = stringifyMetadataValue(metadata?.giftCardRecipientEmail || '', 120);
  const giftCardMessage = stringifyMetadataValue(metadata?.giftCardMessage || '', 350);
  const checkoutState = itemType === 'gift-card'
    ? {
        item: {
          type: 'gift-card',
          id: itemId,
          name: giftCardName,
          amount: normalizedGiftCardAmount,
          recipientName: giftCardRecipientName,
          recipientEmail: giftCardRecipientEmail,
          message: giftCardMessage
        },
        items: [
          {
            type: 'gift-card',
            id: itemId,
            name: giftCardName,
            amount: normalizedGiftCardAmount
          }
        ],
        totals: {
          basePrice: normalizedGiftCardAmount,
          discountAmount: 0,
          subtotal: normalizedGiftCardAmount,
          giftCardUsed: roundToCents(Math.max(0, normalizedGiftCardAmount - normalizedGiftCardRemaining)),
          remainingToPay: normalizedGiftCardRemaining
        },
        legal: {
          acceptedCgv: true,
          waiverRequired: false,
          waiverAccepted: false,
          waiverText: '',
          dateFormation: null
        },
        paymentProvider: 'stripe'
      }
    : null;
  return {
    userId,
    itemType,
    itemId,
    sessionId,
    selectedOptions: parseSelectedOptionsMetadata(metadata?.selectedOptions),
    appliedGiftCards: parseAppliedGiftCardsMetadata(metadata?.appliedGiftCards),
    checkoutState
  };
}
