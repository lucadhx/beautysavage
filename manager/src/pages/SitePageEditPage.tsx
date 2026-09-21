import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { arrayMove } from '@dnd-kit/sortable';
import {
  ArrowLeft, Plus, Trash2, Eye, EyeOff, X, ChevronUp, ChevronDown,
  Type, AlignLeft, Image as ImageIcon, Columns2, Hash, Sparkles, Quote as QuoteIcon,
  MousePointerClick, GalleryHorizontal, Info, Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import type {
  SitePage, SitePageBlock, SitePageBlockType, SitePageBlockItem, SitePageImage,
} from '@/types';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card, CardContent, Input, Textarea, Field, Button, Switch, SegmentedControl,
} from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { SITE_PAGE_LIMITS, limiteAtteinte } from '@/config/limits';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { IconPicker } from '@/components/fields/IconPicker';
import { RichTextEditor } from '@/components/fields/RichTextEditor';

/**
 * LA FICHE D'UNE PAGE ÉDITORIALE — une PAGE, plus une fenêtre modale.
 *
 * ══ CE QUE LA MODALE COÛTAIT ═══════════════════════════════════════════════
 *
 * C'est le dernier écran de la section « Le circuit » à l'avoir gardée, et
 * c'était le pire endroit pour elle : une page éditoriale porte un en-tête,
 * une image, un référencement, deux interrupteurs de publication et une SUITE
 * DE BLOCS — dont chacun est lui-même un formulaire, avec ses propres champs,
 * ses uploads et ses listes ordonnées. Une page de dix blocs, c'est dix
 * formulaires empilés dans une fenêtre posée sur une page qui défile déjà.
 *
 * Trois défauts, les mêmes que pour les karts, les tracés et les épreuves :
 *
 *   · DEUX DÉFILEMENTS l'un dans l'autre — on ne sait plus lequel on manipule,
 *     et la molette agit sur celui que le navigateur choisit ;
 *   · « ENREGISTRER » vit en bas de la fenêtre, à vingt écrans du bloc qu'on
 *     vient de corriger ;
 *   · la page N'A PAS D'ADRESSE. Corriger un paragraphe, c'est rouvrir la
 *     liste, retrouver la ligne, rouvrir la fenêtre, redescendre.
 *
 * Elle a maintenant une adresse (`/pages/:id`), un seul défilement, et le dock
 * d'enregistrement flottant que les trois autres fiches utilisent déjà.
 *
 * ══ LE CONTENU EST RELU, PAS REPRIS DE LA LISTE ════════════════════════════
 *
 * `api.getPage(id)` plutôt que la ligne déjà chargée par l'écran précédent :
 * la liste sert à choisir, et rien ne garantit qu'elle porte les blocs — le
 * bootstrap public, lui, les retire explicitement pour ne pas peser. Une fiche
 * qui édite ce qu'on lui a passé publierait un jour une page vidée de son
 * contenu.
 */

const TYPES: {
  value: SitePageBlockType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  aide: string;
}[] = [
  { value: 'HEADING', label: 'Titre de section', icon: Type, aide: 'Ouvre une section. Sur-titre, titre, sous-titre.' },
  { value: 'RICH_TEXT', label: 'Texte', icon: AlignLeft, aide: 'Paragraphes, listes, liens. La colonne de lecture est calibrée.' },
  { value: 'IMAGE', label: 'Image', icon: ImageIcon, aide: 'Une image seule, avec légende.' },
  { value: 'IMAGE_TEXT', label: 'Image + texte', icon: Columns2, aide: 'Deux colonnes ; alternez le côté d’un bloc à l’autre.' },
  { value: 'STATS', label: 'Chiffres clés', icon: Hash, aide: 'Une grille de chiffres — « 730 m », « 3 tracés ».' },
  { value: 'FEATURES', label: 'Atouts', icon: Sparkles, aide: 'Une grille icône + titre + texte.' },
  { value: 'QUOTE', label: 'Citation', icon: QuoteIcon, aide: 'Une phrase mise en avant, et son auteur.' },
  { value: 'CTA', label: 'Appel à l’action', icon: MousePointerClick, aide: 'Un encadré avec un bouton.' },
  { value: 'GALLERY', label: 'Galerie', icon: GalleryHorizontal, aide: 'Plusieurs images, cliquables sur le site.' },
  { value: 'TEAM', label: 'Équipe', icon: Users, aide: 'Une SECTION par personne : portrait, fonction, présentation.' },
];

