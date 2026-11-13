import * as React from 'react';
import { Award, BookOpen, Clock, Coffee, GraduationCap, Infinity as InfinityIcon, ListChecks, MessageCircle, Package, Phone, PlayCircle, Plus, RefreshCw, Sparkles, Target, Trash2, UserRound } from 'lucide-react';
import { DragHandle, SortableList } from '@/components/ui/Sortable';
import { Button, Field, Input } from '@/components/ui/primitives';
import { ToneSection } from './editorTones';

/**
 * PROGRAMME & CONTENU — ce que la description mélangeait, rangé pour être mis
 * en page sur la vitrine (chiffres clés, programme, « ta formation comprend »).
 * Le serveur borne et nettoie tout (productExtras.normalizeTraining).
 */

export type ProgramSection = { title: string; items: string[] };
export type IncludeItem = { icon: string; label: string };

export const INCLUDE_ICONS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  livret: { label: 'Livret', Icon: BookOpen },
  certificat: { label: 'Certificat', Icon: Award },
  suivi: { label: 'Suivi / WhatsApp', Icon: MessageCircle },
  video: { label: 'Vidéos', Icon: PlayCircle },
  acces: { label: 'Accès à vie', Icon: InfinityIcon },
  maj: { label: 'Mises à jour', Icon: RefreshCw },
  appel: { label: 'Rendez-vous téléphonique', Icon: Phone },
  kit: { label: 'Kit / matériel', Icon: Package },
  pause: { label: 'Petit-déjeuner / pause', Icon: Coffee },
  etoile: { label: 'Autre', Icon: Sparkles },
};

/** Ajouts en un clic : les éléments que l'institut propose le plus souvent. */
const QUICK_INCLUDES: IncludeItem[] = [
  { icon: 'livret', label: 'Livret de formation PDF' },
  { icon: 'certificat', label: 'Certificat de formation' },
  { icon: 'suivi', label: 'Suivi post-formation via WhatsApp' },
  { icon: 'acces', label: 'Accès à vie à ton espace de formation' },
  { icon: 'video', label: 'Vidéos accessibles 24h/24, à ton rythme' },
  { icon: 'pause', label: 'Petit-déjeuner offert' },
];

const FORMATS = ['Coaching individuel', 'Formation en ligne', 'En petit groupe'];
const LEVELS = ['Débutant', 'Débutant à professionnel', 'Professionnel déjà formé'];

export function defaultDurationLabel(days?: unknown) {
  const n = Number(days || 0);
  if (!n) return '';
  return n === 1 ? '1 journée' : `${n} jours`;
}

function Suggestions({ values, onPick }: { values: string[]; onPick: (v: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button key={v} type="button" onClick={() => onPick(v)} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">{v}</button>
      ))}
    </div>
  );
}

