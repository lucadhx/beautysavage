import { Badge } from '@/components/ui/primitives';
import type {
  ContractStatus,
  SignatureState,
  LaunchFeeStatus,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
} from '@/types';

const MAP: Record<ContractStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Brouillon', cls: 'bg-slate-100 text-slate-600' },
  PENDING_DEV_SIGNATURE: { label: 'Attente signature DEV', cls: 'bg-amber-100 text-amber-700' },
  INACTIVE: { label: 'Inactif', cls: 'bg-slate-100 text-slate-700' },
  ACTIVATION_IN_PROGRESS: { label: 'Activation en cours', cls: 'bg-blue-100 text-blue-700' },
  ACTIVE: { label: 'Actif', cls: 'bg-emerald-100 text-emerald-700' },
  CANCEL_AT_PERIOD_END: { label: 'Résilié (fin de période)', cls: 'bg-orange-100 text-orange-700' },
  ENDED: { label: 'Terminé', cls: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Annulé', cls: 'bg-slate-100 text-slate-500' },
  FAILED: { label: 'Échec', cls: 'bg-red-100 text-red-700' },
};

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const s = MAP[status] || MAP.DRAFT;
  return <Badge className={s.cls}>{s.label}</Badge>;
}

export function contractStatusLabel(status: ContractStatus): string {
  return (MAP[status] || MAP.DRAFT).label;
}

export const SIGNATURE_STATE_LABEL: Record<SignatureState, string> = {
  NONE: 'Pas de signature',
  REQUESTED: 'Signature demandée',
  DEV_SIGNED: 'Signé par l’équipe technique',
  FULLY_SIGNED: 'Signé par les deux parties',
  DECLINED: 'Signature refusée',
  EXPIRED: 'Signature expirée',
  CANCELED: 'Signature annulée',
};

const SIG_CLS: Record<SignatureState, string> = {
  NONE: 'bg-slate-100 text-slate-600',
  REQUESTED: 'bg-amber-100 text-amber-700',
  DEV_SIGNED: 'bg-blue-100 text-blue-700',
  FULLY_SIGNED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-red-100 text-red-700',
  CANCELED: 'bg-slate-100 text-slate-500',
};

export function SignatureStateBadge({ state }: { state: SignatureState }) {
  return <Badge className={SIG_CLS[state] || SIG_CLS.NONE}>{SIGNATURE_STATE_LABEL[state] || state}</Badge>;
}

export const LAUNCH_FEE_STATUS_LABEL: Record<LaunchFeeStatus, string> = {
  NOT_REQUIRED: 'Non requis',
  PENDING: 'À payer',
  CHECKOUT_CREATED: 'Paiement en attente',
  PROCESSING: 'Paiement en cours de confirmation',
  PAID: 'Payé',
  FAILED: 'Paiement échoué',
  CANCELLED: 'Paiement annulé',
  EXPIRED: 'Session expirée',
  REFUNDED: 'Remboursé',
};

const LF_CLS: Record<LaunchFeeStatus, string> = {
  NOT_REQUIRED: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  CHECKOUT_CREATED: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  EXPIRED: 'bg-orange-100 text-orange-700',
  REFUNDED: 'bg-purple-100 text-purple-700',
};

export function LaunchFeeStatusBadge({ status }: { status: LaunchFeeStatus }) {
  return <Badge className={LF_CLS[status] || LF_CLS.PENDING}>{LAUNCH_FEE_STATUS_LABEL[status] || status}</Badge>;
}

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  NONE: 'À souscrire',
  NOT_REQUIRED: 'Non requis',
  PENDING: 'À souscrire',
  CHECKOUT_CREATED: 'Souscription en attente',
  INCOMPLETE: 'Souscription incomplète',
  TRIALING: "Période d'essai",
  ACTIVE: 'Abonnement actif',
  PAST_DUE: 'Paiement en retard',
  UNPAID: 'Impayé',
  PAUSED: 'En pause',
  CANCEL_AT_PERIOD_END: 'Résiliation programmée',
  CANCELLED: 'Annulé',
  ENDED: 'Terminé',
  FAILED: 'Échec',
};

const SUB_CLS: Record<SubscriptionStatus, string> = {
  NONE: 'bg-amber-100 text-amber-700',
  NOT_REQUIRED: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  CHECKOUT_CREATED: 'bg-blue-100 text-blue-700',
  INCOMPLETE: 'bg-amber-100 text-amber-700',
  TRIALING: 'bg-emerald-100 text-emerald-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PAST_DUE: 'bg-orange-100 text-orange-700',
  UNPAID: 'bg-red-100 text-red-700',
  PAUSED: 'bg-slate-100 text-slate-600',
  CANCEL_AT_PERIOD_END: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  ENDED: 'bg-red-100 text-red-700',
  FAILED: 'bg-red-100 text-red-700',
};

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  return <Badge className={SUB_CLS[status] || SUB_CLS.PENDING}>{SUBSCRIPTION_STATUS_LABEL[status] || status}</Badge>;
}

/* -------------------------------- Facturation ------------------------------ */

/**
 * Statuts de FACTURE Stripe. Ces libellés étaient les seuls de l'application à
 * rester en anglais brut (`PAID`, `VOID`…) : le miroir interne conserve les
 * valeurs Stripe, l'écran doit parler français.
 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  OPEN: 'Ouverte',
  PAID: 'Payée',
  UNCOLLECTIBLE: 'Impayée',
  VOID: 'Annulée',
};

const INV_CLS: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  OPEN: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  UNCOLLECTIBLE: 'bg-red-100 text-red-700',
  VOID: 'bg-slate-100 text-slate-500',
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const s = status as InvoiceStatus;
  return <Badge className={INV_CLS[s] || INV_CLS.OPEN}>{INVOICE_STATUS_LABEL[s] || status}</Badge>;
}

/**
 * Statuts de PAIEMENT (journal interne). Distincts des statuts de facture : un
 * paiement peut échouer ou expirer sans qu'aucune facture n'existe.
 */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'En attente',
  PROCESSING: 'En cours de confirmation',
  PAID: 'Payé',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
  REFUNDED: 'Remboursé',
};

const PAY_CLS: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  EXPIRED: 'bg-orange-100 text-orange-700',
  REFUNDED: 'bg-purple-100 text-purple-700',
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const s = status as PaymentStatus;
  return <Badge className={PAY_CLS[s] || PAY_CLS.PENDING}>{PAYMENT_STATUS_LABEL[s] || status}</Badge>;
}
