import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * RÉORDONNER AU DOIGT COMME À LA SOURIS.
 *
 * Les listes du Manager se réordonnaient par le glisser-déposer NATIF du
 * navigateur (`draggable` + `dataTransfer`). Ce mécanisme n'existe tout
 * simplement pas au toucher sur iOS et la plupart des Android : sur tablette
 * ou téléphone, rien ne bougeait.
 *
 * Un seul composant désormais, sur dnd-kit :
 *  · souris, doigt, stylet : UN SEUL capteur, celui des événements
 *    « pointeur ». On saisit la POIGNÉE — elle porte `touch-action: none`,
 *    donc le défilement de la page ne vole pas le geste — et le déplacement
 *    démarre après 4 px, sans attente.
 *
 *    Pourquoi pas le capteur tactile de dnd-kit : il exigeait que le doigt
 *    reste immobile un instant (80 ms, 8 px de tolérance) avant de glisser.
 *    Un vrai doigt pose et glisse d'un seul geste : la tolérance était
 *    dépassée pendant l'attente, le geste annulé, et rien ne bougeait sur
 *    téléphone ni tablette. La poignée suffisant à séparer « glisser » de
 *    « faire défiler », l'attente n'apportait rien ;
 *  · clavier : Espace pour saisir, flèches pour déplacer, Espace pour poser.
 *
 * Les clés React restent STABLES pendant et après un déplacement (sinon un
 * champ en cours d'édition perdrait son contenu ou son focus) : le composant
 * tient sa propre liste de clés, réordonnée en même temps que les données.
 */

let keySeed = 0;
const newKey = () => `sortable-${++keySeed}`;

export interface SortableControls {
  /** Propriétés à poser sur l'élément racine de la ligne (ref + style). */
  itemProps: { ref: (node: HTMLElement | null) => void; style: React.CSSProperties; 'data-dragging'?: boolean };
  /** Propriétés de la poignée — à passer à <DragHandle />. */
  handleProps: Record<string, unknown>;
  isDragging: boolean;
  /** Retire la ligne en gardant les clés des autres alignées. */
  remove: () => void;
  index: number;
}

export function SortableList<T>({
  items,
  onChange,
  layout = 'vertical',
  renderItem,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  layout?: 'vertical' | 'grid';
  renderItem: (item: T, controls: SortableControls) => React.ReactNode;
}) {
  const keys = React.useRef<string[]>([]);
  // Lignes ajoutées depuis l'extérieur : de nouvelles clés en fin de liste.
  while (keys.current.length < items.length) keys.current.push(newKey());
  if (keys.current.length > items.length) keys.current = keys.current.slice(0, items.length);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.current.indexOf(String(active.id));
    const to = keys.current.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const nextKeys = [...keys.current];
    nextKeys.splice(to, 0, nextKeys.splice(from, 1)[0]);
    keys.current = nextKeys;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };

  const removeAt = (index: number) => {
    keys.current = keys.current.filter((_, i) => i !== index);
    onChange(items.filter((_, i) => i !== index));
  };

  const ids = keys.current.slice(0, items.length);
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
        {items.map((item, index) => (
          <SortableRow key={ids[index]} id={ids[index]} index={index} onRemove={() => removeAt(index)}>
            {(controls) => renderItem(item, controls)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  onRemove,
  children,
}: {
  id: string;
  index: number;
  onRemove: () => void;
  children: (controls: SortableControls) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <>
      {children({
        itemProps: { ref: setNodeRef, style, 'data-dragging': isDragging || undefined },
        handleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef },
        isDragging,
        remove: onRemove,
        index,
      })}
    </>
  );
}

/** Poignée de déplacement : cible tactile de 36 px, sans défilement parasite. */
export function DragHandle({ label, className, ...props }: { label: string; className?: string } & Record<string, unknown>) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Glisser pour déplacer"
      data-drag-handle=""
      {...props}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground active:cursor-grabbing',
        className,
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
