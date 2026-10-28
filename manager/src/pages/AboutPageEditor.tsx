import * as React from 'react';
import { ArrowDown, ArrowUp, Eye, ImagePlus, Monitor, Plus, Quote, Smartphone, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Company } from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Switch, Textarea } from '@/components/ui/primitives';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { VitrineThemeScope } from '@/components/VitrineThemeScope';
import { AboutContent } from '@vitrine/components/about/AboutContent';

/**
 * PAGE « À PROPOS » — l'histoire de la fondatrice, en blocs simples :
 *
 *   1. l'en-tête : portrait, titre, phrase d'accroche ;
 *   2. les sections : un petit sur-titre, un titre, un texte (et une image si
 *      l'on veut) — on en ajoute, on les déplace, on les retire ;
 *   3. les valeurs : trois mots, une phrase chacun ;
 *   4. la citation.
 *
 * L'aperçu à droite est la VRAIE page de la vitrine (même composant), en
 * téléphone ou en ordinateur : ce qu'on voit est ce qui sera publié.
 */
type AboutPage = NonNullable<Company['aboutPage']>;
type Section = AboutPage['sections'][number];

const EMPTY: AboutPage = { enabled: true, eyebrow: 'À propos', title: '', intro: '', image: '', imageMedia: null, sections: [], values: [], quote: '' };
const MAX_SECTIONS = 10;
const MAX_VALUES = 4;

