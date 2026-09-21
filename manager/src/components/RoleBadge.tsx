import { ShieldCheck, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { useRoleAppearance } from '@/context/RoleAppearanceContext';
import { cn } from '@/lib/utils';
import type { Role } from '@/types';

const ICONS: Record<Role, typeof ShieldCheck> = {
  DEV: ShieldCheck,
  ADMIN: UserCog,
};

/** Badge de rôle coloré ; les couleurs sont pilotées depuis un compte DEV. */
export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const { styleFor } = useRoleAppearance();
  const style = styleFor(role);
  const Icon = ICONS[role] || UserCog;
  return (
    <Badge
      className={cn('gap-1', className)}
      style={{ backgroundColor: style.background, color: style.foreground }}
    >
      <Icon className="h-3 w-3" />
      {role}
    </Badge>
  );
}
