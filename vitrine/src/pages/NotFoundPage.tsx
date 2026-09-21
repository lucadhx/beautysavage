import { motion } from 'framer-motion';
import { CTAButton } from '@/components/ui';
import { useSeo } from '@/lib/useSeo';

export default function NotFoundPage() {
  // Empêche l'indexation de la page 404 (soft-404) même en rendu client.
  useSeo({ title: 'Page introuvable', noindex: true });
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 pt-20 text-center">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-7xl font-extrabold md:text-9xl" style={{ color: 'var(--v-accent)' }}>
          404
        </p>
        <h1 className="mt-4 text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted-foreground">
          La page que vous recherchez n'existe pas ou a été déplacée.
        </p>
        <div className="mt-8 flex justify-center">
          <CTAButton to="/" variant="accent">
            Retour à l'accueil
          </CTAButton>
        </div>
      </motion.div>
    </div>
  );
}
