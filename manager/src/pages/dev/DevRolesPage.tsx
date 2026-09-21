import { Save, ShieldCheck, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import type { Role, RoleAppearance } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useRoleAppearance } from '@/context/RoleAppearanceContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ColorField } from '@/components/fields/ColorField';

const ROLE_META: Record<Role, { label: string; description: string; icon: typeof ShieldCheck }> = {
  DEV: {
    label: 'Développeur',
    description: 'Accès complet, y compris la configuration technique.',
    icon: ShieldCheck,
  },
  ADMIN: {
    label: 'Administrateur',
    description: 'Gestion du contenu et des paramètres de l’établissement.',
    icon: UserCog,
  },
};

const ROLE_ORDER: Role[] = ['DEV', 'ADMIN'];

export default function DevRolesPage() {
  const { data, loading, setData } = useResource(() => api.getRoleAppearance());
  const { set: setContext } = useRoleAppearance();
  const { pending, run } = useAction();

  if (loading || !data) {
    return (
      <BrandLoader />
    );
  }

  const setColor = (role: Role, key: 'background' | 'foreground', value: string) => {
    setData({
      ...data,
      roles: { ...data.roles, [role]: { ...data.roles[role], [key]: value } },
    } as RoleAppearance);
  };

  const save = async () => {
    const saved = await run(() => api.updateRoleAppearance({ roles: data.roles }), {
      success: 'Couleurs des rôles enregistrées',
    });
    setData(saved);
    setContext(saved);
  };

  return (
    <div>
      <PageHeader
        title="Couleurs des rôles"
        description="Personnalisez l'apparence des badges de rôle affichés dans le manager."
        action={
          <Button onClick={save} loading={pending}>
            <Save className="h-4 w-4" /> Enregistrer
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        {ROLE_ORDER.map((role) => {
          const meta = ROLE_META[role];
          const style = data.roles[role];
          const Icon = meta.icon;
          return (
            <Card key={role}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-4 w-4" /> {meta.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{meta.description}</p>

                {/* Aperçu en direct */}
                <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                  <span className="text-xs font-medium text-muted-foreground">Aperçu</span>
                  <Badge
                    className="gap-1"
                    style={{ backgroundColor: style.background, color: style.foreground }}
                  >
                    <Icon className="h-3 w-3" />
                    {role}
                  </Badge>
                </div>

                <div className="grid gap-3">
                  <ColorField
                    label="Couleur de fond"
                    value={style.background}
                    onChange={(v) => setColor(role, 'background', v)}
                  />
                  <ColorField
                    label="Couleur du texte"
                    value={style.foreground}
                    onChange={(v) => setColor(role, 'foreground', v)}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
