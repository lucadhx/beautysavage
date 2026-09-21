import {
  Activity,
  Inbox,
  Mail,
  MailCheck,
  LayoutDashboard,
  Building2,
  Phone,
  FileText,
  Images,
  Palette,
  Power,
  User,
  Code2,
  Users,
  KeyRound,
  Paintbrush,
  Network,
  LifeBuoy,
  Link2,
  ShieldHalf,
  FileSignature,
  ReceiptText,
  GraduationCap,
  Sparkles,
  CalendarDays,
  HandCoins,
  Gift,
  Star,
  ShieldCheck,
  Undo2,
  KeySquare,
  FileCheck2,
  Rocket,
  Server,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  devOnly?: boolean;
  /** Espace principal : Manager (métier) ou Développeur (technique, DEV only). */
  section: 'manager' | 'dev';
  /** Sous-catégorie visuelle (sobre, non repliable) au sein de l'espace. */
  group: string;
  /** Marqueur de badge dynamique (compteur), résolu par la sidebar. */
  badge?: 'contactUnread';
}

/**
 * Navigation — deux ESPACES (Manager / Développeur), chacun découpé en
 * sous-catégories visuelles. Uniquement des routes RÉELLES ; l'espace Développeur
 * est entièrement masqué aux non-DEV (filtré par `devOnly`).
 *
 * L'ORDRE d'affichage des sous-catégories vient de `GROUP_ORDER`.
 */
