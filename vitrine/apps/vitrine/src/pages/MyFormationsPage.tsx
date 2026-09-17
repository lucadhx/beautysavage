import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingState } from '@bs/ui';
import { ReviewDrawer } from '../features/account';
import { useMyLearningFormations } from '../features/learning/hooks';
import '../features/learning/learning.css';
import '../features/account/account.css';

export function MyFormationsPage() {
  const query = useMyLearningFormations();
  const [review, setReview] = useState<{ id: string; name: string } | null>(null);

  if (query.isPending) return <LoadingState label="Chargement de vos formations…" />;
  if (query.isError) {
    return (
      <section>
        <h1>Mes formations</h1>
        <EmptyState label="Connectez-vous pour accéder à vos formations." />
        <p style={{ marginTop: 'var(--bs-space-2)' }}>
          <Link className="bs-btn" to="/connexion">Se connecter</Link>
        </p>
      </section>
    );
  }

  const formations = query.data ?? [];

  return (
    <section className="bs-myf">
      <h1 className="bs-myf__title">Mes formations</h1>
      {formations.length === 0 ? (
        <EmptyState label="Vous n’avez pas encore de formation distancielle." />
      ) : (
        <div className="bs-myf__grid">
          {formations.map((formation) => (
            <div key={formation.formationId} className="bs-myf__card">
              <Link
                to={`/mes-formations/${formation.formationId}`}
                className="bs-myf__link"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="bs-myf__media">
                  {formation.coverImage ? (
                    <img src={formation.coverImage} alt="" loading="lazy" />
                  ) : (
                    <span className="bs-myf__ph" aria-hidden="true">
                      <i className="bi bi-mortarboard" />
                    </span>
                  )}
                  {formation.completedAt ? (
                    <span className="bs-myf__badge">
                      <i className="bi bi-patch-check" aria-hidden="true" /> Terminée
                    </span>
                  ) : null}
                </div>
                <div className="bs-myf__body">
                  <h2 className="bs-myf__name">{formation.name}</h2>
                  <div className="bs-lrn__progress">
                    <span className="bs-lrn__progressbar" style={{ width: `${formation.progressPct}%` }} />
                  </div>
                  <span className="bs-myf__pct">{formation.progressPct}% terminé</span>
                </div>
              </Link>
              {formation.completedAt ? (
                <div className="bs-myf__foot">
                  <button
                    type="button"
                    className="bs-btn bs-btn--secondary"
                    onClick={() => setReview({ id: formation.formationId, name: formation.name })}
                  >
                    <i className="bi bi-chat-quote" aria-hidden="true" /> Laisser un avis
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {review ? (
        <ReviewDrawer
          formationId={review.id}
          formationName={review.name}
          onClose={() => setReview(null)}
        />
      ) : null}
    </section>
  );
}