const typeInfo = (t: SitePageBlockType) => TYPES.find((x) => x.value === t) ?? TYPES[0];

const blocVide = (type: SitePageBlockType, ordre: number): SitePageBlock => ({
  type,
  order: ordre,
  eyebrow: '',
  title: '',
  subtitle: '',
  html: '',
  text: '',
  author: '',
  image: null,
  imageSide: 'LEFT',
  images: [],
  items: [],
  buttonLabel: '',
  buttonUrl: '',
  /*
    LA LARGEUR DE DÉPART SUIT LA NATURE DU BLOC.

    « Équipe » naît en LARGE, comme les atouts et les galeries : chaque
    personne occupe une rangée avec son portrait, ce qu'une colonne de lecture
    écraserait — mais la PLEINE largeur, elle, déborde de l'en-tête de la page
    (`max-w-5xl`) de soixante-quatre pixels de chaque côté. Le bloc démarrait
    alors à une abscisse que rien d'autre sur la page ne partage, et la page
    se lisait en escalier.
  */
  width: type === 'RICH_TEXT' || type === 'QUOTE' ? 'NARROW' : 'WIDE',
  surface: false,
});

const pageVide = (): Partial<SitePage> => ({
  title: '',
  navLabel: '',
  showInNav: true,
  intro: '',
  heroImage: '',
  blocks: [],
  seo: { metaTitle: '', metaDescription: '' },
  published: true,
});

