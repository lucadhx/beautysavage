import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useSiteStatus } from '@/context/SiteStatusContext';

/** Fixed orange banner shown across the manager while the site is suspended. */
export function SuspensionBanner() {
  const { status } = useSiteStatus();
  const suspended = status?.status === 'SUSPENDED';

  return (
    <AnimatePresence>
      {suspended && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden bg-orange-500 text-white"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:px-6 sm:py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium leading-snug sm:gap-2.5 sm:text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Le site est temporairement suspendu</span>
            </div>
            <Link
              to="/statut"
              className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-medium transition hover:bg-white/30"
            >
              <span className="sm:hidden">Détails</span>
              <span className="hidden sm:inline">Voir les détails</span>
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
