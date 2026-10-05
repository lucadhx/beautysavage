import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ProductStatusBadge } from './productStatus';
import { api } from '@/lib/api';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { CustomSelect } from '@/components/ui/CustomSelect';

export type ProductKind = 'DISTANCE_TRAINING' | 'IN_PERSON_TRAINING' | 'SERVICE' | 'GIFT_CARD' | 'PRODUCT';

export interface CommerceProduct {
  _id: string;
  title: string;
  slug: string;
  subtitle?: string;
  description?: string;
  kind: ProductKind;
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'ARCHIVED';
  price?: { amountCents?: number; currency?: string };
  coverUrl?: string;
  gallery?: string[];
  options?: Record<string, unknown>[];
  durationMinutes?: number;
  sessions?: unknown[];
  boostRank?: number | null;
  homeFeatured?: boolean;
  homeFeaturedRank?: number | null;
  trailer?: Record<string, unknown>;
  whatsappGroup?: Record<string, unknown>;
  faq?: Record<string, unknown>[];
  training?: Record<string, unknown>;
  modules?: Record<string, unknown>[];
  promotion?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  service?: Record<string, unknown>;
  paymentRules?: Record<string, unknown>;
  bookingRules?: Record<string, unknown>;
  seo?: { metaTitle?: string; metaDescription?: string };
}

export interface CommerceSale {
  _id: string;
  saleNumber: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  createdAt?: string;
  customerId?: { _id?: string; email?: string; firstName?: string; lastName?: string } | string | null;
  refund?: { amountCents?: number; reason?: string; refundedAt?: string };
  invoice?: { number?: string; issuedAt?: string; pdfUrl?: string };
  /** La facture Stripe de la cliente (page hébergée par Stripe) — seul lien « Facture » affiché. */
  invoiceUrl?: string;
  creditNote?: { number?: string; issuedAt?: string; pdfUrl?: string };
  stripeAmountCents?: number;
  giftCardAmountCents?: number;
  stripe?: { checkoutSessionId?: string; paymentIntentId?: string; mode?: string };
  giftCardAllocations?: { codeMasked?: string; amountCents?: number }[];
  lines?: { productSnapshot?: { title?: string; kind?: ProductKind }; quantity?: number; totalCents?: number }[];
  /** Commission de la vente (photographiée au paiement, ou règle en vigueur pour les anciennes ventes). */
  commission?: { subject: boolean; ratePercent: number; basis: 'HT' | 'TTC'; basisCents: number; amountCents: number } | null;
  finalizeIssues?: string[];
}

export interface CommerceCustomer {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  createdAt?: string;
  marketingConsent?: boolean;
  emailVerified?: boolean;
}

export interface CommerceCommission {
  _id: string;
  label: string;
  status: 'DUE' | 'PAYMENT_PENDING' | 'PAID' | 'CANCELLED';
  amountCents: number;
  currency?: string;
  dueAt?: string | null;
  paidAt?: string | null;
  paymentReference?: string;
  periodKey?: string;
  basisCents?: number;
  rateBps?: number;
  ratePercent?: number | null;
  basis?: 'HT' | 'TTC' | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Le mois est terminé : il se paie (le mois en cours, jamais). */
  payable?: boolean;
  /** La facture Stripe émise après paiement (page hébergée, sinon PDF). */
  invoiceUrl?: string;
  stripeInvoice?: { id?: string; number?: string; invoicePdfUrl?: string; hostedInvoiceUrl?: string } | null;
  checkout?: { openedAt?: string; expiresAt?: string; processing?: boolean } | null;
  sourceSnapshot?: { lines?: Array<{ saleId?: string; saleNumber?: string; basisCents?: number; amountCents?: number; ratePercent?: number; basis?: string }> } | null;
}

export interface CommerceReview {
  _id: string;
  rating: number;
  comment?: string;
  displayName?: string;
  status: 'PENDING' | 'PUBLISHED' | 'REJECTED';
  moderationComment?: string;
  createdAt?: string;
  customerId?: { _id?: string; email?: string; firstName?: string; lastName?: string } | string | null;
  productId?: { title?: string; kind?: ProductKind; slug?: string } | string | null;
  manual?: boolean;
}