export default function SitePageEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const neuf = id === 'nouveau';
  const { run } = useAction();

  const { data: page, loading } = useResource(
    () => (neuf ? Promise.resolve(null) : api.getPage(id!)),
    [id],
  );
  const [draft, setDraft] = React.useState<Partial<SitePage> | null>(null);

  React.useEffect(() => {
    if (draft || loading) return;
    setDraft(neuf ? pageVide() : (structuredClone(page) as Partial<SitePage>));
  }, [page, loading, neuf, draft]);

  const { state, save } = useFloatingSave(draft, async () => {
    if (!draft?.title?.trim()) return;
    if (neuf) {
      const cree = await run(() => api.createPage(draft), { success: 'Page créée' });
      navigate(`/pages/${cree._id}`, { replace: true });
      return cree as Partial<SitePage>;
    }
    return await run(() => api.updatePage(id!, draft), { success: 'Page enregistrée' }) as Partial<SitePage>;
  });

  if (loading || !draft) return <BrandLoader />;

  const maj = (patch: Partial<SitePage>) => setDraft({ ...draft, ...patch });

  return (
    <div className="pb-24">
      <Link
        to="/pages"
        className="-my-1 mb-3 inline-flex items-center gap-1.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Toutes les pages
      </Link>

      <PageHeader
        title={neuf ? 'Nouvelle page' : (draft.title || 'Page')}
        description={
          draft.slug && !neuf
            ? `Publiée à l'adresse /p/${draft.slug} — le contenu se compose par blocs.`
            : 'Le contenu se compose par blocs : titre, texte, image, chiffres clés.'
        }
        action={
          <Switch
            checked={draft.published ?? true}
            onChange={(v) => maj({ published: v })}
            label={draft.published ? 'Publiée' : 'Hors ligne'}
          />
        }
      />

      <Card>
        <CardContent className="pt-6">
          <EditeurPage valeur={draft} onChange={setDraft} />
        </CardContent>
      </Card>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

function EditeurPage({
  valeur, onChange,
}: {
  valeur: Partial<SitePage>;
  onChange: (p: Partial<SitePage>) => void;
}) {
  const maj = (patch: Partial<SitePage>) => onChange({ ...valeur, ...patch });
  const blocks = valeur.blocks ?? [];
  const [ajoutOuvert, setAjoutOuvert] = React.useState(false);

  const majBloc = (i: number, patch: Partial<SitePageBlock>) =>
    maj({ blocks: blocks.map((b, j) => (i === j ? { ...b, ...patch } : b)) });

  const deplacer = (i: number, delta: number) => {
    const cible = i + delta;
    if (cible < 0 || cible >= blocks.length) return;
    maj({ blocks: arrayMove(blocks, i, cible) });
  };


  return (
    <div className="space-y-6">
      {/* ── EN-TÊTE DE PAGE ──────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Titre de la page"
          className="sm:col-span-2"
          count={(valeur.title ?? '').length}
          max={SITE_PAGE_LIMITS.titleMax}
        >
          <Input
            value={valeur.title ?? ''}
            maxLength={SITE_PAGE_LIMITS.titleMax}
            onChange={(e) => maj({ title: e.target.value })}
            placeholder="Ex : Notre méthode"
          />
        </Field>
        <Field label="Libellé au menu" hint="Souvent plus court que le titre. Vide = le titre.">
          <Input
            value={valeur.navLabel ?? ''}
            onChange={(e) => maj({ navLabel: e.target.value })}
            placeholder="Ex : La méthode"
          />
        </Field>
        <Field label="Adresse" hint="Dérivée du titre — elle change si le titre change.">
          <Input value={valeur.slug ? `/${valeur.slug}` : '— à la création —'} readOnly disabled />
        </Field>
        <Field label="Chapô" className="sm:col-span-2" hint="Deux lignes sous le titre, en haut de la page.">
          <Textarea
            rows={2}
            value={valeur.intro ?? ''}
            onChange={(e) => maj({ intro: e.target.value })}
            placeholder="Une phrase qui situe la page."
          />
        </Field>
        <Field label="Image d'en-tête" className="sm:col-span-2">
          <ImageUpload
            value={valeur.heroImage || ''}
            mediaType="page-image"
            onChange={(url, descriptor) => maj({ heroImage: url, heroImageMedia: descriptor })}
            aspect="aspect-[21/9]"
          />
        </Field>
      </section>

      {/* ── LES BLOCS ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Contenu</h3>
            <p className="text-xs text-muted-foreground">
              {blocks.length} bloc{blocks.length > 1 ? 's' : ''} — ils s'affichent dans cet ordre.
            </p>
          </div>
          {/*
            LE PLAFOND DE BLOCS ÉTAIT INVISIBLE JUSQU'À L'ENREGISTREMENT.

            Le serveur en refuse plus de soixante (`SITE_PAGE_LIMITS`) ; l'écran,
            lui, en laissait composer autant qu'on voulait. Le refus tombait au
            moment d'enregistrer — c'est-à-dire APRÈS le travail, sur l'écran
            du produit où l'on en perd le plus.
          */}
          <Button
            variant="outline"
            size="sm"
            disabled={blocks.length >= SITE_PAGE_LIMITS.blocks.maxItems}
            title={
              blocks.length >= SITE_PAGE_LIMITS.blocks.maxItems
                ? limiteAtteinte(SITE_PAGE_LIMITS.blocks.maxItems, 'blocs')
                : undefined
            }
            onClick={() => setAjoutOuvert((o) => !o)}
          >
            <Plus className="h-4 w-4" /> Ajouter un bloc
          </Button>
        </div>
        {blocks.length >= SITE_PAGE_LIMITS.blocks.maxItems && (
          <p className="text-xs text-muted-foreground">
            {limiteAtteinte(SITE_PAGE_LIMITS.blocks.maxItems, 'blocs')}
          </p>
        )}

        {ajoutOuvert && (
          <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-3">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  maj({ blocks: [...blocks, blocVide(t.value, (blocks.length + 1) * 10)] });
                  setAjoutOuvert(false);
                }}
                className="flex items-start gap-2 rounded-md border border-border bg-background p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <t.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{t.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{t.aide}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {blocks.map((bloc, i) => (
            <EditeurBloc
              key={bloc._id ?? `bloc-${i}`}
              bloc={bloc}
              index={i}
              total={blocks.length}
              onChange={(patch) => majBloc(i, patch)}
              onMove={(d) => deplacer(i, d)}
              onRemove={() => maj({ blocks: blocks.filter((_, j) => j !== i) })}
            />
          ))}
          {blocks.length === 0 && (
            <p className="rounded-md border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
              Page vide — ajoutez un premier bloc.
            </p>
          )}
        </div>
      </section>

      {/* ── RÉFÉRENCEMENT & PUBLICATION ──────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Référencement</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Titre pour Google" hint="Vide = le titre de la page.">
            <Input
              value={valeur.seo?.metaTitle ?? ''}
              onChange={(e) => maj({ seo: { metaTitle: e.target.value, metaDescription: valeur.seo?.metaDescription ?? '' } })}
              placeholder="Ex : Ce que nous regardons avant de dessiner."
            />
          </Field>
          <Field label="Description pour Google" hint="Vide = le chapô.">
            <Input
              value={valeur.seo?.metaDescription ?? ''}
              onChange={(e) => maj({ seo: { metaTitle: valeur.seo?.metaTitle ?? '', metaDescription: e.target.value } })}
              placeholder="150 à 160 caractères."
            />
          </Field>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {valeur.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            Page publiée
          </div>
          {/* Un interrupteur sans libellé s'annonce « commutateur » — sans dire
              lequel. Sur cet écran, deux se suivent : « publiée » et « au menu ». */}
          <Switch
            checked={!!valeur.published}
            onChange={(v) => maj({ published: v })}
            label={valeur.published ? 'Dépublier la page' : 'Publier la page'}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="min-w-0 text-sm font-medium">
            Afficher au menu
            <p className="text-xs font-normal text-muted-foreground">
              Une page peut être en ligne sans encombrer le menu.
            </p>
          </div>
          <Switch
            checked={!!valeur.showInNav}
            onChange={(v) => maj({ showInNav: v })}
            label={valeur.showInNav ? 'Retirer la page du menu' : 'Afficher la page au menu'}
          />
        </div>
      </div>

    </div>
  );
}

