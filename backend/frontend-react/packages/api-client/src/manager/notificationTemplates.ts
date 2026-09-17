// M7 — Client API templates de notification (dev-only). Endpoints /api/gestion/dev/notification-templates.
// Le template = CONTENU PUR : il ne porte JAMAIS de scope (admin/dev/both) ni targetRole. Le moteur
// choisit le scope. La preview est rendue côté front (aucun envoi, aucune vraie notification).
import { apiGet, apiPost } from '../apiFetch';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
export type NotificationTemplateStatus = 'draft' | 'published' | 'archived';

export const NOTIFICATION_PRIORITIES: NotificationPriority[] = ['low', 'normal', 'high', 'critical'];

// Actions MÉTIER (jamais une URL/route). Le panel décide de la navigation plus tard.
export const NOTIFICATION_ACTIONS: string[] = [
  'none',
  'booking_details',
  'refund_details',
  'client_details',
  'commission_details',
  'contract_details',
  'formation_details',
  'product_details',
  'service_details',
  'communication_identity',
  'theme_studio',
  'mail_template',
  'notification_template',
];

// Catalogue de variables connues (noms uniquement) — miroir du vocabulaire des notifications.
export const NOTIFICATION_KNOWN_VARIABLES: string[] = [
  'sitename', 'firstname', 'lastname', 'clientname', 'customername',
  'servicename', 'formationname', 'productname',
  'bookingdate', 'bookingtime', 'newbookingdate', 'sessiondate', 'sessiontime',
  'saleid', 'amount', 'refundamount', 'commissionamount', 'optionscount',
  'period', 'month', 'year', 'jobname',
];

export interface NotificationTemplate {
  id: string;
  templateKey: string;
  title: string;
  body: string;
  categoryId: string | null;
  variables: string[];
  priority: NotificationPriority;
  persistent: boolean;
  action: string;
  version: number;
  status: NotificationTemplateStatus;
  publishedAt: string | null;
  archivedAt: string | null;
  publishedBy: string;
  createdFromVersion: number | null;
  isSystemDefault: boolean;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface NotificationTemplateDraftInput {
  title?: string;
  body?: string;
  categoryId?: string | null;
  variables?: string[];
  priority?: NotificationPriority;
  persistent?: boolean;
  action?: string;
}

export type NotificationTemplateVersion = NotificationTemplate;

export interface NotificationTemplateVariable { name: string; known: boolean }
export interface NotificationTemplatePreview {
  title: string;
  body: string;
  usedVariables: NotificationTemplateVariable[];
  unknownVariables: string[];
}

const BASE = '/api/gestion/dev/notification-templates';
const VAR_RE = /{{\s*([a-zA-Z0-9]+)\s*}}/g;

export function extractNotificationVariables(...contents: string[]): string[] {
  const found = new Set<string>();
  for (const content of contents) {
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(String(content || ''))) !== null) found.add(m[1].toLowerCase());
  }
  return Array.from(found);
}

export async function listNotificationTemplates(): Promise<NotificationTemplate[]> {
  const res = await apiGet<{ ok: boolean; templates: NotificationTemplate[] }>(BASE);
  return res.templates ?? [];
}

export async function getNotificationTemplate(templateKey: string): Promise<NotificationTemplate | null> {
  const res = await apiGet<{ ok: boolean; template?: NotificationTemplate }>(`${BASE}/${encodeURIComponent(templateKey)}`);
  return res.template ?? null;
}

export async function listNotificationTemplateVersions(templateKey: string): Promise<NotificationTemplateVersion[]> {
  const res = await apiGet<{ ok: boolean; versions: NotificationTemplateVersion[] }>(`${BASE}/${encodeURIComponent(templateKey)}/versions`);
  return res.versions ?? [];
}

export async function createNotificationTemplate(templateKey: string, input: NotificationTemplateDraftInput): Promise<NotificationTemplate> {
  const res = await apiPost<{ ok: boolean; template: NotificationTemplate }>(`${BASE}/${encodeURIComponent(templateKey)}`, input);
  return res.template;
}

export async function createNotificationTemplateDraft(templateKey: string, input: NotificationTemplateDraftInput): Promise<NotificationTemplate> {
  const res = await apiPost<{ ok: boolean; draft: NotificationTemplate }>(`${BASE}/${encodeURIComponent(templateKey)}/draft`, input);
  return res.draft;
}

export async function publishNotificationTemplateDraft(draftId: string): Promise<NotificationTemplate> {
  const res = await apiPost<{ ok: boolean; published: NotificationTemplate }>(`${BASE}/drafts/${encodeURIComponent(draftId)}/publish`);
  return res.published;
}

export async function archiveNotificationTemplateDraft(draftId: string): Promise<NotificationTemplate> {
  const res = await apiPost<{ ok: boolean; archived: NotificationTemplate }>(`${BASE}/drafts/${encodeURIComponent(draftId)}/archive`);
  return res.archived;
}

export async function rollbackNotificationTemplate(templateKey: string, version: number): Promise<NotificationTemplate> {
  const res = await apiPost<{ ok: boolean; published: NotificationTemplate }>(`${BASE}/${encodeURIComponent(templateKey)}/rollback/${version}`);
  return res.published;
}

/** Preview FRONT (aucun envoi, aucune vraie notification). Interpole {{var}} avec des valeurs mock. */
export function previewNotificationTemplate(
  input: { title: string; body: string; variables?: Record<string, string> },
): NotificationTemplatePreview {
  const vars = input.variables ?? {};
  const used = extractNotificationVariables(input.title, input.body);
  const unknownVariables = used.filter((v) => !NOTIFICATION_KNOWN_VARIABLES.includes(v));
  const render = (s: string) =>
    String(s || '').replace(VAR_RE, (match, key: string) => {
      const k = key.toLowerCase();
      if (vars[k] !== undefined) return vars[k];
      return NOTIFICATION_KNOWN_VARIABLES.includes(k) ? `[${k}]` : match;
    });
  return {
    title: render(input.title),
    body: render(input.body),
    usedVariables: used.map((name) => ({ name, known: NOTIFICATION_KNOWN_VARIABLES.includes(name) })),
    unknownVariables,
  };
}