export interface RefundRequest {
  _id: string;
  status: string;
  requestedAmountCents: number;
  eligibleAmountCents: number;
  refundedAmountCents?: number;
  reason?: string;
  managerComment?: string;
  createdAt?: string;
  customerId?: { _id?: string; email?: string; firstName?: string; lastName?: string } | string | null;
  saleId?: { saleNumber?: string; totalCents?: number; paymentStatus?: string } | string | null;
}

export interface GiftCard {
  _id: string;
  codeMasked: string;
  recipientName?: string;
  recipientEmail?: string;
  initialAmountCents: number;
  balanceCents: number;
  status: string;
  createdAt?: string;
  oneTimeCode?: string;
  senderName?: string;
  pdfUrl?: string;
}

export interface TrainingSubmission {
  _id: string;
  attempt: number;
  status: 'PENDING' | 'VALIDATED' | 'REJECTED';
  evaluationVersion?: number;
  createdAt?: string;
  answersSnapshot?: Record<string, unknown>;
  deliverablesSnapshot?: Record<string, unknown>;
  scoreSnapshot?: Record<string, unknown>;
  decision?: { comment?: string; certificateUrl?: string; decidedAt?: string };
  customerId?: { _id?: string; email?: string; firstName?: string; lastName?: string } | string | null;
  productId?: { title?: string; kind?: ProductKind; slug?: string } | string | null;
  saleId?: { saleNumber?: string } | string | null;
}

export const KIND_LABEL: Record<ProductKind, string> = {
  DISTANCE_TRAINING: 'Formation en ligne',
  IN_PERSON_TRAINING: 'Formation presentielle',
  SERVICE: 'Prestation institut',
  GIFT_CARD: 'Carte cadeau',
  PRODUCT: 'Produit boutique',
};

export const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function cents(amount?: number | null) {
  return euro.format((amount || 0) / 100);
}

export function dateShort(value?: string | null) {
  if (!value) return 'Non renseigne';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Paye',
  PENDING: 'En attente',
  PUBLISHED: 'Publie',
  REJECTED: 'Refuse',
  VALIDATED: 'Valide',
  REFUNDED: 'Rembourse',
  CANCELLED: 'Annule',
  CANCELED: 'Annule',
  DRAFT: 'Brouillon',
  DISABLED: 'Desactive',
  ARCHIVED: 'Archive',
  ACTIVE: 'Actif',
  DUE: 'A payer',
  PAYMENT_PENDING: 'Paiement en attente',
  PAYMENT_PENDING_EXTERNAL: 'Paiement en attente',
  PROCESSING: 'En traitement',
  FAILED: 'Echec',
  ACCEPTED: 'Accepte',
};

