import {
  DISTANT_LEARNING_WAIVER_TEXT,
  PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
  PRESENTIEL_WAIVER_WITHIN_7_TEXT,
  RETRACTATION_DAYS
} from '../constants/consumerWaiver.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function normalizeLegalText(value) {
  return String(value || '').normalize('NFC').trim();
}

function readWaiverText(payload) {
  if (typeof payload?.renonciation_text === 'string') {
    return normalizeLegalText(payload.renonciation_text);
  }
  if (typeof payload?.renonciationText === 'string') {
    return normalizeLegalText(payload.renonciationText);
  }
  if (typeof payload?.consumerWaiverAcceptedText === 'string') {
    return normalizeLegalText(payload.consumerWaiverAcceptedText);
  }
  if (typeof payload?.waiverAcceptedText === 'string') {
    return normalizeLegalText(payload.waiverAcceptedText);
  }
  return '';
}

function readAcceptedCgv(payload) {
  if (payload?.accepted_cgv === true) return true;
  if (payload?.acceptedCgv === true) return true;
  if (payload?.acceptedCGV === true) return true;
  return false;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeRefundDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, parsed);
}

function buildValidationError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

export function isWaiverRequired({ daysBeforeFormation, refundDays } = {}) {
  const days = Number(daysBeforeFormation);
  if (!Number.isFinite(days)) return false;
  const resolvedRefundDays = normalizeRefundDays(refundDays);
  return days < Math.max(RETRACTATION_DAYS, resolvedRefundDays);
}

export function getPresentielWaiverExpectation({ dateAchat, dateFormation, refundDays } = {}) {
  const achat = normalizeDate(dateAchat) || new Date();
  const formation = normalizeDate(dateFormation);
  if (!formation) return { required: false, text: '', daysBeforeFormation: null };
  const daysBeforeFormation = (formation.getTime() - achat.getTime()) / DAY_IN_MS;
  const resolvedRefundDays = normalizeRefundDays(refundDays);
  if (!isWaiverRequired({ daysBeforeFormation, refundDays: resolvedRefundDays })) {
    return { required: false, text: '', daysBeforeFormation };
  }
  if (daysBeforeFormation < RETRACTATION_DAYS) {
    return {
      required: true,
      text: PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
      daysBeforeFormation
    };
  }
  return {
    required: true,
    text: PRESENTIEL_WAIVER_WITHIN_7_TEXT,
    daysBeforeFormation
  };
}

export function validateAndBuildConsumerWaiver(payload = {}, options = {}) {
  const dateAchat = normalizeDate(options.dateAchat) || new Date();
  const dateFormation = normalizeDate(options.dateFormation);
  const refundDays = normalizeRefundDays(options.refundDays);
  const hasDistancielItem = Boolean(options.hasDistancielItem);
  const enforcePresentielWaiver = Boolean(options.enforcePresentielWaiver);
  const requireAcceptedCgv = options.requireAcceptedCgv !== false;
  const acceptedCgv = readAcceptedCgv(payload);
  const normalizedAcceptedCgv = requireAcceptedCgv ? acceptedCgv : true;
  const acceptedText = readWaiverText(payload);

  if (requireAcceptedCgv && !normalizedAcceptedCgv) {
    throw buildValidationError(
      'Veuillez accepter les CGV avant de finaliser votre achat.',
      'CGV_ACCEPTANCE_REQUIRED'
    );
  }

  let renonciationText = '';
  if (hasDistancielItem) {
    const expectedDistancielText = normalizeLegalText(DISTANT_LEARNING_WAIVER_TEXT);
    if (acceptedText !== expectedDistancielText) {
      throw buildValidationError(
        'Veuillez accepter la renonciation avant de payer.',
        'CONSUMER_WAIVER_REQUIRED'
      );
    }
    renonciationText = DISTANT_LEARNING_WAIVER_TEXT;
  } else if (enforcePresentielWaiver && dateFormation) {
    const expectation = getPresentielWaiverExpectation({ dateAchat, dateFormation, refundDays });
    if (expectation.required) {
      const expectedPresentielText = normalizeLegalText(expectation.text);
      if (acceptedText !== expectedPresentielText) {
        throw buildValidationError(
          'Veuillez accepter la renonciation requise pour cette date de formation.',
          'CONSUMER_WAIVER_REQUIRED'
        );
      }
      renonciationText = expectation.text;
    } else if (acceptedText) {
      throw buildValidationError(
        'Aucune renonciation ne doit etre fournie pour cette date de formation.',
        'CONSUMER_WAIVER_UNEXPECTED'
      );
    }
  }

  return {
    accepted_cgv: Boolean(normalizedAcceptedCgv),
    renonciation_text: renonciationText || null,
    date_formation: dateFormation || null,
    date_achat: dateAchat,
    consumerWaiverAcceptedText: renonciationText || null,
    consumerWaiverAcceptedAt: renonciationText ? dateAchat : null
  };
}
