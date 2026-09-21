import * as React from 'react';
import { Link } from 'react-router-dom';
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
  creditNote?: { number?: string; issuedAt?: string; pdfUrl?: string };
  stripeAmountCents?: number;
  giftCardAmountCents?: number;
  stripe?: { checkoutSessionId?: string; paymentIntentId?: string; mode?: string };
  giftCardAllocations?: { codeMasked?: string; amountCents?: number }[];
  lines?: { productSnapshot?: { title?: string; kind?: ProductKind }; quantity?: number; totalCents?: number }[];
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
    <div className="mx-auto grid w-full max-w-full gap-6 p-4 md:p-6">
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

export function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {statusLabel(children)}
    </span>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-visible rounded-lg border bg-card">
      <div className="rounded-t-lg border-b bg-primary/5 px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
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
        slug: form.get('slug'),
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
        <input name="title" required placeholder="Titre" className="min-w-0 rounded-md border bg-background px-3 py-2 md:col-span-2" />
        <input name="slug" placeholder="slug automatique si vide" className="min-w-0 rounded-md border bg-background px-3 py-2 md:col-span-2" />
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
}: {
  products: CommerceProduct[];
  editBase?: string;
  onDelete?: (product: CommerceProduct) => void;
}) {
  if (products.length === 0) {
    return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucun element dans cette rubrique.</p>;
  }
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="min-w-[540px] w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Titre</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Prix</th>
            <th className="px-4 py-3">Statut</th>
            {(editBase || onDelete) && <th className="px-4 py-3">Action</th>}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const shortDescription = product.subtitle || product.description || 'Aucune description courte renseignee.';
            return (
              <tr key={product._id} className="border-t">
                <td className="min-w-[280px] px-4 py-3">
                  <div className="font-medium">{product.title}</div>
                  <div className="max-w-[44rem] truncate text-xs text-muted-foreground">{shortDescription}</div>
                </td>
                <td className="px-4 py-3">{KIND_LABEL[product.kind]}</td>
                <td className="px-4 py-3">{cents(product.price?.amountCents)}</td>
                <td className="px-4 py-3"><StatusBadge>{product.status}</StatusBadge></td>
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
