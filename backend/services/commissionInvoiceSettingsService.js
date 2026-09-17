import CommissionInvoiceSettings from '../models/CommissionInvoiceSettings.js';
import {
  resolvePlatformName,
  resolveInstituteName,
  resolveInstituteEmail
} from './system/systemConfigurationService.js';

const SINGLETON_IDENTIFIER = 'default';

// S1 — fallback résolu au moment de l'appel (config DB → env). PLATFORM_ADDRESS /
// INSTITUTE_ADDRESS restent des variables legacy lues en dernier recours.
function getFallbackSettings() {
  return {
    issuerName: resolvePlatformName() || 'Beauty Savage',
    issuerCompany: resolvePlatformName() || 'Beauty Savage',
    issuerAddress: process.env.PLATFORM_ADDRESS || '1 rue de la Beaute, 75001 Paris',
    issuerEmail: resolveInstituteEmail() || 'contact@beautysavage.fr',
    recipientName: resolveInstituteName() || 'Institut Beauty Savage',
    recipientAddress: process.env.INSTITUTE_ADDRESS || 'Paris, France',
    emailRecipients: []
  };
}

const EMAIL_WHITESPACE_PATTERN = /[\s\u00A0\u200B\u200C\u200D\uFEFF\u2028\u2029]+/g;
const DOMAIN_LABEL_PATTERN = /^[a-zA-Z0-9-]+$/;
const LOCAL_PART_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmailValue(value = '') {
  let candidate = String(value || '');
  candidate = candidate.trim();
  candidate = candidate.replace(EMAIL_WHITESPACE_PATTERN, '');
  if (candidate.normalize) {
    candidate = candidate.normalize('NFKC');
  }
  return candidate;
}

function isDomainStructureValid(domain) {
  if (!domain) {
    return false;
  }
  const labels = domain.split('.');
  if (labels.length < 2) {
    return false;
  }
  return labels.every(label => {
    if (!label) {
      return false;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return false;
    }
    return DOMAIN_LABEL_PATTERN.test(label);
  });
}

function isEmailStructureValid(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }
  const [localPart, domainPart] = parts;
  if (!localPart || !domainPart) {
    return false;
  }
  if (
    !LOCAL_PART_PATTERN.test(localPart) ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return false;
  }
  return isDomainStructureValid(domainPart);
}

function collectEmailRecipients(values) {
  if (!Array.isArray(values)) {
    return { valid: [], invalid: [] };
  }
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const raw of values) {
    const normalized = normalizeEmailValue(raw);
    if (!normalized) {
      continue;
    }
    if (!isEmailStructureValid(normalized)) {
      invalid.push(normalized);
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    valid.push(normalized);
  }
  return { valid, invalid };
}

function sanitizeEmailRecipients(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return collectEmailRecipients(values).valid;
}

function mergeWithDefaults(document) {
  const base = getFallbackSettings();
  if (!document) {
    return base;
  }
  return {
    identifier: document.identifier || SINGLETON_IDENTIFIER,
    issuerName: document.issuerName || base.issuerName,
    issuerCompany: document.issuerCompany || base.issuerCompany,
    issuerAddress: document.issuerAddress || base.issuerAddress,
    issuerEmail: document.issuerEmail || base.issuerEmail,
    recipientName: document.recipientName || base.recipientName,
    recipientAddress: document.recipientAddress || base.recipientAddress,
    emailRecipients: Array.isArray(document.emailRecipients) && document.emailRecipients.length
      ? sanitizeEmailRecipients(document.emailRecipients)
      : base.emailRecipients,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function buildSettingsPayload(source) {
  if (!source) {
    return {};
  }
  return {
    issuerName: normalizeText(source.issuerName),
    issuerCompany: normalizeText(source.issuerCompany),
    issuerAddress: normalizeText(source.issuerAddress),
    issuerEmail: normalizeEmailValue(source.issuerEmail),
    recipientName: normalizeText(source.recipientName),
    recipientAddress: normalizeText(source.recipientAddress),
    emailRecipients: sanitizeEmailRecipients(source.emailRecipients)
  };
}

export async function getCommissionInvoiceSettings() {
  const document = await CommissionInvoiceSettings.findOne({ identifier: SINGLETON_IDENTIFIER }).lean();
  return mergeWithDefaults(document);
}

export async function upsertCommissionInvoiceSettings(payload) {
  const sanitized = buildSettingsPayload(payload);
  const document = await CommissionInvoiceSettings.findOneAndUpdate(
    { identifier: SINGLETON_IDENTIFIER },
    {
      $set: sanitized
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  ).lean();
  return mergeWithDefaults(document);
}

export { sanitizeEmailRecipients, normalizeEmailValue, isEmailStructureValid, collectEmailRecipients };
