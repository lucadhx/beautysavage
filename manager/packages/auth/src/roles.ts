import type { Role } from '@bs/api-client';

// Relabel UNIQUEMENT pour l'UI. Les rôles backend (client/admin/dev) sont inchangés.
export const ROLE_LABEL: Record<Role, string> = {
  client: 'Client',
  admin: 'Manager',
  dev: 'Développeur',
};

export function roleLabel(role: Role | undefined | null): string {
  return role ? ROLE_LABEL[role] : '';
}
