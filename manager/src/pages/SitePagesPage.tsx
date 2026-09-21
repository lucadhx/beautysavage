import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Pencil, Trash2, GripVertical, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import type { SitePage } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, Button, Switch, EmptyState, Badge } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ConfirmDialog } from '@/components/ui/dialog';

/**
 * LES PAGES DU SITE — la LISTE, et rien d'autre.
 *
 * ══ CE QUE L'AUTEUR CHOISIT, ET CE QU'IL NE CHOISIT PAS ═════════════════════
 *
 * Il choisit CE QU'IL DIT : un titre, un paragraphe, une image, des chiffres
 * clés. Il ne choisit ni la police, ni la couleur, ni l'espacement — le thème
 * les porte. C'est la seule façon d'obtenir qu'une page saisie par un client
 * ressemble à une page dessinée : on ne lui donne pas les outils de la rater.
 *
 * Le prix de ce choix est assumé : on ne peut pas tout faire. Une mise en page
 * qui n'existe pas ici n'est pas « impossible », elle est À AJOUTER — comme un
 * type de bloc, une fois, pour tout le monde.
 *
 * ══ L'ÉDITION A SA PROPRE PAGE ══════════════════════════════════════════════
 *
 * Elle vivait dans une fenêtre modale, et c'était le dernier écran de cette
 * section à l'avoir gardée. Voir `SitePageEditPage` pour le raisonnement — il
 * vaut aussi pour les karts, les tracés et les épreuves, et il n'est écrit
 * qu'une fois.
 *
 * Cet écran ne fait donc plus que trois choses : lister, ordonner le menu au
 * glisser-déposer, et publier ou retirer une page sans l'ouvrir.
 */

export default function SitePagesPage() {
  const { data, loading, setData, reload } = useResource(() => api.listPages());
  const [toDelete, setToDelete] = React.useState<SitePage | null>(null);
  const navigate = useNavigate();
  const { pending, run } = useAction();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const items = data || [];

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((p) => p._id === active.id);
    const to = items.findIndex((p) => p._id === over.id);
    const reordonne = arrayMove(items, from, to);
    setData(reordonne);
    await run(() => api.reorderPages(reordonne.map((p, i) => ({ id: p._id, order: i }))), {
      success: 'Ordre du menu mis à jour',
    });
  };

  const togglePublished = async (p: SitePage) => {
    const maj = await run(() => api.updatePage(p._id, { ...p, published: !p.published }), {
      success: p.published ? 'Page dépubliée' : 'Page publiée',
    });
    setData(items.map((x) => (x._id === maj._id ? maj : x)));
  };

  const doDelete = async () => {
    if (!toDelete) return;
    await run(() => api.deletePage(toDelete._id), { success: 'Page supprimée' });
    setToDelete(null);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Pages du site"
        description="Les pages éditoriales — présentation, informations pratiques. Glissez pour changer leur ordre dans le menu."
        action={
          <Button onClick={() => navigate('/pages/nouveau')}>
            <Plus className="h-4 w-4" /> Nouvelle page
          </Button>
        }
      />

      {loading ? (
        <BrandLoader />
      ) : items.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((p) => p._id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {items.map((p) => (
                <LignePage
                  key={p._id}
                  page={p}
                  onEdit={() => navigate(`/pages/${p._id}`)}
                  onDelete={() => setToDelete(p)}
                  onToggle={() => togglePublished(p)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <EmptyState
          icon={FileText}
          title="Aucune page"
          description="Créez la page « Présentation » : texte, images, chiffres clés."
          action={
            <Button onClick={() => navigate('/pages/nouveau')}>
              <Plus className="h-4 w-4" /> Nouvelle page
            </Button>
          }
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={doDelete}
        title="Supprimer cette page ?"
        description={toDelete ? `« ${toDelete.title} » — le lien /${toDelete.slug} deviendra introuvable.` : undefined}
        destructive
        confirmLabel="Supprimer"
        loading={pending}
      />
    </div>
  );
}

function LignePage({
  page, onEdit, onDelete, onToggle,
}: {
  page: SitePage; onEdit: () => void; onDelete: () => void; onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page._id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-10 opacity-80' : ''}
    >
      <Card>
          {/*
            LA RANGÉE SE REPLIE SOUS 640 px — elle DÉBORDAIT.

            Sept éléments se partageaient une seule ligne : la poignée, la
            vignette, deux lignes de texte, la pastille « Brouillon »,
            l'interrupteur et deux boutons. À 320 px, la somme de leurs
            largeurs incompressibles dépassait la carte de trente-cinq pixels :
            la page gagnait une barre de défilement horizontale, et les deux
            boutons d'action étaient écrasés à seize pixels de large — sous la
            moitié d'une cible tactile utilisable.

            Les commandes passent donc à la ligne sur écran étroit, et
            retrouvent leur rangée dès `sm`. La vignette rétrécit avec elles :
            c'est un repère, pas un contenu.
          */}
        <CardContent className="flex flex-wrap items-center gap-2 py-3 sm:flex-nowrap sm:gap-3">
          {/*
            LA POIGNÉE EST UN BOUTON : elle doit donc porter un nom et une
            cible. Elle n'avait ni l'un ni l'autre.
          */}
          <button
            {...attributes}
            {...listeners}
            aria-label={`Déplacer « ${page.title} » dans l'ordre du menu`}
            className="-m-1 shrink-0 cursor-grab p-1 text-muted-foreground hover:text-foreground"
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 sm:h-14 sm:w-20">
            {page.heroImage ? (
              <img src={resolvePreviewMediaUrl(page.heroImage)} alt="" className="h-full w-full object-cover" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground/50" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{page.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              /{page.slug} · {page.blocks?.length ?? 0} bloc{(page.blocks?.length ?? 0) > 1 ? 's' : ''}
              {page.showInNav ? ' · au menu' : ' · hors menu'}
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
            {!page.published && (
              <Badge className="shrink-0 bg-muted text-muted-foreground">Brouillon</Badge>
            )}
            <Switch
              checked={page.published}
              onChange={onToggle}
              label={page.published ? `Dépublier « ${page.title} »` : `Publier « ${page.title} »`}
            />
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Modifier « ${page.title} »`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Supprimer « ${page.title} »`}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── L'éditeur de page ─────────────────────────────────────────────────────── */
