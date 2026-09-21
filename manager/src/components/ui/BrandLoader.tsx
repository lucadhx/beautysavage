import { motion, useReducedMotion } from 'framer-motion';
import { useCompany } from '@/context/CompanyContext';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Écran d'attente d'une page — à l'image de l'entreprise.
 *
 * Remplace le sablier générique par le logo, comme sur la vitrine. Si le logo
 * n'est pas (encore) connu — avant la connexion, ou entreprise sans logo — on
 * retombe sur le sablier : mieux vaut un indicateur neutre qu'un trou.
 *
 * Réservé aux attentes de PAGE. Les attentes courtes et localisées (dans un
 * bouton, une carte) gardent `Spinner` : y animer un logo serait tapageur.
 */
export function BrandLoader({ className, label = 'Chargement…' }: { className?: string; label?: string }) {
  const { company } = useCompany();
  const reduce = useReducedMotion();
  // Résolution canonique même-origine — JAMAIS la backendUrl publique (réseau).
  const logo = resolvePreviewMediaUrl(company?.logos?.header);

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-20', className)} role="status">
      {logo ? (
        <motion.img
          src={logo}
          alt=""
          className="h-12 w-auto max-w-[160px] object-contain"
          animate={reduce ? undefined : { opacity: [0.45, 1, 0.45], scale: [0.98, 1, 0.98] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
        />
      ) : (
        <Spinner className="h-7 w-7" />
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default BrandLoader;
