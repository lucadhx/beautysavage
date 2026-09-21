import {
  Fingerprint, Compass, PenTool, Layers, Boxes, Shapes, Type, Palette, Ruler,
  Grid3x3, MonitorSmartphone, Smartphone, Code2, Terminal, Cpu, Database, Server,
  Cloud, ShieldCheck, Lock, KeyRound, Gauge, Zap, Sparkles, Eye, Search,
  MessageSquare, Handshake, Users, Building2, Target, Route, Milestone, Rocket,
  Lightbulb, Feather, Aperture, Workflow, GitBranch, Send, Clock, Check, Minus,
  type LucideIcon,
} from 'lucide-react';

/**
 * LES ICÔNES DU SITE — un registre FERMÉ, partagé par le Manager et la vitrine.
 *
 * ══ POURQUOI UNE LISTE, ET SURTOUT PAS `import * as Icons` ══════════════════
 *
 * Importer la bibliothèque entière pour résoudre un nom au moment du rendu
 * embarque ~700 Ko dans le paquet livré — pour quarante icônes réellement
 * utilisées. Le projet a déjà pris cette décision une fois
 * (`components/DynamicIcon.tsx`) ; on la reprend telle quelle plutôt que de la
 * rediscuter.
 *
 * ══ POURQUOI LE MANAGER LE PARTAGE AVEC LA VITRINE ══════════════════════════
 *
 * Parce que l'administrateur CHOISIT une icône dans une liste, et que le
 * visiteur la VOIT. Si les deux listes divergent, on obtient un sélecteur qui
 * propose des icônes que le site ne sait pas dessiner — et le rendu retombe
 * silencieusement sur un repli, pour une fiche parfaitement correcte. Les deux
 * fichiers portent donc les mêmes clés ; le libellé n'existe que côté
 * sélecteur.
 *
 * ══ CE QUI A CHANGÉ EN VENANT DU MOTEUR D'ORIGINE ═══════════════════════════
 *
 * Le registre nommait des compteurs, des drapeaux à damier et des podiums : le
 * vocabulaire d'un circuit de karting. Les volets d'un chapitre L.Y parlent
 * d'identité, de direction artistique, d'architecture et de livraison — d'où
 * un vocabulaire entièrement remplacé, et non complété. Une icône de trophée
 * proposée sur « Conception » est une invitation à écrire la mauvaise page.
 *
 * `Minus` est le DÉFAUT d'un volet neuf, et c'est délibéré : un simple trait.
 * Une icône par défaut évocatrice — une ampoule, une étincelle — se retrouve
 * sur les douze volets d'un chapitre parce que personne n'a eu de raison de la
 * changer, et douze ampoules ne veulent plus rien dire.
 */
export const SITE_ICONS: Record<string, LucideIcon> = {
  Fingerprint, Compass, PenTool, Layers, Boxes, Shapes, Type, Palette, Ruler,
  Grid3x3, MonitorSmartphone, Smartphone, Code2, Terminal, Cpu, Database, Server,
  Cloud, ShieldCheck, Lock, KeyRound, Gauge, Zap, Sparkles, Eye, Search,
  MessageSquare, Handshake, Users, Building2, Target, Route, Milestone, Rocket,
  Lightbulb, Feather, Aperture, Workflow, GitBranch, Send, Clock, Check, Minus,
};

/** Le catalogue tel qu'un sélecteur le présente : la clé, et ce qu'elle évoque. */
export const SITE_ICON_CATALOG: { name: string; label: string }[] = [
  { name: 'Minus', label: 'Trait (neutre)' },
  { name: 'Fingerprint', label: 'Identité' },
  { name: 'Compass', label: 'Direction' },
  { name: 'PenTool', label: 'Dessin' },
  { name: 'Palette', label: 'Couleurs' },
  { name: 'Type', label: 'Typographie' },
  { name: 'Shapes', label: 'Formes' },
  { name: 'Grid3x3', label: 'Grille' },
  { name: 'Ruler', label: 'Mesure' },
  { name: 'Layers', label: 'Couches' },
  { name: 'Boxes', label: 'Architecture' },
  { name: 'Aperture', label: 'Cadrage' },
  { name: 'Eye', label: 'Regard' },
  { name: 'MonitorSmartphone', label: 'Espace public' },
  { name: 'Smartphone', label: 'Mobile' },
  { name: 'Lock', label: 'Espace privé' },
  { name: 'KeyRound', label: 'Accès' },
  { name: 'ShieldCheck', label: 'Sécurité' },
  { name: 'Code2', label: 'Développement' },
  { name: 'Terminal', label: 'Technique' },
  { name: 'Cpu', label: 'Technologie' },
  { name: 'Database', label: 'Données' },
  { name: 'Server', label: 'Infrastructure' },
  { name: 'Cloud', label: 'Hébergement' },
  { name: 'Workflow', label: 'Processus' },
  { name: 'GitBranch', label: 'Versions' },
  { name: 'Gauge', label: 'Performance' },
  { name: 'Zap', label: 'Rapidité' },
  { name: 'Search', label: 'Référencement' },
  { name: 'MessageSquare', label: 'Échange' },
  { name: 'Handshake', label: 'Collaboration' },
  { name: 'Users', label: 'Équipe' },
  { name: 'Building2', label: 'Entreprise' },
  { name: 'Target', label: 'Objectif' },
  { name: 'Route', label: 'Parcours' },
  { name: 'Milestone', label: 'Étape' },
  { name: 'Rocket', label: 'Mise en ligne' },
  { name: 'Send', label: 'Livraison' },
  { name: 'Clock', label: 'Durée' },
  { name: 'Lightbulb', label: 'Idée' },
  { name: 'Feather', label: 'Légèreté' },
  { name: 'Sparkles', label: 'Soin du détail' },
  { name: 'Check', label: 'Validé' },
];

/** L'icône nommée, ou le trait neutre si le nom n'est pas au registre. */
export function siteIcon(name?: string | null): LucideIcon {
  return SITE_ICONS[String(name ?? '')] ?? Minus;
}

export default { SITE_ICONS, SITE_ICON_CATALOG, siteIcon };
