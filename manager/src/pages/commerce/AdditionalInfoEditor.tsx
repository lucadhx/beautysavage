import { Info, Plus, Trash2 } from 'lucide-react';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { Button, Textarea } from '@/components/ui/primitives';
import { ToneSection } from './editorTones';

/** Autant que la vitrine en affiche : au-delà, le bloc devient une notice. */
export const MAX_ADDITIONAL_INFO = 12;

/**
 * LES INFORMATIONS COMPLÉMENTAIRES — « Bon à savoir », sous la description.
 *
 * Sur la vitrine, la description complète ouvre le bloc sombre de la fiche ;
 * chaque information complémentaire vient dessous, précédée d'un petit losange
 * champagne. Une ligne = une information courte (manucure comprise, finitions
 * au choix, ce qui n'est pas réalisé…). On en ajoute, on en retire, on les
 * réordonne à la poignée — à la souris comme au doigt.
 */
export function AdditionalInfoEditor({
  value,
  onChange,
  subject = 'la prestation',
}: {
  value?: string[];
  onChange: (lines: string[]) => void;
  subject?: string;
}) {
  const lines = Array.isArray(value) ? value : [];
  const set = (index: number, text: string) => {
    const next = [...lines];
    next[index] = text;
    onChange(next);
  };
  const plein = lines.length >= MAX_ADDITIONAL_INFO;

  return (
    <ToneSection
      tone="faq"
      level="nested"
      icon={<Info className="h-5 w-5" />}
      title="Bon à savoir"
      description={`Affiché dans « Bon à savoir », sous la description de ${subject} : à noter, conditions, paiement en plusieurs fois…  Une information par ligne ; faites glisser la poignée pour changer l'ordre.`}
      actions={
        <Button variant="outline" disabled={plein} onClick={() => onChange([...lines, ''])} data-testid="additional-info-add">
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      }
    >
      {lines.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Rien pour l’instant. Exemples : « Ne comprend pas le travail des callosités. », « Paiement en 3 fois sans frais avec Klarna. »
        </p>
      )}
      <div className="grid gap-2">
        <SortableList
          items={lines}
          onChange={onChange}
          renderItem={(line, { itemProps, handleProps, remove, index }) => (
            <div {...itemProps} className="flex items-start gap-1.5 rounded-lg border bg-card p-1.5 sm:gap-2 sm:p-2" data-testid="additional-info-row">
              <DragHandle label={`Déplacer l'information ${index + 1}`} {...handleProps} />
              <Textarea
                value={line}
                rows={2}
                maxLength={400}
                placeholder="Ex : « Paiement en 3 fois sans frais avec Klarna. »"
                aria-label={`Information complémentaire ${index + 1}`}
                // Le champ grandit avec son texte : rien n'est coupé, même sur un écran étroit.
                className="min-h-[3.5rem] min-w-0 flex-1 resize-y [field-sizing:content]"
                onChange={(e) => set(index, e.target.value)}
              />
              <Button size="sm" variant="ghost" onClick={remove} aria-label={`Retirer l'information ${index + 1}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        />
      </div>
      {plein && <p className="text-xs text-muted-foreground">{MAX_ADDITIONAL_INFO} informations au maximum.</p>}
    </ToneSection>
  );
}
