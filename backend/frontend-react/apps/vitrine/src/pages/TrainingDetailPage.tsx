import { Link, useParams } from 'react-router-dom';
import { Gallery, Badge, LessonEmbed, isValidEmbed, PriceLabel, LoadingState, ErrorState } from '@bs/ui';
import { resolveMediaUrl } from '@bs/api-client';
import { usePublicTraining } from '../features/catalog/hooks/usePublicTrainings';
import { trainingPriceProps } from '../features/catalog/priceProps';
import { TrainingReviews } from '../features/catalog/components/TrainingReviews';
import { FormationPurchasePanel } from '../features/trainingDetail/FormationPurchasePanel';
import { TrainingFaq } from '../features/trainingDetail/TrainingFaq';
import { SimilarTrainings } from '../features/trainingDetail/SimilarTrainings';
import '../features/trainingDetail/trainingDetail.css';

export function TrainingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError } = usePublicTraining(id);

  if (isPending) return <LoadingState label="Chargement de la formation…" />;
  if (isError || !data) return <ErrorState title="Formation introuvable." />;

  const distanciel = data.type === 'distanciel';
  const galleryImages = [data.coverImage, ...(data.photos ?? [])]
    .map((p) => resolveMediaUrl(p))
    .filter((src): src is string => Boolean(src))
    .map((src) => ({ src, alt: data.name }));
  const hasTrailer = Boolean(data.trailerVideoUrl && isValidEmbed(data.trailerVideoUrl));

  return (
    <article className="td">
      <p className="td-breadcrumb">
        <Link to="/formations" className="bs-backlink">
          <i className="bi bi-arrow-left" aria-hidden="true" /> Retour aux formations
        </Link>
      </p>

      <header className="td-head">
        <h1 className="td-head__title">{data.name}</h1>
        <div className="td-head__meta">
          <Badge tone={distanciel ? 'info' : 'accent'}>{distanciel ? 'En ligne — accès à vie' : 'Présentiel'}</Badge>
          {data.salesCount && data.salesCount > 0 ? (
            <Badge tone="muted">
              {data.salesCount} inscrit{data.salesCount > 1 ? 's' : ''}
            </Badge>
          ) : null}
        </div>
        <div className="td-head__price">
          <PriceLabel {...trainingPriceProps(data)} />
        </div>
      </header>

      <div className="td-main">
        <Gallery images={galleryImages} ratio="16 / 9" fallbackAlt={data.name} />
        {hasTrailer ? <LessonEmbed url={data.trailerVideoUrl as string} title={`Aperçu — ${data.name}`} /> : null}

        {data.description ? (
          <section className="td-section" aria-label="Présentation">
            <h2 className="td-section__title">Présentation</h2>
            <p className="td-lead">{data.description}</p>
          </section>
        ) : null}

        {data.editorialHtml ? (
          <section className="td-section" aria-label="Programme">
            <h2 className="td-section__title">Programme</h2>
            {/* Contenu éditorial admin (comme la vitrine existante). Sanitizer dédié = suivi RX4. */}
            <div className="td-editorial" dangerouslySetInnerHTML={{ __html: data.editorialHtml }} />
          </section>
        ) : null}

        {distanciel ? (
          <section className="td-section" aria-label="Accès">
            <h2 className="td-section__title">Comment ça se passe</h2>
            <ul className="td-access">
              <li>
                <i className="bi bi-infinity" aria-hidden="true" /> Accès à vie au contenu en ligne
              </li>
              <li>
                <i className="bi bi-play-circle" aria-hidden="true" /> Vidéos et ressources à votre rythme
              </li>
              <li>
                <i className="bi bi-award" aria-hidden="true" /> Attestation à la fin du parcours
              </li>
            </ul>
          </section>
        ) : null}

        <FormationPurchasePanel training={data} />
      </div>

      <TrainingFaq training={data} />
      {id ? <TrainingReviews trainingId={id} /> : null}
      {id ? <SimilarTrainings currentId={id} /> : null}
    </article>
  );
}
