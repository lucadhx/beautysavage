import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { buttonVariants } from '@/components/ui/primitives';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[var(--m-viewport-h)] flex-col items-center justify-center bg-background px-4 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
        <p className="text-7xl font-bold">404</p>
        <p className="mt-2 text-lg font-medium">Page introuvable</p>
        <p className="mt-1 text-sm text-muted-foreground">
          La page que vous cherchez n'existe pas.
        </p>
        {/*
          UN LIEN N'ENVELOPPE PAS UN BOUTON.

          `<a><button/></a>` est un imbriquement interactif interdit par HTML :
          le navigateur rend deux cibles superposées, la boîte du lien se
          calcule sur la ligne de texte (vingt pixels de haut) et non sur le
          bouton, et le comportement au clavier dépend du moteur.

          Le design system exporte `buttonVariants` précisément pour ce cas :
          donner à un VRAI lien l'allure d'un bouton, sans en fabriquer un.
        */}
        <Link to="/" className={`${buttonVariants()} mt-6`}>
          Retour au tableau de bord
        </Link>
      </motion.div>
    </div>
  );
}
