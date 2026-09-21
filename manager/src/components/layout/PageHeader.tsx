import { motion } from 'framer-motion';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-wrap items-start justify-between gap-4"
    >
      {/*
        ══ LE TITRE SE COMPRIME, LES ACTIONS SE REPLIENT ═══════════════════════

        L'en-tête portait deux boîtes incompressibles côte à côte. Sur les
        écrans qui alignent trois commandes — « Réinitialiser », « Tester les
        URL », « Enregistrer » —, leur rangée mesurait 435 px : à 320 px, elle
        sortait de l'écran et le bouton « Enregistrer » devenait inatteignable
        sans barre de défilement horizontale.

        `min-w-0` autorise le titre à se réduire ; `flex-wrap` laisse les
        commandes passer à la ligne plutôt que de pousser la page. La
        correction est ici, dans le composant partagé : chaque écran qui pose
        plusieurs actions en aurait sinon hérité le défaut à son tour.
      */}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </motion.div>
  );
}
