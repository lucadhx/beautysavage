import * as React from 'react';
import { AlignLeft, ArrowLeft, Clock, Euro, Plus, Tag, Trash2 } from 'lucide-react';
import { Button, Field, Input, Switch, Textarea } from '@/components/ui/primitives';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { cents } from './CommerceShared';
import { ToneSection } from './editorTones';

type OptionRow = Record<string, unknown>;

/**
 * LES OPTIONS D'UNE FICHE — un tableau, comme partout ailleurs, et une page
 * d'édition par option.
 *
 * Les options s'éditaient dans une pile de formulaires ouverts les uns sous
 * les autres : impossible de voir d'un coup d'œil ce qui est vendu, à quel
 * prix, ni ce qui est désactivé. Le tableau répond à ça ; chaque ligne a ses
 * actions, et « Modifier » ouvre la page propre de l'option.
 */
export function OptionsManager({
  rows,
  onChange,
  subject,
  withDuration = false,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
  /** « la formation » / « la prestation » — pour les textes. */
  subject: string;
  /**
   * Prestations : une option peut allonger le rendez-vous (French, chrome…).
   * Le temps saisi s'ajoute au créneau réservé au planning, et la cliente
   * choisit ses options AVANT l'heure, pour que l'heure tienne compte de tout.
   */
  withDuration?: boolean;
}) {
  const [editing, setEditing] = React.useState<number | null>(null);
  const update = (index: number, patch: OptionRow) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
    setEditing(null);
  };
  const add = () => {
    onChange([...rows, { label: `Option ${rows.length + 1}`, description: '', priceCents: 0, ...(withDuration ? { extraMinutes: 0 } : {}), active: true }]);
    setEditing(rows.length);
  };

  const current = editing === null ? null : rows[editing];
  if (current && editing !== null) {
    return (
      <section className="grid gap-4" data-testid="option-editor">
        <nav className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <button type="button" onClick={() => setEditing(null)} className="font-medium text-primary hover:underline">Options</button>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold">{String(current.label || `Option ${editing + 1}`)}</span>
        </nav>
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setEditing(null)}><ArrowLeft className="h-4 w-4" /> Retour aux options</Button>
        <ToneSection
          tone="options"
          title={String(current.label || `Option ${editing + 1}`)}
          description={`Supplément proposé avec ${subject}, au moment de l'achat.`}
          actions={<Switch checked={current.active !== false} onChange={(active) => update(editing, { active })} label="Option active" />}
        >
          <div className="grid gap-4 md:grid-cols-[1fr_200px]">
            <Field label="Nom de l'option" icon={<Tag />}>
              <Input className="h-12 text-base font-semibold" value={String(current.label ?? '')} onChange={(e) => update(editing, { label: e.target.value })} placeholder="Kit de démarrage, courbure M…" />
            </Field>
            <Field label="Prix" unit="€ TTC" icon={<Euro />}>
              <div className="flex h-12 items-center rounded-md border bg-background px-3">
                <Input type="number" min="0" step="0.01" value={Number(current.priceCents || 0) / 100} onChange={(e) => update(editing, { priceCents: Math.round(Number(e.target.value || 0) * 100) })} className="h-10 border-0 px-0 text-base focus-visible:ring-0" />
                <Euro className="h-4 w-4 text-muted-foreground" />
              </div>
            </Field>
            {withDuration && (
              <Field label="Temps en plus" unit="minutes" icon={<Clock />} className="md:col-span-2" hint="Ajouté à la durée du rendez-vous quand la cliente coche cette option. 0 : l'option ne prend pas de temps.">
                <Input type="number" min="0" step="5" data-testid="option-extra-minutes" value={Number(current.extraMinutes || 0)} onChange={(e) => update(editing, { extraMinutes: Math.max(0, Math.round(Number(e.target.value || 0))) })} />
              </Field>
            )}
            <Field label="Description visible par la cliente" icon={<AlignLeft />} className="md:col-span-2">
              <Textarea className="min-h-28" value={String(current.description ?? '')} onChange={(e) => update(editing, { description: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="destructive" onClick={() => remove(editing)}><Trash2 className="h-4 w-4" /> Supprimer cette option</Button>
          </div>
        </ToneSection>
      </section>
    );
  }

  return (
    <ToneSection
      tone="options"
      title="Options"
      description={`Suppléments proposés avec ${subject}. La clé technique est générée automatiquement.`}
      actions={<Button type="button" variant="outline" onClick={add}><Plus className="h-4 w-4" /> Ajouter une option</Button>}
    >
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">Aucune option pour le moment.</p>
      ) : (
        <div className="m-table max-w-full overflow-x-auto rounded-lg border bg-card" data-testid="options-table">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Option</th><th className="px-4 py-3">Prix</th>{withDuration && <th className="px-4 py-3">Temps</th>}<th className="m-hide px-4 py-3">État</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{String(row.label || `Option ${index + 1}`)}</div>
                    {Boolean(row.description) && <div className="max-w-md truncate text-xs text-muted-foreground">{String(row.description)}</div>}
                    {row.active === false && <div className="mt-1 text-xs font-medium text-slate-500 sm:hidden">Désactivée</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">+ {cents(Number(row.priceCents || 0))}</td>
                  {withDuration && <td className="whitespace-nowrap px-4 py-3">{Number(row.extraMinutes || 0) > 0 ? `+ ${Number(row.extraMinutes)} min` : '—'}</td>}
                  <td className="m-hide px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${row.active === false ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-emerald-300 bg-emerald-100 text-emerald-900'}`}>
                      {row.active === false ? 'Désactivée' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Dropdown.Root>
                      <Dropdown.DotsButton aria-label={`Actions option ${index + 1}`} />
                      <Dropdown.Popover className="w-52">
                        <Dropdown.Menu>
                          <Dropdown.Section>
                            <Dropdown.Item onAction={() => setEditing(index)}>Modifier</Dropdown.Item>
                            <Dropdown.Item onAction={() => update(index, { active: row.active === false })}>{row.active === false ? 'Activer' : 'Désactiver'}</Dropdown.Item>
                            <Dropdown.Item onAction={() => onChange([...rows.slice(0, index + 1), { ...row, key: undefined, label: `${String(row.label || 'Option')} (copie)` }, ...rows.slice(index + 1)])}>Dupliquer</Dropdown.Item>
                            <Dropdown.Item destructive onAction={() => remove(index)}>Supprimer</Dropdown.Item>
                          </Dropdown.Section>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ToneSection>
  );
}