export default function AboutPageEditor() {
  const { data, loading, setData } = useResource(() => api.getCompany());
  const { run } = useAction();
  // Images tout juste importées : leur adresse d'aperçu, avant enregistrement.
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    const updated = await run(() => api.updateCompany(data), { success: 'Page À propos enregistrée' });
    setData(updated);
    return updated;
  });

  if (loading || !data) return <BrandLoader variant="form" />;

  const page: AboutPage = { ...EMPTY, ...(data.aboutPage ?? {}) };
  const set = (patch: Partial<AboutPage>) => setData({ ...data, aboutPage: { ...page, ...patch } });
  const setSection = (i: number, patch: Partial<Section>) => set({ sections: page.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = <T,>(list: T[], i: number, delta: number) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(i + delta, 0, x); return next; };
  const preview = (path?: string) => (path ? previews[path] || resolvePreviewMediaUrl(path) : '');
  const remember = (path: string, url?: string) => { if (path && url) setPreviews((p) => ({ ...p, [path]: url })); };

  const view = {
    ...page,
    image: preview(page.image),
    sections: page.sections.map((s) => ({ ...s, image: preview(s.image) })),
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="Page À propos"
        description="Votre histoire, sur une page dédiée du site (/a-propos). Remplissez les blocs : l'aperçu (à droite sur ordinateur, en bas sur téléphone) montre la page telle qu'elle sera publiée."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="grid content-start gap-6">
          {/* 1. En-tête */}
          <Card data-testid="about-editor-header">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="inline-flex items-center gap-2"><UserRound className="h-5 w-5 text-muted-foreground" /> 1. En-tête</CardTitle>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Switch checked={page.enabled !== false} onChange={(v) => set({ enabled: v })} label="Page publiée" /> Page publiée
                </label>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Le haut de la page : un portrait, votre titre et une phrase qui vous présente.</p>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
              <div className="mx-auto w-full min-w-0 max-w-[180px]">
                <ImageUpload
                  value={page.image ?? ''}
                  previewUrl={preview(page.image) || null}
                  mediaType="team-photo"
                  aspect="aspect-[4/5]"
                  hint="Portrait vertical."
                  onChange={(url, descriptor, p) => { remember(url, p); set({ image: url, imageMedia: descriptor }); }}
                />
              </div>
              <div className="grid content-start gap-4">
                <Field label="Petit sur-titre"><Input value={page.eyebrow ?? ''} onChange={(e) => set({ eyebrow: e.target.value })} placeholder="À propos" /></Field>
                <Field label="Titre"><Input value={page.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Moi, c’est Romane" data-testid="about-editor-title" /></Field>
                <Field label="Phrase d'accroche"><Textarea rows={2} value={page.intro ?? ''} onChange={(e) => set({ intro: e.target.value })} placeholder="Professionnelle de la beauté et formatrice spécialisée dans le regard, basée à Nice." /></Field>
              </div>
            </CardContent>
          </Card>

          {/* 2. Sections */}
          <Card data-testid="about-editor-sections">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="inline-flex items-center gap-2"><Sparkles className="h-5 w-5 text-muted-foreground" /> 2. Votre histoire, en sections</CardTitle>
                <Button type="button" variant="outline" disabled={page.sections.length >= MAX_SECTIONS} onClick={() => set({ sections: [...page.sections, { eyebrow: '', title: '', text: '', image: '', imageMedia: null }] })} data-testid="about-section-add">
                  <Plus className="h-4 w-4" /> Section
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Une idée par section : votre parcours, votre approche, ce que vous transmettez… Laissez une ligne vide entre deux paragraphes.</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              {page.sections.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucune section : ajoutez la première avec « + Section ».</p>}
              {page.sections.map((s, i) => (
                <SectionCard
                  key={s._id || `new-${i}`}
                  index={i}
                  count={page.sections.length}
                  section={s}
                  previewUrl={preview(s.image)}
                  onChange={(patch) => setSection(i, patch)}
                  onImage={(url, descriptor, p) => { remember(url, p); setSection(i, { image: url, imageMedia: descriptor }); }}
                  onMove={(delta) => set({ sections: move(page.sections, i, delta) })}
                  onRemove={() => set({ sections: page.sections.filter((_, j) => j !== i) })}
                />
              ))}
            </CardContent>
          </Card>

          {/* 3. Valeurs */}
          <Card data-testid="about-editor-values">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>3. Vos valeurs</CardTitle>
                <Button type="button" variant="outline" disabled={page.values.length >= MAX_VALUES} onClick={() => set({ values: [...page.values, { title: '', text: '' }] })} data-testid="about-value-add">
                  <Plus className="h-4 w-4" /> Valeur
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Trois mots qui vous ressemblent, chacun avec une courte phrase. Affichés côte à côte sous l'histoire.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {page.values.map((v, i) => (
                <div key={v._id || `v-${i}`} className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,0.35fr)_minmax(0,1fr)_auto] sm:items-center" data-testid="about-value-row">
                  <Input value={v.title ?? ''} onChange={(e) => set({ values: page.values.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder="Naturel" aria-label={`Valeur ${i + 1}`} />
                  <Input value={v.text ?? ''} onChange={(e) => set({ values: page.values.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="Une phrase qui l'explique" aria-label={`Explication de la valeur ${i + 1}`} />
                  <button type="button" onClick={() => set({ values: page.values.filter((_, j) => j !== i) })} className="grid h-9 w-9 place-items-center justify-self-end rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700" aria-label={`Retirer la valeur ${i + 1}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {page.values.length === 0 && <p className="text-sm text-muted-foreground">Aucune valeur : la bande disparaît de la page.</p>}
            </CardContent>
          </Card>

          {/* 4. Citation */}
          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2"><Quote className="h-5 w-5 text-muted-foreground" /> 4. Citation</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Une phrase qui vous résume, mise en valeur sous l'en-tête. Facultative.</p>
            </CardHeader>
            <CardContent>
              <Textarea rows={2} value={page.quote ?? ''} onChange={(e) => set({ quote: e.target.value })} placeholder="La beauté n’a pas besoin d’en faire trop pour révéler tout son potentiel." data-testid="about-editor-quote" />
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <LivePreview page={view} published={page.enabled !== false} />
        </div>
      </div>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

function SectionCard({ index, count, section, previewUrl, onChange, onImage, onMove, onRemove }: {
  index: number;
  count: number;
  section: Section;
  previewUrl: string;
  onChange: (patch: Partial<Section>) => void;
  onImage: (url: string, descriptor: Section['imageMedia'], preview?: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [withImage, setWithImage] = React.useState(Boolean(section.image));
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4" data-testid="about-section-card">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{String(index + 1).padStart(2, '0')}</span>
        <Input className="h-9" value={section.eyebrow ?? ''} onChange={(e) => onChange({ eyebrow: e.target.value })} placeholder="Petit sur-titre (ex. Mon approche)" aria-label={`Sur-titre de la section ${index + 1}`} />
        <div className="ml-auto flex shrink-0 gap-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="grid h-9 w-9 place-items-center rounded-md border disabled:opacity-30" aria-label="Monter la section"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="grid h-9 w-9 place-items-center rounded-md border disabled:opacity-30" aria-label="Descendre la section"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onRemove} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-700" aria-label={`Supprimer la section ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <Input value={section.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Titre de la section" className="font-semibold" aria-label={`Titre de la section ${index + 1}`} data-testid="about-section-title" />
      {/* Le champ s'agrandit avec le texte : on relit sa section en entier, sans ascenseur. */}
      <Textarea rows={Math.max(4, Math.ceil((section.text ?? '').length / 62) + (section.text ?? '').split('\n').length)} value={section.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Le texte de la section…" aria-label={`Texte de la section ${index + 1}`} />
      {withImage ? (
        <div className="grid gap-2">
          <div className="max-w-sm">
            <ImageUpload value={section.image ?? ''} previewUrl={previewUrl || null} mediaType="page-image" aspect="aspect-[16/10]" onChange={(url, descriptor, p) => onImage(url, descriptor, p)} />
          </div>
          <button type="button" onClick={() => { onImage('', null); setWithImage(false); }} className="inline-flex items-center gap-1 justify-self-start text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Retirer l'image</button>
        </div>
      ) : (
        <button type="button" onClick={() => setWithImage(true)} className="inline-flex items-center gap-1.5 justify-self-start text-sm text-muted-foreground hover:text-foreground"><ImagePlus className="h-4 w-4" /> Ajouter une image (facultatif)</button>
      )}
    </div>
  );
}

/**
 * L'APERÇU — la page de la vitrine, réduite. Téléphone : 390 px réels, pour
 * juger des tailles de texte. Ordinateur : 1200 px réduits à la largeur du
 * panneau (même principe que l'aperçu de la bannière d'accueil).
 */
function LivePreview({ page, published }: { page: Parameters<typeof AboutContent>[0]['page']; published: boolean }) {
  const [device, setDevice] = React.useState<'phone' | 'desktop'>('phone');
  const frame = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [height, setHeight] = React.useState(0);
  const width = device === 'phone' ? 390 : 1200;
  React.useEffect(() => {
    const measure = () => {
      if (!frame.current || !inner.current) return;
      const s = Math.min(1, frame.current.clientWidth / width);
      setScale(s);
      setHeight(inner.current.scrollHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div className="grid gap-2" data-testid="about-preview">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Aperçu en direct {!published && <span className="rounded bg-amber-100 px-1.5 py-0.5 normal-case tracking-normal text-amber-800">non publiée</span>}</p>
        <div className="flex rounded-md border p-0.5">
          <button type="button" onClick={() => setDevice('phone')} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${device === 'phone' ? 'bg-muted font-semibold' : 'text-muted-foreground'}`} data-testid="about-preview-phone"><Smartphone className="h-3.5 w-3.5" /> Téléphone</button>
          <button type="button" onClick={() => setDevice('desktop')} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${device === 'desktop' ? 'bg-muted font-semibold' : 'text-muted-foreground'}`} data-testid="about-preview-desktop"><Monitor className="h-3.5 w-3.5" /> Ordinateur</button>
        </div>
      </div>
      <div ref={frame} className={`overflow-hidden rounded-xl border bg-card ${device === 'phone' ? 'mx-auto w-full max-w-[390px]' : 'w-full'}`}>
        <div className="max-h-[78vh] overflow-y-auto overflow-x-hidden">
          <div style={{ height: height || undefined }}>
            <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <VitrineThemeScope>
                <div className="py-6" style={{ background: 'var(--v-background)', color: 'var(--v-foreground)' }}>
                  <AboutContent page={page} />
                </div>
              </VitrineThemeScope>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
