import { Phone } from 'lucide-react';
import { api } from '@/lib/api';
import type { Company, MediaItem } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, Input, Switch } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { DynamicIcon } from '@/components/DynamicIcon';

export default function ContactsPage() {
  const { data, loading, setData } = useResource(() => api.getCompany());
  const { run } = useAction();

  // Avant le garde-fou de chargement : un hook ne peut pas être conditionnel.
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    const updated = await run(() => api.updateCompany(data), { success: 'Contacts mis à jour' });
    setData(updated);
    return updated;
  });

  if (loading || !data) {
    return (
      <BrandLoader />
    );
  }

  const updateMedia = (key: string, patch: Partial<MediaItem>) =>
    setData({ ...data, media: data.media.map((m) => (m.key === key ? { ...m, ...patch } : m)) } as Company);

  /**
   * CE QUI EST UNE COORDONNÉE, ET CE QUI EST UN LIEN.
   *
   * L'adresse e-mail passe en tête : c'est par elle qu'un projet se présente.
   * `googleMaps` a disparu du catalogue — L.Y Solution ne reçoit pas dans une
   * boutique, et une carte intégrée aurait fait partir l'IP de chaque visiteur
   * chez un tiers pour désigner un lieu où personne ne vient.
   */
  const contactKeys = ['email', 'phone', 'whatsapp', 'address'];
  const contacts = data.media.filter((m) => contactKeys.includes(m.key));
  const socials = data.media.filter((m) => !contactKeys.includes(m.key));

  return (
    <div className="pb-20">
      <PageHeader
        title="Coordonnées"
        description="Les moyens de vous joindre, affichés sur le site."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ContactGroup title="Coordonnées principales" items={contacts} onUpdate={updateMedia} />
        <ContactGroup title="Réseaux & liens" items={socials} onUpdate={updateMedia} />
      </div>

      {/*
        LES HORAIRES D'OUVERTURE ONT DISPARU — pas été masqués.

        Le moteur vient d'un projet de karting, où « ouvert / fermé » est
        l'information la plus consultée du site. Une maison de conception n'a
        pas de guichet : elle n'ouvre pas à 9 h et ne ferme pas le dimanche.
        Un bloc d'horaires y aurait annoncé une disponibilité qu'on ne tient
        pas, et le statut « fermé » du samedi aurait suggéré, à tort, qu'on ne
        répond pas.
      */}

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

function ContactGroup({
  title,
  items,
  onUpdate,
}: {
  title: string;
  items: MediaItem[];
  onUpdate: (key: string, patch: Partial<MediaItem>) => void;
}) {
  return (
    <Card>
      <CardContent>
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Phone className="h-4 w-4 text-muted-foreground" /> {title}
        </h3>
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.key} className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <DynamicIcon name={m.icon} className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <Input
                  placeholder={m.label}
                  value={m.value}
                  onChange={(e) => onUpdate(m.key, { value: e.target.value })}
                />
              </div>
              <Switch checked={m.enabled} onChange={(v) => onUpdate(m.key, { enabled: v })} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