export const NAV_ITEMS: NavItem[] = [
  // ── MANAGER ────────────────────────────────────────────────────────────────
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, section: 'manager', group: 'Activité' },
  { to: '/demandes-contact', label: 'Demandes de contact', icon: Inbox, section: 'manager', group: 'Activité', badge: 'contactUnread' },
  { to: '/commerce/formations', label: 'Formations', icon: GraduationCap, section: 'manager', group: 'Commerce' },
  { to: '/commerce/prestations', label: 'Prestations', icon: Sparkles, section: 'manager', group: 'Commerce' },
  { to: '/commerce/calendrier', label: 'Calendrier', icon: CalendarDays, section: 'manager', group: 'Commerce' },
  { to: '/commerce/cartes-cadeaux', label: 'Cartes cadeaux', icon: Gift, section: 'manager', group: 'Commerce' },
  { to: '/commerce/validation-formations', label: 'Validation formations', icon: ShieldCheck, section: 'manager', group: 'Commerce' },
  { to: '/commerce/avis', label: 'Avis', icon: Star, section: 'manager', group: 'Commerce' },
  { to: '/commerce/mails', label: 'Mails institut', icon: Mail, section: 'manager', group: 'Commerce' },
  { to: '/commerce/remboursements', label: 'Remboursements', icon: Undo2, section: 'manager', group: 'Commerce' },
  { to: '/commerce/commissions', label: 'Commissions', icon: HandCoins, section: 'manager', group: 'Commerce' },
  { to: '/commerce/clients', label: 'Clients', icon: Users, section: 'manager', group: 'Commerce' },
  { to: '/commerce/ventes', label: 'Ventes', icon: ReceiptText, section: 'manager', group: 'Commerce' },

  /**
   * ── LE SITE ───────────────────────────────────────────────────────────────
   *
   * Trois écrans, et l'ordre dit lequel compte.
   *
   * « ACCUEIL » d'abord : c'est la page que la plupart des visiteurs voient,
   * souvent la seule, et la seule dont le texte se RÉÉCRIT — on change un
   * verbe, on déplace une preuve, on essaie un autre appel à l'action. Un
   * propriétaire qui vient améliorer sa conversion doit tomber dessus. Elle ne
   * figure pas sous « Pages du site » et ce n'est pas un oubli : l'accueil
   * n'est pas une page éditoriale, c'est une mise en scène — sa bannière, sa
   * maquette d'appareils et ses arguments n'ont pas d'équivalent en blocs.
   *
   * « CHAPITRES » porte le RÉCIT — Conception, Architecture, L'Expérience : la
   * colonne vertébrale du site, celle qu'on relit et qu'on affûte.
   *
   * « PAGES DU SITE » porte le reste, ce qu'on ajoute au fil de l'eau.
   *
   * Il n'y a ni tarifs, ni catalogue, ni avis, ni bannière promotionnelle :
   * L.Y Solution ne vend pas une offre listée, elle expose une méthode. Une
   * entrée de menu ouvrant un écran sans usage apprend à son propriétaire
   * qu'une partie de son espace ne le concerne pas — après quoi il cesse de
   * lire le menu.
   */
  { to: '/pages', label: 'Pages du site', icon: FileText, section: 'manager', group: 'Le site' },
  { to: '/mediatheque', label: 'Mediatheque', icon: Images, section: 'manager', group: 'Le site' },

  { to: '/entreprise', label: 'Informations', icon: Building2, section: 'manager', group: 'Entreprise' },
  { to: '/contacts', label: 'Coordonnées', icon: Phone, section: 'manager', group: 'Entreprise' },
  { to: '/theme', label: 'Thème du site', icon: Palette, section: 'manager', group: 'Entreprise' },
  { to: '/statut', label: 'Statut du site', icon: Power, section: 'manager', group: 'Entreprise' },

  /**
   * MON ENTREPRISE — dans « Mon espace », et pas dans « Entreprise ».
   *
   * Le groupe « Entreprise » réunit ce que le client ÉDITE de son site :
   * informations, coordonnées, thème, statut. Y ranger un écran en lecture
   * seule inviterait à y chercher un bouton « Modifier » qui n’existe pas.
   *
   * « Mon espace » réunit ce qui décrit la RELATION avec L.Y Solution — le
   * contrat, les factures, le profil, l’aide. L’identité juridique du client
   * y appartient : c’est elle qui figure sur les documents de cette relation.
   */
  { to: '/mon-entreprise', label: 'Mon entreprise', icon: Building2, section: 'manager', group: 'Mon espace' },
  { to: '/contrat', label: 'Mon contrat', icon: FileCheck2, section: 'manager', group: 'Mon espace' },
  { to: '/factures', label: 'Factures', icon: ReceiptText, section: 'manager', group: 'Mon espace' },
  { to: '/profil', label: 'Mon profil', icon: User, section: 'manager', group: 'Mon espace' },
  { to: '/support/information', label: 'Aide', icon: LifeBuoy, section: 'manager', group: 'Mon espace' },

  // ── DÉVELOPPEUR (masqué aux non-DEV) ─────────────────────────────────────────
  { to: '/dev/configuration', label: 'Configuration système', icon: Network, devOnly: true, section: 'dev', group: 'Configuration' },
  { to: '/dev/panel', label: 'Panel', icon: Link2, devOnly: true, section: 'dev', group: 'Configuration' },
  { to: '/commerce/cles-api', label: 'Cles API institut', icon: KeySquare, devOnly: true, section: 'dev', group: 'Configuration' },
  { to: '/dev/templates-email', label: 'Templates e-mail', icon: Mail, devOnly: true, section: 'dev', group: 'Configuration' },

  { to: '/dev/livraisons-email', label: 'Livraisons e-mail', icon: MailCheck, devOnly: true, section: 'dev', group: 'Supervision' },
  { to: '/dev/evenements', label: 'Événements système', icon: Activity, devOnly: true, section: 'dev', group: 'Supervision' },

  // Déploiement industriel (moteur P1/P2).
  { to: '/dev/deploiement', label: 'Déploiement', icon: Rocket, devOnly: true, section: 'dev', group: 'Déploiement' },
  { to: '/dev/deploiements', label: 'Déploiements (destinations)', icon: Server, devOnly: true, section: 'dev', group: 'Déploiement' },

  { to: '/dev/comptes', label: 'Comptes', icon: KeyRound, devOnly: true, section: 'dev', group: 'Administration' },
  { to: '/dev/equipe', label: 'Équipe développeur', icon: Users, devOnly: true, section: 'dev', group: 'Administration' },
  { to: '/dev/entreprise', label: 'Entreprise développeur', icon: Code2, devOnly: true, section: 'dev', group: 'Administration' },
  { to: '/dev/contrats', label: 'Contrats', icon: FileSignature, devOnly: true, section: 'dev', group: 'Administration' },
  { to: '/dev/theme-manager', label: 'Thème manager', icon: Paintbrush, devOnly: true, section: 'dev', group: 'Administration' },
  { to: '/dev/roles', label: 'Couleurs des rôles', icon: ShieldHalf, devOnly: true, section: 'dev', group: 'Administration' },
];

/** Ordre d'affichage des sous-catégories, par espace. */
export const GROUP_ORDER: Record<NavItem['section'], string[]> = {
  manager: ['Activité', 'Commerce', 'Le site', 'Entreprise', 'Mon espace'],
  dev: ['Configuration', 'Supervision', 'Déploiement', 'Administration'],
};
