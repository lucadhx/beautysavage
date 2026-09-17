// RX4 — Dashboard client (Client Hub). Répond immédiatement aux 7 questions d'une cliente : prochain RDV,
// formation en cours, carte cadeau, factures, remboursement, attestations, aide. Mobile-first, cards, zéro
// tableau. Réutilise @bs/ui + hooks account/learning. Le serveur fait foi (aucun calcul métier ici).
import { Link, useNavigate } from 'react-router-dom';
import { Card, Button, Skeleton } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { formatPrice } from '@bs/api-client';
import {
  useMyBookings,
  useMyGiftCards,
  useMySales,
  useMyProfile,
  readStoredFirstName,
  pickNextBooking,
  greetingName,
  formatLongDate,
  formatTimeRange,
  bookingBalanceDue,
  totalGiftCardBalance,
} from '../features/account';
import { useMyLearningFormations } from '../features/learning/hooks';
import './myAccount.css';
import '../features/account/account.css';

interface QuickAction {
  to: string;
  icon: string;
  label: string;
  soon?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: '/mon-compte/rendez-vous', icon: 'bi-calendar-heart', label: 'Rendez-vous' },
  { to: '/mes-formations', icon: 'bi-mortarboard', label: 'Formations' },
  { to: '/mon-compte/cartes-cadeaux', icon: 'bi-gift', label: 'Cartes cadeaux' },
  { to: '/mon-compte/factures', icon: 'bi-receipt', label: 'Factures' },
  { to: '/mon-compte/documents', icon: 'bi-folder2-open', label: 'Documents' },
  { to: '/mon-compte/profil', icon: 'bi-person-gear', label: 'Profil' },
  { to: '/mon-compte/aide', icon: 'bi-life-preserver', label: 'Aide' },
  { to: '/mon-compte/notifications', icon: 'bi-bell', label: 'Notifications', soon: true },
];

