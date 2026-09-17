// RX4 — Types de l'espace client (Client Hub). Le serveur fait foi : aucun montant recalculé côté client.
// Formes alignées sur les contrôleurs backend (serializeBooking / listMySales / buildGiftCardPayload).
import type { DateIso, MoneyAmount } from '../types';

/** Réservation de prestation (GET /api/client/bookings → serializeBooking). */
export interface ClientBooking {
  id: string;
  bookingId: string;
  serviceId: string;
  serviceName: string;
  /** Legacy (institut mono-entité M10/M11) — ignoré à l'affichage. */
  practitionerName: string;
  practitionerPhoto: string | null;
  startAt: DateIso | null;
  endAt: DateIso | null;
  totalPrice: MoneyAmount;
  depositAmount: MoneyAmount;
  paymentType: string;
  paymentStatus: string;
  status: string;
  cancelledAt: DateIso | null;
  cancelledBy: string | null;
  selectedOptions: { name?: string; price?: number }[];
  saleId: string | null;
  createdAt: DateIso | null;
}

/** Carte cadeau détenue (GET /api/client/gift-cards/my → buildGiftCardPayload). */
export interface ClientGiftCard {
  id: string;
  code: string;
  amount: MoneyAmount;
  balance: MoneyAmount;
  availableBalance: MoneyAmount;
  reservedAmount: MoneyAmount;
  status: string;
  purchasedAt: DateIso | null;
  createdAt: DateIso | null;
  saleId: string | null;
  hasPassword: boolean;
  /** Renvoyé en clair par le backend — NE JAMAIS afficher sans révélation explicite. */
  password: string | null;
}

/** Transaction d'une carte cadeau (GET /api/client/gift-cards/:id → buildGiftCardTransactionPayload). */
export interface ClientGiftCardTransaction {
  id: string;
  amount: MoneyAmount;
  balanceBefore: MoneyAmount;
  balanceAfter: MoneyAmount;
  saleId: string;
  createdAt: DateIso | null;
  transactionType: string;
  note: string;
  usedByYou: boolean;
  usedByLabel: string;
}

export interface ClientGiftCardDetail {
  card: ClientGiftCard;
  transactions: ClientGiftCardTransaction[];
}

/** Facture attachée à une vente. */
export interface ClientSaleInvoice {
  id: string;
  number: string;
  date: DateIso | null;
  stripeInvoicePdfUrl: string | null;
  /** Lien de téléchargement authentifié (cookie same-origin). */
  downloadUrl: string | null;
}

/** Vente / commande (GET /api/client/sales → listMySales). */
export interface ClientSale {
  id: string;
  createdAt: DateIso | null;
  dateAchat: DateIso | null;
  dateFormation: DateIso | null;
  totalAmount: MoneyAmount;
  itemCount: number;
  items: { type: string; name: string; price: MoneyAmount }[];
  giftCardTotal: MoneyAmount;
  acceptedCgv: boolean;
  invoice: ClientSaleInvoice | null;
}

/** Réponse de mise à jour / lecture du profil (PUT & GET /api/client/profile). */
export interface ClientProfile {
  firstName: string;
  lastName: string;
  email: string;
}

/** Motif d'éligibilité au remboursement (serveur = autorité). */
export type RefundReason = 'retractation' | 'institut' | 'none';

/** Éligibilité remboursement d'une réservation (GET …/refund-eligibility). */
export interface BookingRefundEligibility {
  eligibleRefund: boolean;
  reason: RefundReason;
  waiverSigned: boolean;
  refundAmount: MoneyAmount;
  daysBeforeService: number;
  cancellationDays: number;
}

/** Résultat d'une annulation (POST …/cancel). */
export interface BookingCancelResult {
  eligibleRefund: boolean;
  reason: RefundReason;
  refundAmount: MoneyAmount;
}
