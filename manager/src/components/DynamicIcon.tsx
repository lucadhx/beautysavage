import {
  Phone,
  MessageCircle,
  Mail,
  Instagram,
  Facebook,
  Music2,
  Ghost,
  MapPin,
  Home,
  Globe,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

// Registre restreint aux icônes réellement utilisées par le catalogue média
// (backend MEDIA_CATALOG). Éviter `import * as Icons from 'lucide-react'` qui
// embarquait toute la librairie (~700 Ko) dans le bundle.
const ICONS: Record<string, LucideIcon> = {
  Phone,
  MessageCircle,
  Mail,
  Instagram,
  Facebook,
  Music2,
  Ghost,
  MapPin,
  Home,
  Globe,
};

/** Render a Lucide icon by its string name (from the media catalog). */
export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] || HelpCircle;
  return <Icon className={className} />;
}