export function TrainingDetailsEditor({
  training,
  distanciel,
  onPatch,
}: {
  training: Record<string, unknown>;
  distanciel: boolean;
  onPatch: (key: string, value: unknown) => void;
}) {
  const program = (Array.isArray(training.program) ? training.program : []) as ProgramSection[];
  const includes = (Array.isArray(training.includes) ? training.includes : []) as IncludeItem[];
  const text = (key: string) => String(training[key] ?? '');
  const setProgram = (next: ProgramSection[]) => onPatch('program', next);
  const setSection = (index: number, patch: Partial<ProgramSection>) => setProgram(program.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const setIncludes = (next: IncludeItem[]) => onPatch('includes', next);
  const autoDuration = distanciel ? 'À ton rythme' : defaultDurationLabel(training.durationDays);

  return (
    <div className="grid gap-5">
      <ToneSection tone="infos" level="nested" icon={<Target className="h-5 w-5" />} title="Chiffres clés" description="Affichés en tête de la fiche, en pastilles compactes. Laissez vide pour masquer.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Format" icon={<UserRound />}>
            <Input value={text('format')} maxLength={80} placeholder="Ex : Coaching individuel" onChange={(e) => onPatch('format', e.target.value)} data-testid="training-format" />
            <Suggestions values={FORMATS} onPick={(v) => onPatch('format', v)} />
          </Field>
          <Field label="Durée affichée" icon={<Clock />} hint={autoDuration ? `Vide = « ${autoDuration} » (calculé).` : 'Ex : 1 journée + ½ journée'}>
            <Input value={text('durationLabel')} maxLength={80} placeholder={autoDuration || 'Ex : ½ journée'} onChange={(e) => onPatch('durationLabel', e.target.value)} data-testid="training-duration-label" />
          </Field>
          <Field label="Niveau" icon={<GraduationCap />}>
            <Input value={text('level')} maxLength={80} placeholder="Ex : Débutant à professionnel" onChange={(e) => onPatch('level', e.target.value)} data-testid="training-level" />
            <Suggestions values={LEVELS} onPick={(v) => onPatch('level', v)} />
          </Field>
          <Field label="Prérequis" icon={<ListChecks />} hint="Vide = « Aucun prérequis ».">
            <Input value={text('prerequisites')} maxLength={200} placeholder="Ex : Avoir déjà été formée aux extensions de cils" onChange={(e) => onPatch('prerequisites', e.target.value)} data-testid="training-prerequisites" />
          </Field>
        </div>
      </ToneSection>

      <ToneSection
        tone="modules"
        level="nested"
        icon={<ListChecks className="h-5 w-5" />}
        title="Programme"
        description="Une partie par technique (ex : « Cil à cil », « Volume russe préfait »), ou une seule partie sans titre pour une liste simple. Un point = une ligne courte."
        actions={<Button variant="outline" onClick={() => setProgram([...program, { title: '', items: [''] }])} data-testid="program-add-section"><Plus className="h-4 w-4" /> Partie</Button>}
      >
        {program.length === 0 && (
          <button type="button" onClick={() => setProgram([{ title: '', items: [''] }])} className="w-full rounded-md border border-dashed p-4 text-left text-sm text-muted-foreground hover:bg-muted/40">
            Aucun programme. <span className="font-medium text-foreground">Commencer le programme</span> — ex : « Théorie & compréhension de la technique », « Pratique sur modèle »…
          </button>
        )}
        <div className="grid gap-3">
          <SortableList
            items={program}
            onChange={setProgram}
            renderItem={(section, { itemProps, handleProps, remove, index }) => (
              <div {...itemProps} className="rounded-lg border bg-card p-2.5 sm:p-3" data-testid="program-section">
                <div className="flex items-center gap-2">
                  <DragHandle label={`Déplacer la partie ${index + 1}`} {...handleProps} />
                  <Input value={section.title} maxLength={80} placeholder={program.length > 1 ? `Titre de la partie ${index + 1} (ex : Cil à cil)` : 'Titre de la partie (facultatif)'} onChange={(e) => setSection(index, { title: e.target.value })} className="font-medium" data-testid="program-section-title" />
                  <Button size="sm" variant="ghost" onClick={remove} aria-label={`Retirer la partie ${index + 1}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="mt-2 grid gap-1.5 pl-7">
                  <SortableList
                    items={section.items}
                    onChange={(items) => setSection(index, { items })}
                    renderItem={(item, row) => (
                      <div {...row.itemProps} className="flex items-center gap-1.5">
                        <DragHandle label={`Déplacer le point ${row.index + 1}`} {...row.handleProps} />
                        <span className="text-xs tabular-nums text-muted-foreground">{String(row.index + 1).padStart(2, '0')}</span>
                        <Input value={item} maxLength={200} placeholder="Ex : Pratique sur modèle" onChange={(e) => setSection(index, { items: section.items.map((it, i) => (i === row.index ? e.target.value : it)) })} data-testid="program-item" />
                        <Button size="sm" variant="ghost" onClick={row.remove} aria-label={`Retirer le point ${row.index + 1}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  />
                  <button type="button" onClick={() => setSection(index, { items: [...section.items, ''] })} className="inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5" data-testid="program-add-item">
                    <Plus className="h-3.5 w-3.5" /> Ajouter un point
                  </button>
                </div>
              </div>
            )}
          />
        </div>
      </ToneSection>

      <ToneSection
        tone="evaluation"
        level="nested"
        icon={<Award className="h-5 w-5" />}
        title={distanciel ? 'Ta formation comprend' : 'La formation comprend'}
        description="Chaque élément avec son pictogramme : livret, certificat, suivi… Affichés en grille sur la fiche."
      >
        <div className="flex flex-wrap gap-1.5">
          {QUICK_INCLUDES.filter((q) => !includes.some((i) => i.label === q.label)).map((q) => {
            const Icon = INCLUDE_ICONS[q.icon].Icon;
            return (
              <button key={q.label} type="button" onClick={() => setIncludes([...includes, q])} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted" data-testid="include-quick">
                <Plus className="h-3 w-3" /><Icon className="h-3.5 w-3.5" /> {q.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-2">
          <SortableList
            items={includes}
            onChange={setIncludes}
            renderItem={(item, { itemProps, handleProps, remove, index }) => (
              <div {...itemProps} className="flex items-center gap-1.5 rounded-lg border bg-card p-1.5 sm:gap-2 sm:p-2" data-testid="include-row">
                <DragHandle label={`Déplacer l'élément ${index + 1}`} {...handleProps} />
                <IconPicker value={item.icon} onChange={(icon) => setIncludes(includes.map((x, i) => (i === index ? { ...x, icon } : x)))} />
                <Input value={item.label} maxLength={200} placeholder="Ex : Certificat de formation" onChange={(e) => setIncludes(includes.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)))} data-testid="include-label" />
                <Button size="sm" variant="ghost" onClick={remove} aria-label={`Retirer l'élément ${index + 1}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          />
          <Button variant="outline" className="w-fit" onClick={() => setIncludes([...includes, { icon: 'etoile', label: '' }])} data-testid="include-add"><Plus className="h-4 w-4" /> Autre élément</Button>
        </div>
      </ToneSection>
    </div>
  );
}

/** Le pictogramme d'un élément : une rangée de boutons, sans liste déroulante (utilisable au doigt). */
function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const current = INCLUDE_ICONS[value] || INCLUDE_ICONS.etoile;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-9 w-9 place-items-center rounded-md border bg-background" aria-label={`Pictogramme : ${current.label}`} title={current.label} data-testid="include-icon">
        <current.Icon className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 grid w-56 grid-cols-5 gap-1 rounded-lg border bg-popover p-1.5 shadow-lg">
          {Object.entries(INCLUDE_ICONS).map(([key, { label, Icon }]) => (
            <button key={key} type="button" onClick={() => { onChange(key); setOpen(false); }} className={`grid h-9 place-items-center rounded-md ${key === value ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`} aria-label={label} title={label}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
