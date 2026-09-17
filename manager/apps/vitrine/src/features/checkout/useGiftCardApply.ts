import { useCallback, useMemo, useState } from 'react';
import {
  validateGiftCard,
  validateGiftCardCredentials,
  ApiError,
  type AppliedGiftCard,
  type GiftCardValidation,
} from '@bs/api-client';

// RX3 S3 — Gestion des cartes cadeaux appliquées au checkout (moyen de paiement). Valide un code,
// gère le mot de passe si la carte est protégée, et alloue le montant utilisé de façon gourmande jusqu'au
// sous-total. Le backend recalcule et cape au solde réel — ici c'est indicatif.

export interface AppliedCardEntry extends GiftCardValidation {
  password?: string;
}

export interface UseGiftCardApply {
  cards: AppliedCardEntry[];
  /** Allocation gourmande {carte → montant utilisé} bornée au sous-total. */
  allocations: AppliedGiftCard[];
  giftCardUsed: number;
  pending: boolean;
  error: string;
  /** Code en attente de mot de passe (carte protégée), ou null. */
  needsPasswordFor: string | null;
  apply: (code: string) => Promise<void>;
  submitPassword: (password: string) => Promise<void>;
  cancelPassword: () => void;
  remove: (code: string) => void;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message || 'Carte cadeau invalide.';
  return 'Carte cadeau invalide.';
}

export function useGiftCardApply(subtotal: number): UseGiftCardApply {
  const [cards, setCards] = useState<AppliedCardEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [needsPasswordFor, setNeedsPasswordFor] = useState<string | null>(null);

  const addCard = useCallback((card: GiftCardValidation, password?: string) => {
    setCards((prev) => {
      if (prev.some((c) => c.code === card.code)) return prev; // dédup par code
      return [...prev, { ...card, password }];
    });
  }, []);

  const apply = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return;
      setError('');
      if (cards.some((c) => c.code === code)) {
        setError('Cette carte est déjà appliquée.');
        return;
      }
      setPending(true);
      try {
        const card = await validateGiftCard(code);
        if (card.status && card.status !== 'active') {
          setError('Cette carte cadeau n’est pas active.');
          return;
        }
        if (card.availableBalance <= 0) {
          setError('Cette carte cadeau n’a plus de solde.');
          return;
        }
        if (card.hasPassword) {
          setNeedsPasswordFor(code);
          return;
        }
        addCard(card);
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setPending(false);
      }
    },
    [cards, addCard],
  );

  const submitPassword = useCallback(
    async (password: string) => {
      if (!needsPasswordFor) return;
      setError('');
      setPending(true);
      try {
        const card = await validateGiftCardCredentials(needsPasswordFor, password);
        if (card.availableBalance <= 0) {
          setError('Cette carte cadeau n’a plus de solde.');
          return;
        }
        addCard(card, password);
        setNeedsPasswordFor(null);
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setPending(false);
      }
    },
    [needsPasswordFor, addCard],
  );

  const cancelPassword = useCallback(() => {
    setNeedsPasswordFor(null);
    setError('');
  }, []);

  const remove = useCallback((code: string) => {
    setCards((prev) => prev.filter((c) => c.code !== code));
  }, []);

  // Allocation gourmande bornée au sous-total.
  const allocations = useMemo<AppliedGiftCard[]>(() => {
    let remaining = subtotal;
    const out: AppliedGiftCard[] = [];
    for (const c of cards) {
      if (remaining <= 0) break;
      const amount = Math.min(c.availableBalance, remaining);
      if (amount <= 0) continue;
      out.push({ giftCardId: c.id || undefined, code: c.code, password: c.password, amount });
      remaining -= amount;
    }
    return out;
  }, [cards, subtotal]);

  const giftCardUsed = allocations.reduce((s, a) => s + a.amount, 0);

  return { cards, allocations, giftCardUsed, pending, error, needsPasswordFor, apply, submitPassword, cancelPassword, remove };
}
