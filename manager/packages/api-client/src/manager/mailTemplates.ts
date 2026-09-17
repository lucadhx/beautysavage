// M6 — Client API Mail Template Studio (dev-only). Endpoints /api/gestion/mails.
// Les templates ne contiennent JAMAIS d'adresse e-mail : seuls des rôles (from/to) sont exposés.
// La preview est rendue côté front (aucun endpoint backend, aucun envoi réel).
import { apiGet, apiPost } from '../apiFetch';

export type MailTemplateStatus = 'draft' | 'published' | 'archived';
export type MailRole = 'support' | 'commerciale' | 'client';
export type MailRuleMode = 'active' | 'shadow';

export interface MailTemplateSummary {
  functionName: string;
  recipient: string;
  isMetadataOnly: boolean;
  updatedAt: string | null;
  categoryId: string | null;
}

export interface MailTemplateDetail {
  functionName: string;
  subject: string;
  bodyHtml: string;
  fullHtml: string;
  mode: string;
  updatedAt: string | null;
}

export interface MailTemplateVersion {
  functionName: string;
  version: number;
  status: MailTemplateStatus | null;
  publishedAt: string | null;
  archivedAt: string | null;
  publishedBy: string;
  createdFromVersion: number | null;
  isSystemDefault: boolean;
  subject: string;
  mode: string;
  updatedAt: string | null;
  createdAt: string | null;
  _id?: string;
}

export interface MailTemplateDraftInput {
  subject?: string;
  bodyHtml?: string;
  fullHtml?: string;
  mode?: string;
}

export interface MailTemplateVariable {
  name: string;
  known: boolean;
}

export interface MailTemplatePreview {
  subject: string;
  html: string;
  text: string;
  usedVariables: MailTemplateVariable[];
  unknownVariables: string[];
}

export interface MailTemplateRoleBinding {
  templateKey: string;
  fromRole: MailRole | null;
  toRole: MailRole | null;
  eventName: string | null;
  mode: MailRuleMode | null;
  directSenderExists: boolean | null;
  wired: boolean; // true si câblé au moteur événementiel (règle connue)
}

const BASE = '/api/gestion/mails';

// ─── Liaison rôle (miroir SAFE de constants/mailDispatchRules.js — rôles uniquement) ──
const ROLE_BINDINGS: Record<string, Omit<MailTemplateRoleBinding, 'templateKey' | 'wired'>> = {
  vente: { fromRole: 'commerciale', toRole: 'client', eventName: 'sale.finalized', mode: 'shadow', directSenderExists: true },
  booking_confirmed: { fromRole: 'commerciale', toRole: 'client', eventName: 'booking.confirmed', mode: 'active', directSenderExists: false },
  refund_confirmed: { fromRole: 'commerciale', toRole: 'client', eventName: 'refund.succeeded', mode: 'active', directSenderExists: false },
  commission_available: { fromRole: 'support', toRole: 'commerciale', eventName: 'commission.available', mode: 'shadow', directSenderExists: true },
  commission_reminder: { fromRole: 'support', toRole: 'commerciale', eventName: 'commission.reminder_sent', mode: 'shadow', directSenderExists: true },
};

export function getTemplateRoleBinding(templateKey: string): MailTemplateRoleBinding {
  const b = ROLE_BINDINGS[templateKey];
  if (!b) {
    return { templateKey, fromRole: null, toRole: null, eventName: null, mode: null, directSenderExists: null, wired: false };
  }
  return { templateKey, wired: true, ...b };
}

// ─── Catalogue de variables connues (miroir du vocabulaire supporté par le renderer) ──
// Noms de variables uniquement (jamais de valeur ni d'adresse). Sert au panneau + au warning.
export const KNOWN_TEMPLATE_VARIABLES: string[] = [
  'sitename', 'institutename', 'firstname', 'lastname', 'customername',
  'servicename', 'formationname', 'formationtitle', 'productname',
  'bookingdate', 'bookingtime', 'bookingdatetime', 'sessiondatelabel', 'sessiontimelabel',
  'practitionername', 'cancellationdays', 'timelabel', 'bookingid',
  'paymenttype', 'depositamount', 'remainingamount',
  'saleid', 'amount', 'amountpaid', 'invoicepageurl', 'invoicedownloadurl',
  'refundamount', 'refundstatus', 'refunddatetime', 'refundid', 'refundedatformatted',
  'trackingurl', 'itemdetail', 'reason', 'year',
  'giftcardcode', 'giftcardbalance',
  'period', 'daystotal', 'daysleft', 'platformurl', 'actionurl',
];

const VAR_RE = /{{\s*([a-zA-Z0-9]+)\s*}}/g;

export function extractTemplateVariables(...contents: string[]): string[] {
  const found = new Set<string>();
  for (const content of contents) {
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(String(content || ''))) !== null) found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export async function listMailTemplates(): Promise<MailTemplateSummary[]> {
  const res = await apiGet<{ ok: boolean; groups: { templates: MailTemplateSummary[] }[] }>(`${BASE}/templates`);
  const out: MailTemplateSummary[] = [];
  for (const g of res.groups ?? []) for (const t of g.templates ?? []) out.push(t);
  return out;
}

export async function getMailTemplate(functionName: string): Promise<MailTemplateDetail | null> {
  const res = await apiGet<{ ok: boolean; template?: MailTemplateDetail }>(`${BASE}/template`, { functionName });
  return res.template ?? null;
}