export function statusLabel(value?: React.ReactNode) {
  if (typeof value !== 'string') return value;
  return STATUS_LABELS[value] || value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function CommercePageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-full grid-cols-[minmax(0,1fr)] gap-6 py-2 sm:p-4 md:p-6">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Commerce BeautySavage</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex max-w-full flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Metric({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/**
 * LA COULEUR DIT L'ÉTAT AVANT QUE LE MOT NE SOIT LU.
 *
 * Tous les badges étaient gris : « En attente », « Validée » et « Refusée » se
 * ressemblaient dans la liste des validations, il fallait lire chaque ligne.
 * Trois familles suffisent — à traiter (ambre), réussi (vert), échec ou
 * annulation (rouge) — plus un neutre pour ce qui n'appelle aucune action.
 */
const STATUS_TONE: Record<string, string> = {
  PENDING: 'border-amber-300 bg-amber-100 text-amber-900',
  PAYMENT_PENDING: 'border-amber-300 bg-amber-100 text-amber-900',
  PAYMENT_PENDING_EXTERNAL: 'border-amber-300 bg-amber-100 text-amber-900',
  PROCESSING: 'border-amber-300 bg-amber-100 text-amber-900',
  DUE: 'border-amber-300 bg-amber-100 text-amber-900',
  FULL: 'border-amber-300 bg-amber-100 text-amber-900',
  VALIDATED: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  PAID: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  PUBLISHED: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  ACTIVE: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  ACCEPTED: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  REFUNDED: 'border-sky-300 bg-sky-100 text-sky-900',
  SCHEDULED: 'border-sky-300 bg-sky-100 text-sky-900',
  REJECTED: 'border-red-300 bg-red-100 text-red-900',
  FAILED: 'border-red-300 bg-red-100 text-red-900',
  CANCELLED: 'border-red-300 bg-red-100 text-red-900',
  CANCELED: 'border-red-300 bg-red-100 text-red-900',
  BLOCKED: 'border-red-300 bg-red-100 text-red-900',
};

export function StatusBadge({ children }: { children: React.ReactNode }) {
  const tone = typeof children === 'string' ? STATUS_TONE[children] : undefined;
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone || 'text-muted-foreground'}`}
      data-status={typeof children === 'string' ? children : undefined}
    >
      {statusLabel(children)}
    </span>
  );
}

/**
 * Une description riche (HTML de l'éditeur) réduite à son texte, pour les
 * aperçus d'une ligne : jamais de balises affichées en clair.
 */
export function plainText(html?: string) {
  const raw = String(html || '');
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;
  const doc = new DOMParser().parseFromString(raw.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, '</$1> '), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-visible rounded-lg border bg-card">
      <div className="rounded-t-lg border-b bg-primary/5 px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

export function ProductForm({
  title,
  allowedKinds,
  defaultKind,
  onSaved,
}: {
  title: string;
  allowedKinds: ProductKind[];
  defaultKind: ProductKind;
  onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [kind, setKind] = React.useState<ProductKind>(defaultKind);
  const [status, setStatus] = React.useState<'PUBLISHED' | 'DRAFT' | 'DISABLED'>('PUBLISHED');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage('');
    try {
      await api.saveCommerceProduct({
        title: form.get('title'),
        kind,
        status,
        amountCents: Math.round(Number(form.get('price') || 0) * 100),
        subtitle: form.get('subtitle'),
        description: form.get('description'),
        durationMinutes: Number(form.get('durationMinutes') || 0),
        distanceDeliveryMode: kind === 'DISTANCE_TRAINING' ? 'IMMEDIATE' : null,
        requiresLegalWaiver: kind === 'DISTANCE_TRAINING',
      });
      formElement.reset();
      setKind(defaultKind);
      setStatus('PUBLISHED');
      setMessage('Element ajoute au catalogue.');
      onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title={title}>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
        <input name="title" required placeholder="Titre" className="min-w-0 rounded-md border bg-background px-3 py-2 md:col-span-4" />
        <CustomSelect
          value={kind}
          onChange={(value) => setKind(value as ProductKind)}
          options={allowedKinds.map((item) => ({ value: item, label: KIND_LABEL[item] }))}
        />
        <CustomSelect
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          options={[
            { value: 'PUBLISHED', label: 'Publie' },
            { value: 'DRAFT', label: 'Brouillon' },
            { value: 'DISABLED', label: 'Desactive' },
          ]}
        />
        <input name="price" type="number" min="0" step="0.01" required placeholder="Prix TTC" className="min-w-0 rounded-md border bg-background px-3 py-2" />
        <input name="durationMinutes" type="number" min="0" step="5" placeholder="Duree min." className="min-w-0 rounded-md border bg-background px-3 py-2" />
        <input name="subtitle" placeholder="Sous-titre" className="min-w-0 rounded-md border bg-background px-3 py-2 md:col-span-4" />
        <textarea name="description" placeholder="Description client" className="min-h-24 min-w-0 rounded-md border bg-background px-3 py-2 md:col-span-6" />
        <div className="flex items-center gap-3 md:col-span-6">
          <button disabled={saving} className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-60">
            {saving ? 'Enregistrement...' : 'Ajouter'}
          </button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
      </form>
    </Panel>
  );
}

export function ProductTable({
  products,
  editBase,
  onDelete,
  emptyText = 'Aucun élément dans cette rubrique.',
  loading = false,
}: {
  products: CommerceProduct[];
  editBase?: string;
  onDelete?: (product: CommerceProduct) => void;
  emptyText?: string;
  /** Tant que la liste n'est pas arrivée : contenu fantôme, jamais l'état vide. */
  loading?: boolean;
}) {
  const navigate = useNavigate();
  if (loading) return <TableSkeleton rows={6} cols={5} />;
  /**
   * CLIC SUR LA LIGNE → ÉDITEUR. Le menu « … » reste disponible ; un clic sur un
   * élément interactif de la ligne (bouton, lien, menu) garde son propre effet.
   */
  const openRow = (event: React.MouseEvent | React.KeyboardEvent, product: CommerceProduct) => {
    if (!editBase) return;
    if ((event.target as HTMLElement).closest('button, a, input, [role="menu"], [role="menuitem"], [role="dialog"]')) return;
    navigate(`${editBase}/${product._id}`);
  };
  if (products.length === 0) {
    return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="m-table max-w-full overflow-x-auto rounded-lg border">
      <table className="min-w-[540px] w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Titre</th>
            <th className="m-hide px-4 py-3">Type</th>
            <th className="px-4 py-3">Prix</th>
            <th className="m-hide px-4 py-3">Statut</th>
            {(editBase || onDelete) && <th className="px-4 py-3">Action</th>}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const shortDescription = product.subtitle || plainText(product.description) || 'Aucune description courte renseignée.';
            return (
              <tr
                key={product._id}
                className={`border-t ${editBase ? 'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none' : ''}`}
                onClick={(event) => openRow(event, product)}
                onKeyDown={(event) => { if (event.key === 'Enter') openRow(event, product); }}
                tabIndex={editBase ? 0 : undefined}
                data-testid="product-row"
              >
                <td className="px-4 py-3 sm:min-w-[280px]">
                  <div className="font-medium">{product.title}</div>
                  <div className="line-clamp-1 max-w-[44rem] text-xs text-muted-foreground">{shortDescription}</div>
                  <div className="mt-1 sm:hidden"><ProductStatusBadge status={product.status} /></div>
                </td>
                <td className="m-hide px-4 py-3">{KIND_LABEL[product.kind]}</td>
                <td className="whitespace-nowrap px-4 py-3">{cents(product.price?.amountCents)}</td>
                <td className="m-hide px-4 py-3"><ProductStatusBadge status={product.status} /></td>
                {(editBase || onDelete) && (
                  <td className="px-4 py-3">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions ${product.title}`} />
                      <Dropdown.Popover className="w-48">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            {editBase && (
                              <Link to={`${editBase}/${product._id}`} className="block rounded px-3 py-2 text-sm transition hover:bg-muted">Editer</Link>
                            )}
                            {onDelete && (
                              <Dropdown.Item destructive onAction={() => onDelete(product)}>
                                Supprimer
                              </Dropdown.Item>
                            )}
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * L'ÉTAT D'UNE PROMOTION, tel que la vitrine l'applique : dates à l'heure de
 * Paris, une date de fin couvrant toute la journée.
 */