export function MyAccountPage() {
  const { user, status, signOut } = useAuth();
  const navigate = useNavigate();

  const bookings = useMyBookings();
  const learning = useMyLearningFormations();
  const giftCards = useMyGiftCards();
  const sales = useMySales();
  const profile = useMyProfile();

  if (status === 'loading') return <div className="bs-hub"><Skeleton variant="block" height="120px" /></div>;

  if (status !== 'authenticated' || !user) {
    return (
      <section className="bs-hub">
        <h1 className="bs-hub__hello-title">Mon compte</h1>
        <Card>
          <p>Connectez-vous pour retrouver vos rendez-vous, formations, cartes cadeaux et factures.</p>
          <Link className="bs-btn" to="/connexion?redirect=/mon-compte">Se connecter</Link>
        </Card>
      </section>
    );
  }

  const firstName = greetingName(profile.data?.firstName || readStoredFirstName(), user.email);
  const initials = (firstName || user.email || '?').slice(0, 2).toUpperCase();

  const nextBooking = pickNextBooking(bookings.data ?? []);
  const formations = learning.data ?? [];
  const activeFormation =
    formations.find((f) => !f.completedAt && f.progressPct > 0) ??
    formations.find((f) => !f.completedAt) ??
    formations[0] ??
    null;
  const giftBalance = totalGiftCardBalance(giftCards.data ?? []);
  const recentSales = (sales.data ?? []).slice(0, 3);

  async function onLogout() {
    await signOut();
    navigate('/');
  }

  return (
    <section className="bs-hub">
      {/* Bonjour */}
      <div className="bs-hub__hello">
        <span className="bs-hub__avatar" aria-hidden="true">{initials}</span>
        <div className="bs-hub__hello-text">
          <h1 className="bs-hub__hello-title">Bonjour{firstName ? ` ${firstName}` : ''}</h1>
          <span className="bs-hub__hello-sub">{user.email}</span>
        </div>
        <button type="button" className="bs-hub__logout" onClick={onLogout}>
          <i className="bi bi-box-arrow-right" aria-hidden="true" /> Déconnexion
        </button>
      </div>

      {/* Prochain rendez-vous */}
      <div className="bs-hub__section">
        {bookings.isPending ? (
          <Skeleton variant="block" height="120px" />
        ) : nextBooking ? (
          <article className="bs-hl bs-hl--accent">
            <span className="bs-hl__label"><i className="bi bi-calendar-heart" aria-hidden="true" /> Prochain rendez-vous</span>
            <h2 className="bs-hl__title">{nextBooking.serviceName || 'Prestation'}</h2>
            <div className="bs-hl__meta">
              <span><i className="bi bi-calendar3" aria-hidden="true" /> {formatLongDate(nextBooking.startAt)}</span>
              <span><i className="bi bi-clock" aria-hidden="true" /> {formatTimeRange(nextBooking.startAt, nextBooking.endAt)}</span>
              {bookingBalanceDue(nextBooking) > 0 ? (
                <span><i className="bi bi-wallet2" aria-hidden="true" /> Reste à régler {formatPrice(bookingBalanceDue(nextBooking))}</span>
              ) : null}
            </div>
            <Link className="bs-btn bs-btn--secondary bs-hl__cta" to="/mon-compte/rendez-vous">Voir mes rendez-vous</Link>
          </article>
        ) : (
          <article className="bs-hl bs-hl--plain">
            <span className="bs-hl__label"><i className="bi bi-calendar-heart" aria-hidden="true" /> Prochain rendez-vous</span>
            <p style={{ margin: 0, color: 'var(--bs-color-muted)' }}>Aucun rendez-vous à venir.</p>
            <Link className="bs-btn bs-hl__cta" to="/prestations">Réserver une prestation</Link>
          </article>
        )}
      </div>

      {/* Formation en cours */}
      {learning.isPending ? (
        <Skeleton variant="block" height="90px" />
      ) : activeFormation ? (
        <div className="bs-hub__section">
          <article className="bs-hl bs-hl--plain">
            <span className="bs-hl__label"><i className="bi bi-mortarboard" aria-hidden="true" /> Formation en cours</span>
            <h2 className="bs-hl__title">{activeFormation.name}</h2>
            <div className="bs-hl__progress"><span className="bs-hl__progressbar" style={{ width: `${activeFormation.progressPct}%` }} /></div>
            <div className="bs-hl__row">
              <span className="bs-hl__meta">{activeFormation.progressPct}% terminé</span>
              <Link className="bs-btn bs-hl__cta" to={`/mes-formations/${activeFormation.formationId}`}>
                {activeFormation.progressPct > 0 ? 'Continuer' : 'Commencer'}
              </Link>
            </div>
          </article>
        </div>
      ) : null}

      {/* Carte cadeau */}
      {!giftCards.isPending && giftBalance > 0 ? (
        <div className="bs-hub__section">
          <article className="bs-hl bs-hl--plain">
            <div className="bs-hl__row">
              <div>
                <span className="bs-hl__label"><i className="bi bi-gift" aria-hidden="true" /> Solde carte cadeau</span>
                <div className="bs-hl__amount">{formatPrice(giftBalance)}</div>
              </div>
              <Link className="bs-btn bs-btn--secondary bs-hl__cta" to="/mon-compte/cartes-cadeaux">Mes cartes</Link>
            </div>
          </article>
        </div>
      ) : null}

      {/* Actions rapides */}
      <div className="bs-hub__section">
        <div className="bs-hub__section-head"><h2 className="bs-hub__section-title">Accès rapide</h2></div>
        <div className="bs-hub__grid">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.label} to={a.to} className="bs-hub__action" aria-disabled={a.soon || undefined}
              onClick={a.soon ? (e) => e.preventDefault() : undefined}>
              <i className={`bi ${a.icon} bs-hub__action-icon`} aria-hidden="true" />
              <span className="bs-hub__action-label">{a.label}</span>
              {a.soon ? <span className="bs-hub__action-badge">Bientôt</span> : null}
            </Link>
          ))}
        </div>
      </div>

      {/* Historique récent */}
      {!sales.isPending && recentSales.length > 0 ? (
        <div className="bs-hub__section">
          <div className="bs-hub__section-head">
            <h2 className="bs-hub__section-title">Historique récent</h2>
            <Link className="bs-hub__section-link" to="/mon-compte/factures">Tout voir</Link>
          </div>
          <div className="bs-hub__list">
            {recentSales.map((s) => (
              <Link key={s.id} to="/mon-compte/factures" className="bs-row">
                <span className="bs-row__icon" aria-hidden="true"><i className="bi bi-bag-check" /></span>
                <span className="bs-row__body">
                  <span className="bs-row__title">{s.items[0]?.name || `${s.itemCount} article(s)`}</span>
                  <span className="bs-row__meta">{formatLongDate(s.dateAchat)}</span>
                </span>
                <span className="bs-row__aside"><span className="bs-row__amount">{formatPrice(s.totalAmount)}</span></span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* Besoin d'aide */}
      <div className="bs-hub__section">
        <Card>
          <div className="bs-hl__row">
            <div>
              <strong>Besoin d'aide ?</strong>
              <p style={{ margin: '4px 0 0', color: 'var(--bs-color-muted)', fontSize: '0.88rem' }}>
                Contact, horaires et itinéraire de l'institut.
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/mon-compte/aide')}>Nous contacter</Button>
          </div>
        </Card>
      </div>
    </section>
  );
}