export async function listMailTemplateVersions(functionName: string): Promise<MailTemplateVersion[]> {
  const res = await apiGet<{ ok: boolean; versions: MailTemplateVersion[] }>(`${BASE}/templates/${encodeURIComponent(functionName)}/versions`);
  return res.versions ?? [];
}

export async function createMailTemplateDraft(
  functionName: string,
  input: MailTemplateDraftInput,
): Promise<{ _id: string; functionName: string; version: number; status: string }> {
  const res = await apiPost<{ ok: boolean; draft: { _id: string; functionName: string; version: number; status: string } }>(
    `${BASE}/templates/${encodeURIComponent(functionName)}/draft`,
    input,
  );
  return res.draft;
}

export async function publishMailTemplateDraft(draftId: string): Promise<{ _id: string; functionName: string; version: number; status: string }> {
  const res = await apiPost<{ ok: boolean; published: { _id: string; functionName: string; version: number; status: string } }>(
    `${BASE}/drafts/${encodeURIComponent(draftId)}/publish`,
  );
  return res.published;
}

export async function archiveMailTemplateDraft(draftId: string): Promise<{ _id: string; version: number; status: string }> {
  const res = await apiPost<{ ok: boolean; archived: { _id: string; version: number; status: string } }>(
    `${BASE}/drafts/${encodeURIComponent(draftId)}/archive`,
  );
  return res.archived;
}

export async function rollbackMailTemplate(functionName: string, version: number): Promise<{ functionName: string; version: number; status: string }> {
  const res = await apiPost<{ ok: boolean; published: { functionName: string; version: number; status: string } }>(
    `${BASE}/templates/${encodeURIComponent(functionName)}/rollback/${version}`,
  );
  return res.published;
}

/**
 * Preview FRONT (aucun envoi, aucun appel backend dédié). Charge le template publié si le contenu
 * n'est pas fourni, puis interpole `{{var}}` avec des valeurs mock safe. Renvoie subject/html/text
 * + les variables utilisées (connues/inconnues).
 */
// P1-3 — catalogue canonique des variables (source d'autorité BACKEND, remplace à terme le miroir
// hardcodé KNOWN_TEMPLATE_VARIABLES). Chaque entrée décrit la variable + un exemple + sa source.
export interface MailVariableCatalogEntry {
  key: string;
  description: string;
  example: string;
  source: string;
  raw: boolean;
  known: boolean;
}

export async function getMailVariableCatalog(): Promise<MailVariableCatalogEntry[]> {
  const res = await apiGet<{ ok: boolean; variables: MailVariableCatalogEntry[] }>(`${BASE}/variables`);
  return res.variables ?? [];
}

// LOT2 §3 — Matrice des déclencheurs (lecture seule). Reflète le registre code-first mailDispatchRules.
export interface CommunicationTriggerRow {
  event: string;
  category: string;
  templateKey: string;
  templatePublished: boolean;
  fromRole: MailRole;
  toRole: MailRole;
  active: boolean;
  directSender: boolean;
  engine: boolean;
  lastSentAt: string | null;
  lastStatus: string | null;
}

export async function getCommunicationTriggers(): Promise<{ engineEnabled: boolean; rows: CommunicationTriggerRow[] }> {
  const res = await apiGet<{ ok: boolean; engineEnabled: boolean; rows: CommunicationTriggerRow[] }>(`${BASE}/triggers`);
  return { engineEnabled: Boolean(res.engineEnabled), rows: res.rows ?? [] };
}

// P1-2 — envoi d'un e-mail de TEST. Le backend rend le template avec des données d'exemple,
// préfixe l'objet par [TEST], journalise comme test, et ne déclenche AUCUN événement métier ni
// token réel. `toEmail` doit être une adresse autorisée choisie par l'utilisateur.
export async function testSendMailTemplate(
  functionName: string,
  toEmail: string,
): Promise<{ ok: boolean; sentTo: string }> {
  return apiPost<{ ok: boolean; sentTo: string }>(
    `${BASE}/templates/${encodeURIComponent(functionName)}/test-send`,
    { toEmail },
  );
}

// LOT2 §2 — Aperçu = PRODUCTION. Le rendu est délégué au BACKEND (même moteur que l'envoi réel :
// `replaceTemplateVariables` + `withMailThemeVars` + données d'exemple du catalogue). Le HTML affiché
// est donc identique à celui envoyé à Brevo. `variables` permet un override optionnel.
export async function previewMailTemplate(
  functionName: string,
  input: { subject?: string; html?: string; text?: string; variables?: Record<string, string> } = {},
): Promise<MailTemplatePreview> {
  const res = await apiPost<{
    ok: boolean;
    subject: string;
    html: string;
    text: string;
    usedVariables: { name: string; known: boolean }[];
    unknownVariables: string[];
  }>(`${BASE}/templates/${encodeURIComponent(functionName)}/preview`, {
    subject: input.subject,
    html: input.html,
    text: input.text,
    variables: input.variables,
  });
  return {
    subject: res.subject ?? '',
    html: res.html ?? '',
    text: res.text ?? '',
    usedVariables: res.usedVariables ?? [],
    unknownVariables: res.unknownVariables ?? [],
  };
}
