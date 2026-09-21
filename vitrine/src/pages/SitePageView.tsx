import * as React from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useSiteData } from '@/context/SiteDataContext';
import { useSeo } from '@/lib/useSeo';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { PageBlocks } from '@/components/PageBlocks';
import { RouteFallback } from '@/components/RouteBoundary';
import NotFoundPage from '@/pages/NotFoundPage';
import type { SitePage } from '@/types';

/**
 * UNE PAGE ÉDITORIALE — son en-tête, puis ses blocs.
 *
 * ══ POURQUOI LE TITRE VIENT DU BOOTSTRAP AVANT LE CHARGEMENT ════════════════
 *
 * Le bootstrap porte déjà l'ENTRÉE de chaque page : titre, chapô, image
 * d'en-tête. On peut donc peindre l'en-tête IMMÉDIATEMENT, pendant que les
 * blocs arrivent. Le visiteur voit le titre de la page qu'il a demandée dès
 * le clic, au lieu d'un écran d'attente vide — et la page ne saute pas quand
 * le contenu se pose, puisque l'en-tête ne bouge plus.
 */
export default function SitePageView() {
  const { slug = '' } = useParams();
  const { data } = useSiteData();

  const entree = React.useMemo(
    () => data?.pages?.find((p) => p.slug === slug) ?? null,
    [data?.pages, slug],
  );

  const [page, setPage] = React.useState<SitePage | null>(null);
  const [erreur, setErreur] = React.useState(false);
  const [chargement, setChargement] = React.useState(true);

  React.useEffect(() => {
    let vivant = true;
    setChargement(true);
    setErreur(false);
    setPage(null);
    api
      .page(slug)
      .then((p) => { if (vivant) setPage(p); })
      .catch(() => { if (vivant) setErreur(true); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [slug]);

  useSeo({
    title: page?.seo?.metaTitle || page?.title || entree?.title || 'Page',
    description: page?.seo?.metaDescription || page?.intro || entree?.intro || '',
    noindex: erreur,
  });

  /**
   * UNE PAGE INTROUVABLE EST UN 404, pas une page vide.
   *
   * Et on ne le décide qu'après la réponse du serveur : une page publiée
   * pendant que l'onglet était ouvert n'est pas dans le bootstrap mémorisé,
   * et l'absence d'entrée ne prouve donc rien.
   */
  if (erreur) return <NotFoundPage />;

  const titre = page?.title ?? entree?.title ?? '';
  const chapo = page?.intro ?? entree?.intro ?? '';
  const hero = resolvePreviewMediaUrl(page?.heroImage ?? entree?.heroImage ?? '');

  return (
    <div>
      {/* ── EN-TÊTE ──────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden">
        {hero && (
          <>
            <img
              src={hero}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              /* L'image d'en-tête est le premier pixel de la page : elle ne
                 doit pas être différée, sans quoi le titre flotte quelques
                 centaines de millisecondes sur un fond nu. */
              fetchPriority="high"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--v-background) 55%, transparent) 0%, color-mix(in srgb, var(--v-background) 92%, transparent) 100%)',
              }}
            />
          </>
        )}
        <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-32 md:px-8 md:pb-14 md:pt-40">
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-4xl font-extrabold tracking-tight md:text-5xl"
          >
            {titre}
          </motion.h1>
          {chapo && (
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="mt-4 max-w-2xl text-lg text-muted-foreground"
            >
              {chapo}
            </motion.p>
          )}
          <motion.span
            aria-hidden="true"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 block h-1 w-16 origin-left rounded-full"
            style={{ background: 'var(--v-accent)' }}
          />
        </div>
      </header>

      {/* ── LE CONTENU ───────────────────────────────────────────────────── */}
      {chargement && !page ? (
        <RouteFallback />
      ) : page ? (
        <div className="pb-10">
          <PageBlocks blocks={page.blocks ?? []} />
        </div>
      ) : null}
    </div>
  );
}
