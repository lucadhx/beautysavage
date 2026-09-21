import {
  Phone,
  MessageCircle,
  Mail,
  Instagram,
  Linkedin,
  MapPin,
  Globe,
  Link2,
  type LucideIcon,
} from 'lucide-react';

// Registre restreint aux icônes du catalogue média (backend MEDIA_CATALOG).
// Évite `import * as Icons from 'lucide-react'` qui embarquait toute la
// librairie (~700 Ko) dans le bundle principal.
const ICONS: Record<string, LucideIcon> = {
  Phone,
  MessageCircle,
  Mail,
  Instagram,
  Linkedin,
  MapPin,
  Globe,
};

export function MediaIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] || Link2;
  return <Icon className={className} />;
}
