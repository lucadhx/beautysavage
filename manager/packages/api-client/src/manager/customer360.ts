// M12 — Client API Customer 360 (Client Hub, manager). Admin/dev. Le backend agrège et reste
// l'autorité ; aucun calcul métier côté client.
import { apiGet } from '../apiFetch';

export interface CustomerIdentity {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string | null;
  photo: string | null;
  createdAt: string | null;
  lastLogin: string | null;
  isActive: boolean;
  bookingSuspended: boolean;
}

export interface Customer360Kpis {
  salesCount: number;
  totalSpent: number;
  totalHT: number;
  servicesCount: number;
  formationsCount: number;
  productsCount: number;
  giftCardsCount: number;
  refundsCount: number;
  upcomingBookingsCount: number;
}

export interface Customer360Summary {
  customerId: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  photo: string | null;
  createdAt: string | null;
  status: 'active' | 'suspended' | 'inactive' | string;
  kpis: Customer360Kpis;
  nextBooking: { bookingId: string; serviceName: string; startAt: string } | null;
  lastActivity: string | null;
}

export interface TimelineItem {
  id: string;
  date: string | null;
  type: string;
  icon: string;
  title: string;
  subtitle: string;
  action: string | null;
  refId: string | null;
}

export interface CustomerFinancial {
  totalSpent: number;
  depositsPaid: number;
  balanceDue: number;
  pendingBalances: { bookingId: string; serviceName: string; balanceDueAmount: number; startAt: string | null }[];
  giftCardsBalance: number;
  giftCardsCount: number;
  refundsTotal: number;
  refundsCount: number;
  lastInvoice: CustomerInvoiceDoc | null;
  unpaidInvoicesCount: number;
  unpaidInvoices: CustomerInvoiceDoc[];
}

export interface CustomerSale { id: string; saleId: string; createdAt: string | null; totalAmount: number; itemCount: number; refundStatus: string | null; refundAmount: number; items: { type: string; itemId: string | null; name: string; finalPrice: number; promotionApplied: boolean }[]; giftCardUsage: { code: string; amountUsed: number }[]; }
export interface CustomerBooking { id: string; bookingId: string; serviceName: string; startAt: string | null; endAt: string | null; status: string; paymentType: string; paymentStatus: string; totalPrice: number; depositAmount: number; balanceDueAmount: number; balanceSettlementMode: string | null; isDeposit: boolean; saleId: string | null; cancelledAt: string | null; cancelledBy: string | null; }
export interface CustomerFormation { id: string; formationId: string | null; name: string; type: string | null; sessionId: string | null; participationStatus: string; acquiredAt: string | null;
  // C2 — Learning (optionnels : payloads antérieurs restent valides).
  startedAt?: string | null; completedAt?: string | null; completedLessons?: number; lastLessonId?: string | null;
  attendanceStatus?: 'present' | 'absent' | 'pending' | null; attendanceAt?: string | null; }
export interface CustomerProduct { id: string; productId: string | null; name: string; acquiredAt: string | null; }
export interface CustomerGiftCard { id: string; code: string; amount: number; balance: number; status: string; purchasedAt: string | null; }
export interface CustomerRefund { id: string; refundId: string; saleId: string; itemType: string; amount: number; status: string; eligibleRefund: boolean; requestedAt: string | null; refundedAt: string | null; hasCreditNote: boolean; }
export interface CustomerInvoiceDoc { id: string; invoiceId: string; saleId: string; status: string; official: boolean; documentKind: string; totalAmount: number; invoiceDate: string | null; pdfUrl: string | null; }
export interface CustomerDocument { id: string; kind: string; label: string; date: string | null; url: string | null; amount: number | null; }
export interface CustomerCommunication { id: string; channel: string; templateKey: string; subject: string; status: string; sentAt: string | null; contextType: string | null; }
export interface CustomerNotification { id: string; title: string; category: string; icon: string | null; priority: string; eventName: string | null; createdAt: string | null; }

export interface Customer360 {
  customer: CustomerIdentity;
  summary: Customer360Summary;
  timeline: TimelineItem[];
  sales: CustomerSale[];
  bookings: CustomerBooking[];
  formations: CustomerFormation[];
  products: CustomerProduct[];
  giftCards: CustomerGiftCard[];
  refunds: CustomerRefund[];
  documents: CustomerDocument[];
  communications: CustomerCommunication[];
  notifications: CustomerNotification[];
  financial: CustomerFinancial;
}

export interface CustomerSearchCard {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string | null;
  bookingSuspended: boolean;
  salesCount: number;
  totalSpent: number;
  lastVisitAt: string | null;
  nextBookingAt: string | null;
}

/** GET /api/gestion/customers?search= — recherche rapide (cartes résumé). */
export async function searchCustomers(search?: string, signal?: AbortSignal): Promise<CustomerSearchCard[]> {
  const res = await apiGet<{ ok: boolean; customers: CustomerSearchCard[] }>(
    '/api/gestion/customers',
    search ? { search } : undefined,
  );
  void signal;
  return res.customers ?? [];
}

/** GET /api/gestion/customers/:id/360 — fiche complète. */
export async function getCustomer360(customerId: string): Promise<Customer360> {
  const res = await apiGet<{ ok: boolean } & Customer360>(`/api/gestion/customers/${encodeURIComponent(customerId)}/360`);
  return res;
}
