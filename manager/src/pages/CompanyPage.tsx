import * as React from 'react';
import { Award, Image as ImageIcon, MapPin } from 'lucide-react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { api } from '@/lib/api';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { useCompany } from '@/context/CompanyContext';
import type { Company } from '@/types';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
  Field,
  } from '@/components/ui/primitives';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { VitrineThemeScope } from '@/components/VitrineThemeScope';
import { HeroBanner } from '@vitrine/components/HeroBanner';

export default function CompanyPage() {
  const { data, loading, setData } = useResource(() => api.getCompany());
  const { run } = useAction();
  const { set: setCompanyIdentity } = useCompany();

  // Avant le garde-fou de chargement : un hook ne peut pas être conditionnel.
  // `useFloatingSave` accepte `null` et reste au repos tant que rien n'est chargé.
  const { state, save } = useFloatingSave(data, async () => {
    if (!data) return;
    const updated = await run(() => api.updateCompany(data), { success: 'Entreprise mise à jour' });
    setData(updated);
    setCompanyIdentity(updated);
    return updated;
  });

  if (loading || !data) {
    return (
      <BrandLoader variant="form" />
    );
  }

  const update = (patch: Partial<Company>) => setData({ ...data, ...patch });

  return (
    <div className="pb-20">
      <PageHeader
        title="Entreprise"
        description="Identité, logos et image d'accueil de votre établissement."
      />

      <div className="space-y-6">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Identité</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom de l'entreprise">
              <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Slogan / accroche" hint="Sous le nom, dans la bannière d'accueil de la vitrine.">
              <Input
                value={data.tagline}
                onChange={(e) => update({ tagline: e.target.value })}
                placeholder="Ongles, regard, prestations institut et formations beauté à Nice."
              />
            </Field>
            <Field label="Accroche au-dessus du titre" className="sm:col-span-2" hint="La petite ligne en couleur au-dessus du nom, dans la bannière. Mise à jour en direct sur la vitrine.">
              <Input
                value={data.heroKicker ?? ''}
                onChange={(e) => update({ heroKicker: e.target.value })}
                placeholder="Le geste. La certification. L'institut."
              />
            </Field>
            <Field
              label="Texte d'introduction (accueil)"
              className="sm:col-span-2"
              hint="Affiché sous la bannière de la page d'accueil."
            >
              <Textarea
                value={data.homeIntro}
                onChange={(e) => update({ homeIntro: e.target.value })}
                placeholder="Vos prestations, vos formations et ce qui rend l'experience institut unique..."
              />
            </Field>
          </CardContent>
        </Card>

        {/* Organisme de formation */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2"><Award className="h-5 w-5 text-muted-foreground" /> Organisme de formation</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Le numéro de déclaration d'activité (NDA) s'affiche en badge sur la page d'accueil, avec la mention légale
              obligatoire. Laissez vide pour masquer le badge.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Numéro de déclaration d'activité" unit="NDA, 11 chiffres" icon={<Award />}>
              <Input
                value={data.trainingDeclaration?.number ?? ''}
                inputMode="numeric"
                maxLength={20}
                onChange={(e) => update({ trainingDeclaration: { number: e.target.value, region: data.trainingDeclaration?.region ?? '' } })}
                placeholder="93061262606"
              />
            </Field>
            <Field label="Région de la préfecture" icon={<MapPin />} hint="Préfecture de région qui a enregistré la déclaration.">
              <Input
                value={data.trainingDeclaration?.region ?? ''}
                onChange={(e) => update({ trainingDeclaration: { number: data.trainingDeclaration?.number ?? '', region: e.target.value } })}
                placeholder="Provence-Alpes-Côte d'Azur"
              />
            </Field>
          </CardContent>
        </Card>

        {/* Logos */}
        <Card>
          <CardHeader>
            <CardTitle>Logos</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Deux logos distincts sont utilisés sur le site. Prévisualisez leur rendu ci-dessous.
            </p>
          </CardHeader>
          {/*
            ══ `min-w-0` N'EST PAS DÉCORATIF ICI ═══════════════════════════════

            Un élément de grille vaut `min-width: auto` par défaut : il REFUSE
            de descendre sous la largeur minimale de son contenu. La zone
            d'import porte un `aspect-ratio` — sa largeur minimale se déduit
            donc de sa hauteur, et vaut plusieurs centaines de pixels.

            À 320 px, cette colonne se posait à 558 px de large dans une carte
            de 286 : la page entière gagnait une barre de défilement
            horizontale, et la moitié du formulaire sortait de l'écran. Le
            symptôme se voyait sur « Entreprise », mais la cause est générique —
            toute grille dont un enfant porte un ratio la reproduit.
          */}
          <CardContent className="grid gap-8 md:grid-cols-2">
            {/* Header logo */}
            <div className="min-w-0">
              <h4 className="mb-1 text-sm font-semibold">Logo Header</h4>
              <p className="mb-3 text-xs text-muted-foreground">
                Affiché en haut du site, dans la barre de navigation. Privilégiez un format large
                (PNG transparent), lisible. Idéal : ~400×120 px.
              </p>
              <ImageUpload
                value={data.logos.header}
                previewUrl={data.mediaResolution?.['logos.header']?.url ?? null}
                mediaType="company-logo"
                onChange={(url, descriptor) => update({
                  logos: { ...data.logos, header: url },
                  logosMedia: { ...(data.logosMedia ?? {}), header: descriptor },
                })}
                aspect="aspect-[16/6]"
              />
              {/* Header simulation */}
              <p className="mb-1 mt-4 text-xs font-medium text-muted-foreground">Simulation Header</p>
              {/*
                LA SIMULATION NE DOIT PAS DÉBORDER À CAUSE DU NOM DU CLIENT.

                Sans logo, c'est le NOM de l'entreprise qui tient la place — et
                il était rendu dans un `<span>` incompressible, à côté de trois
                intitulés de menu tout aussi incompressibles. Une raison sociale
                un peu longue poussait donc la carte hors de l'écran à 320 px,
                et la page entière gagnait une barre de défilement horizontale.

                Le nom se tronque, le menu ne rétrécit pas — c'est le seul
                arbitrage qui garde la simulation lisible.
              */}
              <div className="flex items-center justify-between gap-3 overflow-hidden rounded-lg border border-border bg-white px-4 py-3">
                {data.logos.header ? (
                  <img src={resolvePreviewMediaUrl(data.mediaResolution?.['logos.header']?.url ?? data.logos.header)} alt="logo" className="h-8 min-w-0 object-contain" />
                ) : (
                  <span className="min-w-0 truncate text-sm font-bold text-slate-900">{data.name}</span>
                )}
                <div className="flex shrink-0 gap-3 text-xs text-slate-500">
                  <span>Accueil</span>
                  <span>Prestations</span>
                  <span>Formations</span>
                </div>
              </div>
            </div>

            {/* Favicon */}
            <div className="min-w-0">
              <h4 className="mb-1 text-sm font-semibold">Logo Favicon</h4>
              <p className="mb-3 text-xs text-muted-foreground">
                Petite icône affichée dans l'onglet du navigateur et les favoris. Doit rester
                lisible en tout petit. Format carré (256×256 px), fond plein recommandé.
              </p>
              <ImageUpload
                value={data.logos.favicon}
                previewUrl={data.mediaResolution?.['logos.favicon']?.url ?? null}
                mediaType="company-favicon"
                onChange={(url, descriptor) => update({
                  logos: { ...data.logos, favicon: url },
                  logosMedia: { ...(data.logosMedia ?? {}), favicon: descriptor },
                })}
                kind="favicon"
                aspect="aspect-square"
                className="mx-auto max-w-[180px]"
              />
              {/* Favicon simulation */}
              <p className="mb-1 mt-4 text-xs font-medium text-muted-foreground">Simulation Favicon</p>
              <div className="flex items-center gap-2 rounded-t-lg border border-border bg-muted px-3 py-2">
                <div className="flex items-center gap-1.5 rounded-t-md bg-white px-3 py-1.5 text-xs">
                  {data.logos.favicon ? (
                    <img src={resolvePreviewMediaUrl(data.mediaResolution?.['logos.favicon']?.url ?? data.logos.favicon)} alt="" className="h-4 w-4 rounded-sm" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="max-w-[100px] truncate text-slate-700">{data.name}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Les horaires d'ouverture vivent dans « Coordonnées & horaires »
            (page Contacts) — plus jamais ici (LOT UX horaires). */}

        {/* Hero image */}
        <Card>
          <CardHeader>
            <CardTitle>Image d'accueil</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Grande image de fond affichée tout en haut de la page d'accueil. Choisissez une photo
              horizontale, sombre et nette : le titre s'écrit par-dessus, et un cliché clair ou
              chargé le rend illisible. Idéal : 2400×1400 px, format paysage.
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <ImageUpload
              value={data.heroImage}
              previewUrl={data.mediaResolution?.heroImage?.url ?? null}
              mediaType="hero"
              onChange={(url, descriptor) => update({ heroImage: url, heroImageMedia: descriptor })}
              className="min-w-0"
              aspect="aspect-[16/9]"
              hint="Un dégradé sombre est appliqué automatiquement pour garder le texte lisible."
            />
            {/* Aperçu : la VRAIE bannière, pas une imitation. */}
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Aperçu de l'accueil</p>
              <ApercuBanniere
                imageUrl={resolvePreviewMediaUrl(data.mediaResolution?.heroImage?.url ?? data.heroImage)}
                name={data.name}
                tagline={data.tagline}
                kicker={data.heroKicker}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Rendu par le composant de la vitrine : ce que vous voyez ici est ce qui sera affiché.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

/**
 * APERÇU DE LA BANNIÈRE D'ACCUEIL — la vitrine, en réduction.
 *
 * ══ POURQUOI UNE MISE À L'ÉCHELLE, ET PAS UNE VERSION « PETITE » ═════════════
 *
 * La bannière est dessinée pour une fenêtre : titre en `text-6xl`, marges en
 * `pb-20`, largeur de lecture bornée à `max-w-6xl`. Rendue telle quelle dans
 * une carte de 500 px, elle serait juste — mais illisible, et surtout FAUSSE :
 * on jugerait des proportions qui ne sont pas celles du site.
 *
 * On la rend donc à sa taille réelle, dans une fenêtre simulée de 1280 px, et
 * c'est l'IMAGE ENTIÈRE qu'on réduit. Les proportions sont exactes par
 * construction : rien n'est remis à l'échelle à la main, donc rien ne peut se
 * tromper d'un facteur.
 *
 * `transform: scale` — et non `zoom` — parce que la transformation ne change
 * pas la boîte de mise en page : le conteneur garde ses 16/9 quoi qu'il
 * arrive, et l'aperçu ne pousse jamais la carte qui l'entoure.
 *
 * La hauteur simulée est posée en pixels via `--hero-min-h` : les `vh` du site
 * mesureraient la fenêtre du Manager, pas celle qu'on simule.
 */
const LARGEUR_SIMULEE = 1280;
const HAUTEUR_SIMULEE = Math.round((LARGEUR_SIMULEE * 9) / 16);

function ApercuBanniere({
  imageUrl,
  name,
  tagline,
  kicker,
}: {
  imageUrl: string | null;
  name: string;
  tagline?: string | null;
  kicker?: string | null;
}) {
  const cadre = React.useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = React.useState(0);

  React.useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setEchelle(el.clientWidth / LARGEUR_SIMULEE);
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={cadre} className="relative aspect-[16/9] overflow-hidden rounded-lg border">
      <VitrineThemeScope className="absolute inset-0">
        {/* Tant que la largeur n'est pas mesurée, l'échelle vaut 0 : on ne rend
            rien plutôt qu'une bannière grandeur nature l'espace d'une image. */}
        {echelle > 0 && (
          <div
            style={{
              width: LARGEUR_SIMULEE,
              height: HAUTEUR_SIMULEE,
              transform: `scale(${echelle})`,
              transformOrigin: 'top left',
              ['--hero-min-h' as string]: `${HAUTEUR_SIMULEE}px`,
              ['--hero-min-h-md' as string]: `${HAUTEUR_SIMULEE}px`,
            }}
          >
            <HeroBanner imageUrl={imageUrl} name={name} tagline={tagline} kicker={kicker || undefined} animate={false} titleAs="p" />
          </div>
        )}
      </VitrineThemeScope>
    </div>
  );
}
