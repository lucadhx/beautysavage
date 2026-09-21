import * as React from 'react';
import {
  Bold, Eraser, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Underline,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialog';
import { Button, Field, Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

const ToolButton = ({
  icon: Icon,
  title,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
  active?: boolean;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onMouseDown={(event) => {
      event.preventDefault();
      onClick();
    }}
    className={cn(
      'rounded p-1.5 transition-colors',
      active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )}
  >
    <Icon className="h-4 w-4" />
  </button>
);

export function RichTextEditor({ value, onChange, placeholder, className, minHeight = '10rem' }: Props) {
  const zone = React.useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = React.useState(!value);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkValue, setLinkValue] = React.useState('');
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const el = zone.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
    setEmpty(!el.textContent?.trim() && !el.querySelector('img'));
  }, [value]);

  const emit = () => {
    const el = zone.current;
    if (!el) return;
    setEmpty(!el.textContent?.trim());
    onChange(el.innerHTML);
  };

  const command = (name: string, argument?: string) => {
    zone.current?.focus();
    document.execCommand(name, false, argument);
    emit();
    forceRender();
  };

  const active = (name: string) => {
    try {
      return document.queryCommandState(name);
    } catch {
      return false;
    }
  };

  const applyLink = () => {
    if (linkValue.trim()) command('createLink', linkValue.trim());
    else command('unlink');
    setLinkOpen(false);
  };

  return (
    <>
      <div className={cn('overflow-hidden rounded-md border border-border bg-background', className)}>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
          <ToolButton icon={Bold} title="Gras" onClick={() => command('bold')} active={active('bold')} />
          <ToolButton icon={Italic} title="Italique" onClick={() => command('italic')} active={active('italic')} />
          <ToolButton icon={Underline} title="Souligner" onClick={() => command('underline')} active={active('underline')} />
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton icon={Heading2} title="Titre" onClick={() => command('formatBlock', 'h2')} />
          <ToolButton icon={Heading3} title="Sous-titre" onClick={() => command('formatBlock', 'h3')} />
          <ToolButton icon={Quote} title="Citation" onClick={() => command('formatBlock', 'blockquote')} />
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton icon={List} title="Liste a puces" onClick={() => command('insertUnorderedList')} active={active('insertUnorderedList')} />
          <ToolButton icon={ListOrdered} title="Liste numerotee" onClick={() => command('insertOrderedList')} active={active('insertOrderedList')} />
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton
            icon={Link2}
            title="Lien"
            onClick={() => {
              setLinkValue('');
              setLinkOpen(true);
            }}
          />
          <ToolButton icon={Eraser} title="Retirer la mise en forme" onClick={() => command('removeFormat')} />
        </div>

        <div className="relative">
          {empty && placeholder && (
            <p className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">{placeholder}</p>
          )}
          <div
            ref={zone}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Contenu de la page"
            onInput={emit}
            onBlur={emit}
            onKeyUp={forceRender}
            onMouseUp={forceRender}
            onPaste={(event) => {
              event.preventDefault();
              const text = event.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text);
              emit();
            }}
            className="m-editor px-3 py-3 text-sm outline-none"
            style={{ minHeight }}
          />
        </div>
      </div>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Ajouter un lien" className="max-w-md">
        <div className="grid gap-4">
          <Field label="Adresse du lien">
            <Input value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://... ou /contact" />
          </Field>
          <p className="text-xs text-muted-foreground">Laissez vide pour retirer le lien sur la selection.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Annuler</Button>
            <Button onClick={applyLink}>Appliquer</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