/* ── L'éditeur d'un bloc ───────────────────────────────────────────────────── */

function EditeurBloc({
  bloc, index, total, onChange, onMove, onRemove,
}: {
  bloc: SitePageBlock;
  index: number;
  total: number;
  onChange: (patch: Partial<SitePageBlock>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [replie, setReplie] = React.useState(false);
  const info = typeInfo(bloc.type);

  const majItem = (i: number, patch: Partial<SitePageBlockItem>) =>
    onChange({ items: bloc.items.map((it, j) => (i === j ? { ...it, ...patch } : it)) });
  const majImage = (i: number, patch: Partial<SitePageImage>) =>
    onChange({ images: bloc.images.map((im, j) => (i === j ? { ...im, ...patch } : im)) });

  const ajouterItem = () =>
    onChange({
      items: [
        ...bloc.items,
        {
          icon: bloc.type === 'STATS' ? 'Gauge' : 'Sparkles',
          value: '',
          title: '',
          text: '',
          role: '',
          image: null,
          order: (bloc.items.length + 1) * 10,
        },
      ],
    });

  const majPortrait = (i: number, patch: Partial<SitePageImage>) =>
    majItem(i, {
      image: {
        ...(bloc.items[i]?.image ?? { url: '', media: null, alt: '', caption: '', order: 0 }),
        ...patch,
      } as SitePageImage,
    });

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <info.icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-xs font-semibold">{info.label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {bloc.title || bloc.eyebrow || bloc.text || (bloc.items.length ? `${bloc.items.length} élément(s)` : '')}
        </span>
        <Button variant="ghost" size="icon" aria-label="Monter" disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Descendre" disabled={index === total - 1} onClick={() => onMove(1)}>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setReplie((r) => !r)}>
          {replie ? 'Déplier' : 'Replier'}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Supprimer le bloc" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-red-600" />
        </Button>
      </div>

      {!replie && (
        <div className="space-y-4 p-3">
          {/* ── HEADING ─────────────────────────────────────────────────── */}
          {bloc.type === 'HEADING' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Sur-titre">
                <Input value={bloc.eyebrow} onChange={(e) => onChange({ eyebrow: e.target.value })} placeholder="Ex : La méthode" />
              </Field>
              <Field label="Titre" className="sm:col-span-2">
                <Input value={bloc.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex : Deux espaces, une architecture" />
              </Field>
              <Field label="Sous-titre" className="sm:col-span-3">
                <Input value={bloc.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Une ligne d'explication." />
              </Field>
            </div>
          )}

          {/* ── RICH_TEXT ───────────────────────────────────────────────── */}
          {bloc.type === 'RICH_TEXT' && (
            <RichTextEditor
              value={bloc.html}
              onChange={(html) => onChange({ html })}
              placeholder="Rédigez ici. Gras, italique, titres, listes et liens sont disponibles."
            />
          )}

          {/* ── IMAGE ───────────────────────────────────────────────────── */}
          {bloc.type === 'IMAGE' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ImageUpload
                value={bloc.image?.url || ''}
                mediaType="page-image"
                onChange={(url, descriptor) =>
                  onChange({ image: { ...(bloc.image ?? { alt: '', caption: '', order: 0 }), url, media: descriptor } })}
                aspect="aspect-[16/10]"
              />
              <div className="space-y-3">
                <Field label="Texte alternatif" hint="Ce qu'un lecteur d'écran annonce.">
                  <Input
                    value={bloc.image?.alt ?? ''}
                    onChange={(e) => onChange({ image: { ...(bloc.image ?? { url: '', caption: '', order: 0 }), alt: e.target.value } as SitePageImage })}
                    placeholder="Ex : Détail d’une interface"
                  />
                </Field>
                <Field label="Légende">
                  <Input
                    value={bloc.image?.caption ?? ''}
                    onChange={(e) => onChange({ image: { ...(bloc.image ?? { url: '', alt: '', order: 0 }), caption: e.target.value } as SitePageImage })}
                    placeholder="Affichée sous l'image."
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ── IMAGE_TEXT ──────────────────────────────────────────────── */}
          {bloc.type === 'IMAGE_TEXT' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">Image à</span>
                <SegmentedControl
                  value={bloc.imageSide}
                  onChange={(v) => onChange({ imageSide: v })}
                  options={[{ value: 'LEFT', label: 'gauche' }, { value: 'RIGHT', label: 'droite' }]}
                  label="Côté de l'image"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ImageUpload
                  value={bloc.image?.url || ''}
                  mediaType="page-image"
                  onChange={(url, descriptor) =>
                    onChange({ image: { ...(bloc.image ?? { alt: '', caption: '', order: 0 }), url, media: descriptor } })}
                  aspect="aspect-[4/3]"
                />
                <div className="space-y-3">
                  <Field label="Titre">
                    <Input value={bloc.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Titre de la colonne" />
                  </Field>
                  <RichTextEditor
                    value={bloc.html}
                    onChange={(html) => onChange({ html })}
                    placeholder="Le texte de la colonne."
                    minHeight="7rem"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── STATS · FEATURES ────────────────────────────────────────── */}
          {(bloc.type === 'STATS' || bloc.type === 'FEATURES') && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sur-titre">
                  <Input value={bloc.eyebrow} onChange={(e) => onChange({ eyebrow: e.target.value })} placeholder="Optionnel" />
                </Field>
                <Field label="Titre">
                  <Input value={bloc.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Optionnel" />
                </Field>
              </div>
              <div className="space-y-2">
                {bloc.items.map((it, i) => (
                  <div key={it._id ?? i} className="grid grid-cols-[9rem,1fr,auto] items-start gap-3 rounded-md border border-border p-2.5">
                    <IconPicker value={it.icon} onChange={(icon) => majItem(i, { icon })} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      {bloc.type === 'STATS' ? (
                        <Input value={it.value} onChange={(e) => majItem(i, { value: e.target.value })} placeholder="Ex : 4 projets par an" />
                      ) : (
                        <Input value={it.title} onChange={(e) => majItem(i, { title: e.target.value })} placeholder="Titre de l'atout" />
                      )}
                      <Input value={it.text} onChange={(e) => majItem(i, { text: e.target.value })} placeholder="Ligne d'explication" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Retirer"
                      onClick={() => onChange({ items: bloc.items.filter((_, j) => j !== i) })}
                    >
                      <X className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={ajouterItem}>
                  <Plus className="h-4 w-4" /> Ajouter un élément
                </Button>
              </div>
            </div>
          )}

          {/* ── QUOTE ───────────────────────────────────────────────────── */}
          {bloc.type === 'QUOTE' && (
            <div className="grid gap-3">
              <Field label="Citation">
                <Textarea rows={2} value={bloc.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="La phrase, sans guillemets." />
              </Field>
              <Field label="Auteur">
                <Input value={bloc.author} onChange={(e) => onChange({ author: e.target.value })} placeholder="Ex : Luca, fondateur" />
              </Field>
            </div>
          )}

          {/* ── CTA ─────────────────────────────────────────────────────── */}
          {bloc.type === 'CTA' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Titre" className="sm:col-span-2">
                <Input value={bloc.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex : Un projet en tête ?" />
              </Field>
              <Field label="Texte" className="sm:col-span-2">
                <Input value={bloc.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} placeholder="Une phrase d'encouragement." />
              </Field>
              <Field label="Libellé du bouton">
                <Input value={bloc.buttonLabel} onChange={(e) => onChange({ buttonLabel: e.target.value })} placeholder="Ex : Présenter mon projet" />
              </Field>
              <Field label="Destination" hint="Interne (/contact) ou externe (https://…).">
                <Input value={bloc.buttonUrl} onChange={(e) => onChange({ buttonUrl: e.target.value })} placeholder="/contact" />
              </Field>
            </div>
          )}

          {/* ── GALLERY ─────────────────────────────────────────────────── */}
          {bloc.type === 'GALLERY' && (
            <div className="space-y-3">
              {/*
                LE TITRE DE LA GALERIE — il était rendu par la vitrine, et
                impossible à saisir ici.

                Le champ manquait, purement et simplement : le bloc lisait
                `bloc.title`, aucun écran ne l'écrivait, et toutes les galeries
                sortaient donc anonymes. Une page qui en porte deux — « En
                piste » et « Nos challenges » — ne pouvait pas les distinguer.
              */}
              <Field label="Titre de la galerie" hint="Facultatif — vide, la mosaïque s'affiche sans titre.">
                <Input
                  value={bloc.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  placeholder="Ex : Notre approche"
                />
              </Field>
              <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Les images s'affichent en mosaïque et s'ouvrent en grand au clic. Format horizontal
                  conseillé — une image verticale isolée casse l'alignement de la rangée.
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {bloc.images.map((im, i) => (
                  <div key={im._id ?? i} className="space-y-2 rounded-md border border-border p-2">
                    <ImageUpload
                      value={im.url}
                      mediaType="page-image"
                      onChange={(url, descriptor) => majImage(i, { url, media: descriptor })}
                      aspect="aspect-[4/3]"
                    />
                    <Input
                      value={im.caption}
                      onChange={(e) => majImage(i, { caption: e.target.value })}
                      placeholder="Légende (optionnelle)"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => onChange({ images: bloc.images.filter((_, j) => j !== i) })}
                    >
                      <X className="h-4 w-4" /> Retirer
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChange({
                  images: [...bloc.images, { url: '', media: null, alt: '', caption: '', order: (bloc.images.length + 1) * 10 }],
                })}
              >
                <Plus className="h-4 w-4" /> Ajouter une image
              </Button>
            </div>
          )}

          {/* ── ÉQUIPE ──────────────────────────────────────────────────── */}
          {bloc.type === 'TEAM' && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sur-titre">
                  <Input value={bloc.eyebrow} onChange={(e) => onChange({ eyebrow: e.target.value })} placeholder="Ex : L'équipe" />
                </Field>
                <Field label="Titre">
                  <Input value={bloc.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex : Qui vous accompagne" />
                </Field>
              </div>

              <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Chaque personne occupe sa propre section en pleine largeur, portrait d'un côté et
                  texte de l'autre — le côté alterne automatiquement. Sans photo, ses initiales
                  prennent la place : une personne qui ne veut pas de son portrait en ligne garde
                  exactement la même mise en page.
                </span>
              </div>

              <div className="space-y-3">
                {bloc.items.map((it, i) => (
                  <div key={it._id ?? i} className="rounded-md border border-border p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Personne {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {it.title}
                      </span>
                      {/*
                        L'ORDRE EST CELUI DE LA PAGE, et il se manipule ici.
                        Sans ces deux flèches, corriger l'ordre des personnes
                        obligerait à retaper trois fiches — la seule solution
                        qu'offrait la liste plate des « atouts ».
                      */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Monter cette personne"
                        disabled={i === 0}
                        onClick={() => onChange({ items: arrayMove(bloc.items, i, i - 1) })}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Descendre cette personne"
                        disabled={i === bloc.items.length - 1}
                        onClick={() => onChange({ items: arrayMove(bloc.items, i, i + 1) })}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Retirer cette personne"
                        onClick={() => onChange({ items: bloc.items.filter((_, j) => j !== i) })}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[13rem,1fr]">
                      <div className="space-y-2">
                        {/*
                          `team-photo`, et pas `page-image` : le type dit ce
                          que l'image REPRÉSENTE, et la politique qui en
                          découle borne un portrait à 800 px de large au lieu
                          de 1920. Un portrait servi en 1920 pèse quatre fois
                          son utilité sur une page qui en aligne cinq.
                        */}
                        <ImageUpload
                          value={it.image?.url || ''}
                          mediaType="team-photo"
                          onChange={(url, descriptor) => majPortrait(i, { url, media: descriptor })}
                          aspect="aspect-[4/5]"
                        />
                        <Input
                          value={it.image?.alt ?? ''}
                          onChange={(e) => majPortrait(i, { alt: e.target.value })}
                          placeholder="Texte alternatif"
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Nom">
                            <Input value={it.title} onChange={(e) => majItem(i, { title: e.target.value })} placeholder="Ex : Luca Duhoux" />
                          </Field>
                          <Field label="Fonction">
                            <Input value={it.role ?? ''} onChange={(e) => majItem(i, { role: e.target.value })} placeholder="Ex : Fondateur" />
                          </Field>
                        </div>
                        <Field label="Présentation" hint="Les retours à la ligne sont conservés sur le site.">
                          <Textarea
                            rows={5}
                            value={it.text}
                            onChange={(e) => majItem(i, { text: e.target.value })}
                            placeholder="Ce qu'elle fait, ce qu'elle a fait avant, ce à quoi elle tient."
                          />
                        </Field>
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={ajouterItem}>
                  <Plus className="h-4 w-4" /> Ajouter une personne
                </Button>
              </div>
            </div>
          )}

          {/* ── MISE EN PAGE, commune à tous les blocs ──────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">Largeur</span>
              <SegmentedControl
                value={bloc.width}
                onChange={(v) => onChange({ width: v })}
                options={[
                  { value: 'NARROW', label: 'Colonne' },
                  { value: 'WIDE', label: 'Large' },
                  { value: 'FULL', label: 'Pleine' },
                ]}
                size="sm"
                label="Largeur du bloc"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Fond contrasté
              <Switch checked={bloc.surface} onChange={(v) => onChange({ surface: v })} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
