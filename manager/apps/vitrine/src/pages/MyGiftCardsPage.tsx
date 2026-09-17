// RX4 — Mes cartes cadeaux (P5). Solde, code MASQUÉ (révélation explicite), historique des transactions
// dans un drawer. AUCUNE notion d'expiration (règle métier M13/RX2.6). Réutilise M13 + RX2.6.
import { useState } from 'react';
import { Badge, Drawer, EmptyState, ErrorState, Skeleton } from '@bs/ui';
import { formatPrice, type ClientGiftCard, type ClientGiftCardTransaction } from '@bs/api-client';
import {
  AccountShell,
  useMyGiftCards,
  useMyGiftCard,
  maskGiftCardCode,
  formatShortDate,
} from '../features/account';

const STATUS_LABEL: Record<string, string> = { active: 'Active', used: 'Épuisée', suspended: 'Suspendue' };

function GiftCardTile({ card, onOpen }: { card: ClientGiftCard; onOpen: () => void }) {
  return (
    <button type="button" className="bs-gc" onClick={onOpen}>
      <div className="bs-gc__top">
        <span className="bs-gc__brand"><i className="bi bi-gift" aria-hidden="true" /> Carte cadeau</span>
        <Badge tone={card.status === 'active' ? 'success' : 'muted'}>{STATUS_LABEL[card.status] || card.status}</Badge>
      </div>
      <span className="bs-gc__balance">{formatPrice(card.availableBalance)}</span>
      <span className="bs-gc__code">{maskGiftCardCode(card.code)}</span>
      <div className="bs-gc__foot">
        <span>sur {formatPrice(card.amount)}</span>
        <span>Détails <i className="bi bi-chevron-right" aria-hidden="true" /></span>
      </div>
    </button>
  );
}

function TransactionRow({ tx }: { tx: ClientGiftCardTransaction }) {
  const isCredit = tx.transactionType === 'credit';
  const sign = isCredit ? '+' : '−';
  return (
    <div className="bs-gc-tx">
      <span className="bs-gc-tx__label">
        <strong>{tx.usedByLabel}</strong>
        <span className="bs-row__meta">{formatShortDate(tx.createdAt)}</span>
      </span>
      <span className={`bs-gc-tx__amount ${isCredit ? 'bs-gc-tx__amount--credit' : 'bs-gc-tx__amount--debit'}`}>
        {sign}{formatPrice(Math.abs(tx.amount))}
      </span>
    </div>
  );
}

function GiftCardDrawer({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const query = useMyGiftCard(cardId);
  const [revealed, setRevealed] = useState(false);
  const card = query.data?.card;
  const transactions = query.data?.transactions ?? [];

  return (
    <Drawer open title="Détail de la carte" onClose={onClose}>
      {query.isPending ? (
        <Skeleton variant="block" height="80px" count={2} />
      ) : query.isError || !card ? (
        <ErrorState title="Carte introuvable." />
      ) : (
        <div className="bs-hub__section">
          <article className="bs-gc" style={{ cursor: 'default' }}>
            <div className="bs-gc__top">
              <span className="bs-gc__brand"><i className="bi bi-gift" aria-hidden="true" /> Solde disponible</span>
            </div>
            <span className="bs-gc__balance">{formatPrice(card.availableBalance)}</span>
            <span className="bs-gc__code">{revealed ? card.code : maskGiftCardCode(card.code)}</span>
          </article>

          <button type="button" className="bs-gc-reveal" onClick={() => setRevealed((v) => !v)}>
            <i className={`bi ${revealed ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
            {revealed ? 'Masquer le code' : 'Afficher le code'}
          </button>

          <div className="bs-hub__section">
            <h3 className="bs-hub__section-title">Historique</h3>
            {transactions.length === 0 ? (
              <p style={{ color: 'var(--bs-color-muted)', margin: 0 }}>Aucune utilisation pour le moment.</p>
            ) : (
              <div>{transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}</div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function MyGiftCardsPage() {
  const query = useMyGiftCards();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <AccountShell title="Mes cartes cadeaux">
      {query.isPending ? (
        <Skeleton variant="block" height="120px" count={2} />
      ) : query.isError ? (
        <ErrorState title="Impossible de charger vos cartes." />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState label="Vous n'avez pas encore de carte cadeau." />
      ) : (
        <div className="bs-gc-grid">
          {(query.data ?? []).map((card) => (
            <GiftCardTile key={card.id} card={card} onOpen={() => setOpenId(card.id)} />
          ))}
        </div>
      )}
      {openId ? <GiftCardDrawer cardId={openId} onClose={() => setOpenId(null)} /> : null}
    </AccountShell>
  );
}
