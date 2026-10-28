import { Link, Navigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { AboutContent, aboutPageReady } from '@/components/about/AboutContent';

/**
 * /a-propos — l'histoire de la fondatrice, éditée dans Manager → Le site →
 * Page À propos. Les adresses d'images sont résolues ici ; le rendu est celui
 * de `AboutContent`, partagé avec l'aperçu du Manager.
 */
export default function AboutPage() {
  const { data, loading } = useSiteData();
  const page = data?.company?.aboutPage;
  if (loading && !data) return <div className="min-h-screen" />;
  if (!aboutPageReady(page)) return <Navigate to="/" replace />;
  const view = {
    ...page!,
    image: page!.image ? resolvePreviewMediaUrl(page!.image) : '',
    sections: (page!.sections || []).map((s) => ({ ...s, image: s.image ? resolvePreviewMediaUrl(s.image) : '' })),
  };
  return (
    <div className="pt-20 sm:pt-24">
      <AboutContent page={view} />
      <section className="mx-auto max-w-3xl px-5 py-12 text-center sm:py-16">
        <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Envie de vous laisser chouchouter, ou d’apprendre le geste ?</p>
        <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link to="/prestations" className="inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 text-sm font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }} data-testid="about-cta-services">
            Réserver une prestation <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/formations" className="inline-flex items-center justify-center gap-2 rounded-md border px-6 py-3 text-sm font-semibold" style={{ borderColor: 'var(--v-border)' }}>
            Découvrir les formations
          </Link>
        </div>
      </section>
    </div>
  );
}
