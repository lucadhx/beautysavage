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
 * fichiers portent donc les mêmes clés. Le CATALOGUE (clé + libellé) ne vit
 * que côté Manager : la vitrine n'a rien à présenter, elle a à dessiner.
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

/** L'icône nommée, ou le trait neutre si le nom n'est pas au registre. */
export function siteIcon(name?: string | null): LucideIcon {
  return SITE_ICONS[String(name ?? '')] ?? Minus;
}

export default { SITE_ICONS, siteIcon };