export function promotionState(promo: Record<string, unknown> | undefined, now = new Date()): { label: string; tone: string } {
  if (!promo?.enabled) return { label: 'Désactivée', tone: 'border-slate-200 bg-slate-50 text-slate-700' };
  if (!(Number(promo.value) > 0)) return { label: 'Indiquez une remise', tone: 'border-amber-300 bg-amber-50 text-amber-900' };
  const day = (v: unknown, end: boolean) => {
    const s = String(v || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    return new Date(`${s.slice(0, 10)}T${end ? '23:59:59' : '00:00:00'}`);
  };
  const start = day(promo.startsAt, false);
  const end = day(promo.endsAt, true);
  const fmt = (d: Date) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(d);
  if (start && now < start) return { label: `Programmée — commence le ${fmt(start)}`, tone: 'border-sky-300 bg-sky-50 text-sky-900' };
  if (end && now > end) return { label: 'Terminée', tone: 'border-slate-200 bg-slate-50 text-slate-700' };
  return { label: end ? `En cours sur la vitrine — jusqu'au ${fmt(end)} inclus (compte à rebours affiché)` : 'En cours sur la vitrine — sans date de fin', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' };
}

export function PromotionStateBadge({ promo }: { promo: Record<string, unknown> | undefined }) {
  const state = promotionState(promo);
  return <p className={`rounded-md border px-3 py-2 text-sm font-medium ${state.tone}`} data-testid="promotion-state">{state.label}</p>;
}
