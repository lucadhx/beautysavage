// M3E — Client API supervision mail (Manager). Lecture seule, aucun écran ici.
// Cible les endpoints ADMIN (/api/gestion/...) : le backend impose roleView=admin
// (institut/client uniquement). Aucun e-mail/secret n'est exposé par le backend.
import { apiGet } from '../apiFetch';

export interface MailSupervisionFilters {
  status?: string;
  eventName?: string;
  templateKey?: string;
  fromRole?: string;
  toRole?: string;
  contextType?: string;
  contextId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface MailDeliverySummary {
  id: string;
  eventName: string | null;
  templateKey: string | null;
  mode: string | null;
  status: string | null;
  fromRole: string | null;
  toRole: string | null;
  contextType: string | null;
  contextId: string | null;
  targetAudience: 'admin' | 'dev';
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessageSafe: string;
  createdAt: string | null;
  updatedAt: string | null;
  sendLogId: string | null;
  provider: string | null;
  providerMessageId: string | null;
  recipientHash: string | null;
  senderRole: string | null;
  recipientRole: string | null;
}

export interface SendLogSummary {
  id: string;
  channel: string;
  provider: string | null;
  templateKey: string | null;
  status: string | null;
  providerMessageId: string;
  recipientHash: string;
  subject: string;
  contextType: string | null;
  contextId: string | null;
  senderRole: string | null;
  recipientRole: string | null;
  tags: string[];
  queuedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  bouncedAt: string | null;
  errorCode: string;
  lastErrorMessageSafe: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MailDeliveryStats {
  roleView: 'admin' | 'dev';
  total: number;
  byStatus: Record<string, number>;
  byTemplate: Record<string, number>;
  byEvent: Record<string, number>;
  last24h: number;
  failuresLast24h: number;
  shadowCount: number;
  activeCount: number;
}

export interface SendLogStats {
  roleView: 'admin' | 'dev';
  total: number;
  byStatus: Record<string, number>;
  byTemplate: Record<string, number>;
  last24h: number;
  failuresLast24h: number;
}

interface ListResponse<T> {
  ok: boolean;
  roleView: string;
  count: number;
  limit: number;
  items: T[];
}

function toParams(f: MailSupervisionFilters = {}): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p[k] = v as string | number;
  }
  return p;
}

/** Vue : 'admin' → endpoints institut/client ; 'dev' → endpoints complets safe. */
export type MailSupervisionScope = 'admin' | 'dev';
const ADMIN_BASE = '/api/gestion';
const DEV_BASE = '/api/gestion/dev';
function baseFor(scope: MailSupervisionScope = 'admin'): string {
  return scope === 'dev' ? DEV_BASE : ADMIN_BASE;
}

// Le endpoint dev /send-logs (legacy diagnostic) renvoie { logs } (docs bruts safe), alors que
// l'endpoint admin renvoie le DTO { items }. On normalise vers SendLogSummary côté client.
interface RawSendLogDoc {
  _id: string;
  channel?: string;
  provider?: string;
  templateKey?: string;
  status?: string;
  providerMessageId?: string;
  recipientHash?: string;
  subject?: string;
  contextType?: string | null;
  contextId?: string | null;
  metadata?: { tags?: string[] };
  queuedAt?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  openedAt?: string | null;
  bouncedAt?: string | null;
  errorCode?: string;
  errorMessageSafe?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}
function rolesFromTags(tags?: string[]): { senderRole: string | null; recipientRole: string | null } {
  let senderRole: string | null = null;
  let recipientRole: string | null = null;
  for (const t of tags ?? []) {
    if (t.startsWith('from:')) senderRole = t.slice(5) || null;
    else if (t.startsWith('to:')) recipientRole = t.slice(3) || null;
  }
  return { senderRole, recipientRole };
}
function mapRawSendLog(doc: RawSendLogDoc): SendLogSummary {
  const { senderRole, recipientRole } = rolesFromTags(doc.metadata?.tags);
  return {
    id: String(doc._id),
    channel: doc.channel || 'email',
    provider: doc.provider || null,
    templateKey: doc.templateKey || null,
    status: doc.status || null,
    providerMessageId: doc.providerMessageId || '',
    recipientHash: doc.recipientHash || '',
    subject: doc.subject || '',
    contextType: doc.contextType ?? null,
    contextId: doc.contextId ?? null,
    senderRole,
    recipientRole,
    tags: doc.metadata?.tags ?? [],
    queuedAt: doc.queuedAt ?? null,
    sentAt: doc.sentAt ?? null,
    deliveredAt: doc.deliveredAt ?? null,
    openedAt: doc.openedAt ?? null,
    bouncedAt: doc.bouncedAt ?? null,
    errorCode: doc.errorCode || '',
    lastErrorMessageSafe: doc.errorMessageSafe || '',
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

export async function listMailDeliveries(
  filters: MailSupervisionFilters = {},
  scope: MailSupervisionScope = 'admin',
): Promise<MailDeliverySummary[]> {
  const res = await apiGet<ListResponse<MailDeliverySummary>>(`${baseFor(scope)}/mail-deliveries`, toParams(filters));
  return res.items ?? [];
}

export async function getMailDeliveryDetail(
  id: string,
  scope: MailSupervisionScope = 'admin',
): Promise<MailDeliverySummary | null> {
  const res = await apiGet<{ ok: boolean; delivery: MailDeliverySummary }>(
    `${baseFor(scope)}/mail-deliveries/${encodeURIComponent(id)}`,
  );
  return res.delivery ?? null;
}

export async function getMailDeliveryStats(
  range: { dateFrom?: string; dateTo?: string } = {},
  scope: MailSupervisionScope = 'admin',
): Promise<MailDeliveryStats> {
  const res = await apiGet<{ ok: boolean; stats: MailDeliveryStats }>(`${baseFor(scope)}/mail-deliveries/stats`, toParams(range));
  return res.stats;
}

export async function listSendLogs(
  filters: MailSupervisionFilters = {},
  scope: MailSupervisionScope = 'admin',
): Promise<SendLogSummary[]> {
  if (scope === 'dev') {
    // Endpoint dev legacy : { logs } docs bruts → normalisés.
    const res = await apiGet<{ ok: boolean; count: number; logs: RawSendLogDoc[] }>(`${DEV_BASE}/send-logs`, toParams(filters));
    return (res.logs ?? []).map(mapRawSendLog);
  }
  const res = await apiGet<ListResponse<SendLogSummary>>(`${ADMIN_BASE}/send-logs`, toParams(filters));
  return res.items ?? [];
}

export async function getSendLogStats(
  range: { dateFrom?: string; dateTo?: string } = {},
  scope: MailSupervisionScope = 'admin',
): Promise<SendLogStats> {
  const res = await apiGet<{ ok: boolean; stats: SendLogStats }>(`${baseFor(scope)}/send-logs/stats`, toParams(range));
  return res.stats;
}
