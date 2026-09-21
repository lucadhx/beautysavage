import type { BillingGroup, InvoiceView } from '@/types';

/**
 * Identité d'affichage d'une facture — module PUR (testable sous Node).
 *
 * Le TYPE vient du backend, qui le dérive de `billing_reason` (source Stripe) :
 * l'écran ne devine rien. Voir docs/RX_POLISH_CONTRACTS_BILLING_01.md.
 */

export type InvoiceIconName = 'Rocket' | 'RotateCw' | 'Wrench' | 'FileText';

export interface InvoiceIdentity {
  title: string;
  icon: InvoiceIconName;
  /** Classes de la pastille (fond + texte). */
  tone: string;
}

/**
 * Une facture rattachée à la main prime sur son type : c'est l'information
 * distinctive (« pourquoi cette facture est-elle là ? »), et son nom libre a été
 * saisi précisément pour ça.
 */
export function invoiceIdentity(inv: Pick<InvoiceView, 'type' | 'label' | 'addedManually'>): InvoiceIdentity {
  if (inv.addedManually) {
    return {
      title: inv.label?.trim() || 'Facture ajoutée manuellement',
      icon: 'Wrench',
      tone: 'bg-purple-100 text-purple-700',
    };
  }
  if (inv.type === 'LAUNCH_FEE') {
    return { title: 'Frais de lancement', icon: 'Rocket', tone: 'bg-amber-100 text-amber-700' };
  }
  if (inv.type === 'SUBSCRIPTION') {
    return { title: 'Abonnement mensuel', icon: 'RotateCw', tone: 'bg-blue-100 text-blue-700' };
  }
  return { title: inv.label?.trim() || 'Facture', icon: 'FileText', tone: 'bg-slate-100 text-slate-600' };
}

export interface UpcomingInvoice {
  date: string;
  amountExcludingTax: number;
}

/**
 * Prochaine facture d'abonnement — purement informative (Stripe ne l'a pas
 * encore générée, il n'y a donc ni PDF ni lien).
 *
 * `null` dès qu'une résiliation est programmée : annoncer une facture qui
 * n'arrivera jamais serait un mensonge. `null` aussi hors abonnement actif.
 */
export function upcomingInvoice(g: BillingGroup): UpcomingInvoice | null {
  const sub = g.subscription;
  if (!g.pricing?.subscription?.enabled) return null;
  if (!sub?.currentPeriodEnd) return null;
  if (sub.cancelAtPeriodEnd) return null;
  // Seul un abonnement qui court engendrera une facture suivante.
  if (!['ACTIVE', 'TRIALING'].includes(sub.status || '')) return null;
  return { date: sub.currentPeriodEnd, amountExcludingTax: g.pricing.subscription.amountExcludingTax };
}
