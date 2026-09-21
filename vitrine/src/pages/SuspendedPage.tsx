import { motion } from 'framer-motion';
import { Wrench } from 'lucide-react';
import { useSiteData } from '@/context/SiteDataContext';

export default function SuspendedPage() {
  const { data } = useSiteData();
  const name = data?.company?.name;

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--v-background)', color: 'var(--v-foreground)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center"
      >
        <motion.div
          animate={{ rotate: [0, -12, 12, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          className="flex h-20 w-20 items-center justify-center rounded-3xl"
          style={{ background: 'var(--v-muted)', color: 'var(--v-accent)' }}
        >
          <Wrench className="h-10 w-10" />
        </motion.div>
        {name && <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-muted-foreground">{name}</p>}
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">Site temporairement suspendu</h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          Notre site est momentanément indisponible. Revenez plus tard, nous serons très vite de
          retour.
        </p>
      </motion.div>
    </div>
  );
}
