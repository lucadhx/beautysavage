import * as React from 'react';
import { Plus, X, ChevronUp, ChevronDown, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useResource, useAction } from '@/hooks/useResource';
import { useFloatingSave } from '@/hooks/useFloatingSave';
import { useCompany } from '@/context/CompanyContext';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card, CardContent, CardHeader, CardTitle, Input, Textarea, Field, Button,
} from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { FloatingSaveWidget } from '@/components/ui/FloatingSaveWidget';
import { ImageUpload } from '@/components/fields/ImageUpload';
import { IconPicker } from '@/components/fields/IconPicker';
import { VitrineThemeScope } from '@/components/VitrineThemeScope';
import { HeroBanner } from '@vitrine/components/HeroBanner';
import { resolvePreviewMediaUrl } from '@/lib/media';
import type { HomeContent, HomeArgument, HomeProof } from '@/types';
import { HOME_CONTENT_LIMITS as L, limiteAtteinte } from '@/config/limits';

/**
 * L'ÉCRAN « ACCUEIL » — la page qui vend, éditable jusqu'au libellé du bouton.
 *
 * ══ POURQUOI CET ÉCRAN EXISTE ═══════════════════════════════════════════════
 *
 * La page d'accueil tirait son texte de la fiche entreprise et écrivait TOUT
 * LE RESTE en dur : titre de la bannière, intertitres, phrase d'invitation,
 * libellés de boutons. Changer « Parlez-nous de votre entreprise » demandait
 * une mise en production.
 *
 * C'est exactement ce que ce site promet à ses clients de ne pas leur faire
 * subir. Et un argumentaire de conversion, plus que tout autre texte, se
 * RÉÉCRIT : on change un verbe, on déplace une preuve, on essaie un autre
 * appel à l'action. Ce qui exige un déploiement ne s'essaie pas.
 *
 * ══ L'APERÇU EST LE COMPOSANT RÉEL, PAS UNE IMITATION ═══════════════════════
 *
 * Il rend `HeroBanner` — le fichier même que la vitrine utilise —, enveloppé
 * dans la palette du site. Un aperçu redessiné à la main se périme au premier
 * changement, sans que rien ne le signale, et l'on décide en le regardant.
 *
 * ══ L'ORDRE DES CARTES EST L'ORDRE DE LA PAGE ═══════════════════════════════
 *
 * Bannière, maquette, résultats, positionnement, preuves, invitation : c'est
 * la suite que voit le visiteur. Un écran d'édition rangé par type de champ —
 * « tous les titres », « tous les boutons » — oblige son utilisateur à tenir
 * la page de tête pendant qu'il l'écrit.
 */

/** Le squelette d'un document vide : jamais `undefined` dans un champ contrôlé. */
const VIDE: HomeContent = {
  hero: {
    kicker: '', title: '', subtitle: '',
    primaryLabel: '', primaryUrl: '', secondaryLabel: '', secondaryUrl: '',
    proofs: [], image: '',
  },
  showcase: {
    browserUrl: '', siteName: '', navItems: [],
    headline: '', subline: '', ctaLabel: '', badge: '', cards: [], image: '',
  },
  outcomes: { eyebrow: '', title: '', lead: '', items: [] },
  positioning: { eyebrow: '', title: '', text: '' },
  trust: { eyebrow: '', title: '', items: [] },
  invitation: { title: '', text: '', buttonLabel: '', buttonUrl: '' },
};

/**
 * FUSION EN PROFONDEUR AVEC LE SQUELETTE.
 *
 * Le backend rend un document dont les sous-objets existent mais dont les
 * TABLEAUX peuvent manquer sur une base antérieure. `{...VIDE, ...recu}`
 * remplacerait `hero` en entier par celui reçu, tableaux absents compris — et
 * `proofs.map` planterait sur un écran par ailleurs correct.
 */
function hydrater(recu: HomeContent | null): HomeContent {
  if (!recu) return structuredClone(VIDE);
  return {
    ...recu,
    hero: { ...VIDE.hero, ...(recu.hero ?? {}), proofs: recu.hero?.proofs ?? [] },
    showcase: {
      ...VIDE.showcase,
      ...(recu.showcase ?? {}),
      navItems: recu.showcase?.navItems ?? [],
      cards: recu.showcase?.cards ?? [],
    },
    outcomes: { ...VIDE.outcomes, ...(recu.outcomes ?? {}), items: recu.outcomes?.items ?? [] },
    positioning: { ...VIDE.positioning, ...(recu.positioning ?? {}) },
    trust: { ...VIDE.trust, ...(recu.trust ?? {}), items: recu.trust?.items ?? [] },
    invitation: { ...VIDE.invitation, ...(recu.invitation ?? {}) },
  };
}

export default function HomeContentPage() {
  const { data: recu, loading, setData } = useResource(() => api.getHomeContent());
  const { run } = useAction();
  const { company } = useCompany();
  const [draft, setDraft] = React.useState<HomeContent | null>(null);

  React.useEffect(() => {
    if (draft || loading) return;
    setDraft(hydrater(recu));
  }, [recu, loading, draft]);

  const { state, save } = useFloatingSave(draft, async () => {
    if (!draft) return;
    const maj = await run(() => api.updateHomeContent(draft), { success: 'Accueil mis à jour' });
    setData(maj);
    return maj;
  });

  if (loading || !draft) return <BrandLoader />;

  /** Remplace une SECTION du document, sans toucher aux autres. */
  const majSection = <K extends keyof HomeContent>(cle: K, patch: Partial<HomeContent[K]>) =>
    setDraft({ ...draft, [cle]: { ...(draft[cle] as object), ...patch } } as HomeContent);

  return (
    <div className="pb-24">
      <PageHeader
        title="Accueil"
        description="La bannière, la maquette d'appareils, les arguments et les preuves de la page d'accueil."
      />

      <div className="space-y-6">
        {/* ── L'APERÇU ───────────────────────────────────────────────────── */}
        <ApercuBanniere contenu={draft} heroImage={company?.heroImage} nom={company?.name ?? ''} />

        {/* ── LA BANNIÈRE ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>La bannière</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Le titre est la PROMESSE, pas le nom de l'entreprise — le visiteur le lit déjà dans
                l'en-tête. Dites ce qu'il obtient, pas ce que vous êtes. Laissé vide, le nom de
                l'entreprise reprend sa place.
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Sur-titre"
                hint="Court, en majuscules sur le site."
                count={(draft.hero?.kicker ?? '').length}
                max={L.hero.kickerMax}
              >
                <Input
                  value={draft.hero?.kicker ?? ''}
                  maxLength={L.hero.kickerMax}
                  onChange={(e) => majSection('hero', { kicker: e.target.value })}
                  placeholder="Ex : Sites vitrines sur mesure"
                />
              </Field>
              <Field
                label="Titre"
                className="sm:col-span-2"
                count={(draft.hero?.title ?? '').length}
                max={L.hero.titleMax}
              >
                <Input
                  value={draft.hero?.title ?? ''}
                  maxLength={L.hero.titleMax}
                  onChange={(e) => majSection('hero', { title: e.target.value })}
                  placeholder="Ex : Un site qui transforme vos visiteurs en clients."
                />
              </Field>
            </div>
            <Field
              label="Sous-titre"
              hint="Une à deux phrases. Ce que ça change concrètement."
              count={(draft.hero?.subtitle ?? '').length}
              max={L.hero.subtitleMax}
            >
              <Textarea
                rows={3}
                value={draft.hero?.subtitle ?? ''}
                maxLength={L.hero.subtitleMax}
                onChange={(e) => majSection('hero', { subtitle: e.target.value })}
                placeholder="Ex : Vos clients comprennent ce que vous faites en moins de 30 secondes…"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Bouton principal"
                count={(draft.hero?.primaryLabel ?? '').length}
                max={L.hero.labelMax}
              >
                <Input
                  value={draft.hero?.primaryLabel ?? ''}
                  maxLength={L.hero.labelMax}
                  onChange={(e) => majSection('hero', { primaryLabel: e.target.value })}
                  placeholder="Ex : Présenter mon projet"
                />
              </Field>
              <Field label="Destination" hint="Interne (/presenter-un-projet) ou externe (https://…).">
                <Input
                  value={draft.hero?.primaryUrl ?? ''}
                  maxLength={L.hero.urlMax}
                  onChange={(e) => majSection('hero', { primaryUrl: e.target.value })}
                  placeholder="/presenter-un-projet"
                />
              </Field>
              <Field
                label="Bouton secondaire"
                hint="Vide, il n'apparaît pas — et c'est souvent mieux."
                count={(draft.hero?.secondaryLabel ?? '').length}
                max={L.hero.labelMax}
              >
                <Input
                  value={draft.hero?.secondaryLabel ?? ''}
                  maxLength={L.hero.labelMax}
                  onChange={(e) => majSection('hero', { secondaryLabel: e.target.value })}
                  placeholder="Ex : Voir notre méthode"
                />
              </Field>
              <Field label="Destination">
                <Input
                  value={draft.hero?.secondaryUrl ?? ''}
                  maxLength={L.hero.urlMax}
                  onChange={(e) => majSection('hero', { secondaryUrl: e.target.value })}
                  placeholder="/conception"
                />
              </Field>
            </div>

            <ListeSimple
              titre="Rassurances sous les boutons"
              aide="Des faits vérifiables : un délai, une garantie, une inclusion."
              quoi="rassurances"
              valeurs={(draft.hero?.proofs ?? []).map((p) => p.text ?? '')}
              placeholder="Ex : Livré en 4 semaines"
              max={L.hero.proofs.maxItems}
              maxLength={L.hero.proofs.textMax}
              onChange={(textes) =>
                majSection('hero', {
                  proofs: textes.map((text, i): HomeProof => ({
                    ...(draft.hero?.proofs?.[i] ?? {}),
                    text,
                    order: (i + 1) * 10,
                  })),
                })}
            />

            {/*
              L'IMAGE DE FOND — elle vit ICI, et c'est le point.

              Elle était lue depuis la fiche entreprise, écran « Informations ».
              Le propriétaire qui voulait une image sur son accueil la cherchait
              sur cet écran-ci, où se règle tout le reste de la bannière, ne la
              trouvait pas, et concluait qu'il n'y en avait pas.
            */}
            <div className="grid gap-4 sm:grid-cols-[20rem,1fr]">
              <Field
                label="Image de fond"
                hint="Facultative. Sans elle, la bannière garde le fond de votre thème."
              >
                <ImageUpload
                  value={draft.hero?.image || ''}
                  previewUrl={draft.heroImageUrl}
                  mediaType="hero"
                  onChange={(url, descriptor) =>
                    majSection('hero', { image: url, imageMedia: descriptor })}
                  aspect="aspect-[16/9]"
                />
              </Field>
              <div className="flex items-start gap-2 self-start rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  L'image passe derrière le titre, atténuée et voilée pour que le texte reste
                  lisible : elle donne une matière, elle ne raconte pas la page. Choisissez une
                  photo dont le côté GAUCHE est calme — c'est là que vivent le titre et les
                  boutons. Un cliché large et peu contrasté fonctionne mieux qu'un gros plan.
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── LA MAQUETTE ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>La maquette d'appareils</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                L'ordinateur et le téléphone de la bannière montrent un site FICTIF. Écrivez-le pour
                le client que vous cherchez : un restaurateur doit y lire « Réserver une table », un
                artisan « Demander un devis ». C'est ce qui fait qu'il s'y reconnaît.
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Nom du site fictif"
                count={(draft.showcase?.siteName ?? '').length}
                max={L.showcase.siteNameMax}
              >
                <Input
                  value={draft.showcase?.siteName ?? ''}
                  maxLength={L.showcase.siteNameMax}
                  onChange={(e) => majSection('showcase', { siteName: e.target.value })}
                  placeholder="Ex : Maison Vasseur"
                />
              </Field>
              <Field
                label="Adresse affichée"
                hint="Dans la barre du navigateur de la maquette."
                count={(draft.showcase?.browserUrl ?? '').length}
                max={L.showcase.browserUrlMax}
              >
                <Input
                  value={draft.showcase?.browserUrl ?? ''}
                  maxLength={L.showcase.browserUrlMax}
                  onChange={(e) => majSection('showcase', { browserUrl: e.target.value })}
                  placeholder="www.maison-vasseur.fr"
                />
              </Field>
            </div>

            <ListeSimple
              titre="Menu du site fictif"
              aide="Trois ou quatre entrées. Au-delà, elles se chevauchent à petite taille."
              quoi="entrées de menu"
              valeurs={draft.showcase?.navItems ?? []}
              placeholder="Ex : La carte"
              max={L.showcase.navItems.maxItems}
              maxLength={L.showcase.navItems.textMax}
              onChange={(navItems) => majSection('showcase', { navItems })}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Pastille de réassurance"
                hint="Facultative. Vide, elle n'apparaît pas."
                count={(draft.showcase?.badge ?? '').length}
                max={L.showcase.badgeMax}
              >
                <Input
                  value={draft.showcase?.badge ?? ''}
                  maxLength={L.showcase.badgeMax}
                  onChange={(e) => majSection('showcase', { badge: e.target.value })}
                  placeholder="Ex : Ouvert · Réponse sous 24 h"
                />
              </Field>
              <Field
                label="Bouton du site fictif"
                count={(draft.showcase?.ctaLabel ?? '').length}
                max={L.showcase.ctaLabelMax}
              >
                <Input
                  value={draft.showcase?.ctaLabel ?? ''}
                  maxLength={L.showcase.ctaLabelMax}
                  onChange={(e) => majSection('showcase', { ctaLabel: e.target.value })}
                  placeholder="Ex : Réserver une table"
                />
              </Field>
            </div>

            <Field
              label="Titre du site fictif"
              count={(draft.showcase?.headline ?? '').length}
              max={L.showcase.headlineMax}
            >
              <Input
                value={draft.showcase?.headline ?? ''}
                maxLength={L.showcase.headlineMax}
                onChange={(e) => majSection('showcase', { headline: e.target.value })}
                placeholder="Ex : Cuisine de saison, à deux pas du port"
              />
            </Field>
            <Field
              label="Sous-titre du site fictif"
              count={(draft.showcase?.subline ?? '').length}
              max={L.showcase.sublineMax}
            >
              <Textarea
                rows={2}
                value={draft.showcase?.subline ?? ''}
                maxLength={L.showcase.sublineMax}
                onChange={(e) => majSection('showcase', { subline: e.target.value })}
                placeholder="Ex : Ouvert du mardi au samedi, midi et soir."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-[16rem,1fr]">
              <Field label="Image de la maquette" hint="Facultative : sans elle, un dégradé à votre couleur d'accent.">
                <ImageUpload
                  value={draft.showcase?.image || ''}
                  previewUrl={draft.showcaseImageUrl}
                  mediaType="page-image"
                  onChange={(url, descriptor) =>
                    majSection('showcase', { image: url, imageMedia: descriptor })}
                  aspect="aspect-[16/10]"
                />
              </Field>
              <ListeArguments
                titre="Les tuiles du site fictif"
                aide="Elles se lisent en très petit : un titre de trois mots, une ligne."
                quoi="tuiles"
                items={draft.showcase?.cards ?? []}
                avecIcone={false}
                avecChiffre={false}
                max={L.showcase.cards.maxItems}
                longueurs={{ titre: L.showcase.cards.titleMax, texte: L.showcase.cards.textMax }}
                placeholders={{ titre: 'Ex : Menu du jour', texte: 'Ex : Changé chaque matin' }}
                onChange={(cards) => majSection('showcase', { cards })}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── LES RÉSULTATS ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Ce que ça change — les résultats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                La première section après la bannière. Parlez de CE QU'IL OBTIENT — plus de demandes,
                moins d'appels pour rien —, jamais de votre méthode : elle a ses chapitres. Le
                chiffre est facultatif : mieux vaut pas de chiffre qu'un chiffre inventé.
              </span>
            </div>
            <EnTeteSection
              valeurs={draft.outcomes ?? {}}
              avecChapo
              longueurs={L.outcomes}
              onChange={(patch) => majSection('outcomes', patch)}
              placeholders={{ surTitre: 'Ex : Résultats', titre: 'Ex : Ce que ça change pour vous' }}
            />
            <ListeArguments
              titre="Les résultats"
              quoi="résultats"
              items={draft.outcomes?.items ?? []}
              avecIcone
              avecChiffre
              max={L.outcomes.items.maxItems}
              longueurs={{
                chiffre: L.outcomes.items.valueMax,
                titre: L.outcomes.items.titleMax,
                texte: L.outcomes.items.textMax,
              }}
              placeholders={{ titre: 'Ex : Des demandes qualifiées', texte: 'Une ligne d’explication.' }}
              onChange={(items) => majSection('outcomes', { items })}
            />
          </CardContent>
        </Card>

        {/* ── LE POSITIONNEMENT ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Positionnement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Les trois mots barrés — « Un modèle », « Un catalogue », « Une déclinaison » — sont
                dessinés par le site et ne s'éditent pas : ils décrivent ce que vous refusez. Le
                titre et le texte qui leur répondent, eux, sont à vous.
              </span>
            </div>
            <EnTeteSection
              valeurs={draft.positioning ?? {}}
              longueurs={L.positioning}
              onChange={(patch) => majSection('positioning', patch)}
              placeholders={{ surTitre: 'Ex : Positionnement', titre: 'Ex : Une conception unique, pour une entreprise unique.' }}
            />
            <Field
              label="Texte"
              count={(draft.positioning?.text ?? '').length}
              max={L.positioning.textMax}
            >
              <Textarea
                rows={5}
                value={draft.positioning?.text ?? ''}
                maxLength={L.positioning.textMax}
                onChange={(e) => majSection('positioning', { text: e.target.value })}
                placeholder="Ce qui vous distingue, du point de vue du client."
              />
            </Field>
          </CardContent>
        </Card>

        {/* ── LES PREUVES ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Preuves de confiance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Placées juste avant l'invitation : une garantie ne fait envie à personne, elle lève
                un dernier frein. Des ENGAGEMENTS qu'un client peut vous opposer — pas de logos
                empruntés, pas de témoignages, pas de compteur de projets.
              </span>
            </div>
            <EnTeteSection
              valeurs={draft.trust ?? {}}
              longueurs={L.trust}
              onChange={(patch) => majSection('trust', patch)}
              placeholders={{ surTitre: 'Ex : Nos engagements', titre: 'Ex : Ce sur quoi vous pouvez compter' }}
            />
            <ListeArguments
              titre="Les engagements"
              quoi="engagements"
              items={draft.trust?.items ?? []}
              avecIcone
              avecChiffre={false}
              max={L.trust.items.maxItems}
              longueurs={{ titre: L.trust.items.titleMax, texte: L.trust.items.textMax }}
              placeholders={{ titre: 'Ex : Vous restez propriétaire', texte: 'Une ligne d’explication.' }}
              onChange={(items) => majSection('trust', { items })}
            />
          </CardContent>
        </Card>

        {/* ── L'INVITATION ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>L'invitation finale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Titre"
              count={(draft.invitation?.title ?? '').length}
              max={L.invitation.titleMax}
            >
              <Input
                value={draft.invitation?.title ?? ''}
                maxLength={L.invitation.titleMax}
                onChange={(e) => majSection('invitation', { title: e.target.value })}
                placeholder="Ex : Parlez-nous de votre entreprise."
              />
            </Field>
            <Field
              label="Texte"
              count={(draft.invitation?.text ?? '').length}
              max={L.invitation.textMax}
            >
              <Textarea
                rows={3}
                value={draft.invitation?.text ?? ''}
                maxLength={L.invitation.textMax}
                onChange={(e) => majSection('invitation', { text: e.target.value })}
                placeholder="Une phrase qui enlève la pression de l'engagement."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Libellé du bouton"
                count={(draft.invitation?.buttonLabel ?? '').length}
                max={L.invitation.labelMax}
              >
                <Input
                  value={draft.invitation?.buttonLabel ?? ''}
                  maxLength={L.invitation.labelMax}
                  onChange={(e) => majSection('invitation', { buttonLabel: e.target.value })}
                  placeholder="Ex : Présenter mon projet"
                />
              </Field>
              <Field label="Destination">
                <Input
                  value={draft.invitation?.buttonUrl ?? ''}
                  maxLength={L.invitation.urlMax}
                  onChange={(e) => majSection('invitation', { buttonUrl: e.target.value })}
                  placeholder="/presenter-un-projet"
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <FloatingSaveWidget state={state} onSave={save} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   L'APERÇU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * LA BANNIÈRE RÉELLE, À L'ÉCHELLE.
 *
 * Elle est rendue à sa largeur de conception puis réduite : une bannière
 * dessinée pour 1440 px et rendue dans 700 px n'est pas « la même en plus
 * petit », c'est une autre mise en page — celle des tablettes. On mesure donc
 * le conteneur et on applique un facteur, comme le fait déjà l'aperçu de
 * l'écran « Informations ».
 *
 * `animate={false}` : la scène flotte et le halo respire. Les rejouer à chaque
 * frappe dans un champ situé juste en dessous est épuisant.
 */
const LARGEUR_SIMULEE = 1440;
const HAUTEUR_SIMULEE = 760;

function ApercuBanniere({
  contenu, heroImage, nom,
}: {
  contenu: HomeContent;
  heroImage?: string;
  nom: string;
}) {
  const boite = React.useRef<HTMLDivElement>(null);
  const [echelle, setEchelle] = React.useState(0);

  React.useEffect(() => {
    const n = boite.current;
    if (!n) return;
    const mesurer = () => setEchelle(n.clientWidth / LARGEUR_SIMULEE);
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(n);
    return () => ro.disconnect();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aperçu</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={boite}
          className="overflow-hidden rounded-lg border border-border"
          style={{ height: echelle > 0 ? HAUTEUR_SIMULEE * echelle : 220 }}
        >
          <VitrineThemeScope>
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
                <HeroBanner
                  imageUrl={resolvePreviewMediaUrl(heroImage)}
                  name={nom || 'Votre entreprise'}
                  animate={false}
                  imageWidth={contenu.hero?.imageMedia?.width}
                  imageHeight={contenu.hero?.imageMedia?.height}
                  titleAs="p"
                  hero={{
                    ...(contenu.hero ?? {}),
                    /* Même règle que la maquette : l'adresse RÉSOLUE, pas le
                       chemin stocké, qui ne s'affiche pas depuis le Manager
                       tant que le média n'est pas servi par la destination. */
                    image: contenu.heroImageUrl || contenu.hero?.image,
                  }}
                  showcase={{
                    ...(contenu.showcase ?? {}),
                    /* L'adresse RÉSOLUE, pas le chemin stocké : ce dernier ne
                       s'affiche pas depuis le Manager tant que le média n'est
                       pas servi par la destination active. */
                    image: contenu.showcaseImageUrl || contenu.showcase?.image,
                  }}
                />
              </div>
            )}
          </VitrineThemeScope>
        </div>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   LES ÉDITEURS RÉUTILISABLES
   ══════════════════════════════════════════════════════════════════════════ */

function EnTeteSection({
  valeurs, onChange, placeholders, longueurs, avecChapo = false,
}: {
  valeurs: { eyebrow?: string; title?: string; lead?: string };
  onChange: (patch: { eyebrow?: string; title?: string; lead?: string }) => void;
  placeholders: { surTitre: string; titre: string };
  /**
   * Les plafonds de la section, venus de `@/config/limits` — jamais écrits ici.
   * Un nombre recopié dans un composant est un nombre qui dérivera : c'est
   * exactement ce qui a produit le défaut des chiffres clés.
   */
  longueurs: { eyebrowMax: number; titleMax: number; leadMax?: number };
  avecChapo?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field
        label="Sur-titre"
        count={(valeurs.eyebrow ?? '').length}
        max={longueurs.eyebrowMax}
      >
        <Input
          value={valeurs.eyebrow ?? ''}
          maxLength={longueurs.eyebrowMax}
          onChange={(e) => onChange({ eyebrow: e.target.value })}
          placeholder={placeholders.surTitre}
        />
      </Field>
      <Field
        label="Titre"
        className="sm:col-span-2"
        count={(valeurs.title ?? '').length}
        max={longueurs.titleMax}
      >
        <Input
          value={valeurs.title ?? ''}
          maxLength={longueurs.titleMax}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder={placeholders.titre}
        />
      </Field>
      {avecChapo && longueurs.leadMax !== undefined && (
        <Field
          label="Chapô"
          className="sm:col-span-3"
          count={(valeurs.lead ?? '').length}
          max={longueurs.leadMax}
        >
          <Textarea
            rows={2}
            value={valeurs.lead ?? ''}
            maxLength={longueurs.leadMax}
            onChange={(e) => onChange({ lead: e.target.value })}
            placeholder="Une phrase sous le titre. Facultative."
          />
        </Field>
      )}
    </div>
  );
}

/**
 * UNE LISTE DE CHAÎNES — menu du site fictif, rassurances de la bannière.
 *
 * Un seul champ à virgules aurait été plus court à écrire et pire à utiliser :
 * on ne peut ni réordonner, ni voir combien d'entrées on a, et une virgule
 * dans un libellé casse tout en silence.
 */
function ListeSimple({
  titre, aide, quoi, valeurs, placeholder, max, maxLength, onChange,
}: {
  titre: string;
  aide?: string;
  /** Le nom des éléments, au pluriel — sert à écrire la phrase de limite. */
  quoi: string;
  valeurs: string[];
  placeholder: string;
  max: number;
  maxLength: number;
  onChange: (valeurs: string[]) => void;
}) {
  /**
   * L'IDENTITÉ D'UNE LIGNE NE PEUT PAS ÊTRE SON RANG.
   *
   * ══ LE DÉFAUT ═════════════════════════════════════════════════════════════
   *
   * Ces lignes portaient `key={i}`. React réconcilie alors par POSITION : en
   * déplaçant la deuxième entrée vers le haut, il ne déplace rien — il réécrit
   * la valeur des deux champs. Conséquences observées sur une liste dont on
   * réordonne les entrées :
   *
   *   · le focus reste sur la ligne du dessus, qui contient désormais un autre
   *     texte — on continue de taper dans la mauvaise entrée ;
   *   · la position du curseur est perdue à chaque déplacement ;
   *   · supprimer une ligne du milieu fait « remonter » la valeur suivante dans
   *     le champ que l'on regardait, ce qui se lit comme une suppression ratée.
   *
   * ══ POURQUOI UN IDENTIFIANT PORTÉ, ET NON LA VALEUR ═══════════════════════
   *
   * La valeur ne peut pas servir de clé : elle est VIDE à la création (deux
   * lignes neuves auraient la même) et elle change à chaque frappe, ce qui
   * démonterait le champ en cours de saisie. On attribue donc à chaque ligne un
   * identifiant stable, tenu à part de la donnée — c'est une liste de chaînes,
   * elle n'a pas d'`_id` à emprunter.
   */
  const cles = React.useRef<string[]>([]);
  if (cles.current.length !== valeurs.length) {
    // Ajuste la longueur SANS toucher aux clés existantes : elles identifient
    // des lignes que l'utilisateur est peut-être en train d'éditer.
    cles.current = valeurs.map((_, i) => cles.current[i] ?? `l${Math.random().toString(36).slice(2)}`);
  }

  const appliquer = (suivant: string[], cleSuivantes: string[]) => {
    cles.current = cleSuivantes;
    onChange(suivant);
  };

  const bouger = (i: number, delta: number) => {
    const suivant = [...valeurs];
    const cs = [...cles.current];
    const [v] = suivant.splice(i, 1);
    const [c] = cs.splice(i, 1);
    suivant.splice(i + delta, 0, v);
    cs.splice(i + delta, 0, c);
    appliquer(suivant, cs);
  };

  const retirer = (i: number) =>
    appliquer(valeurs.filter((_, j) => j !== i), cles.current.filter((_, j) => j !== i));

  const plein = valeurs.length >= max;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold">{titre}</span>
        <span className="text-xs text-muted-foreground">
          {max} au maximum{aide ? ` — ${aide.charAt(0).toLowerCase()}${aide.slice(1)}` : '.'}
        </span>
      </div>
      {valeurs.map((v, i) => (
        <div key={cles.current[i]} className="flex items-center gap-1 sm:gap-2">
          <Input
            value={v}
            maxLength={maxLength}
            aria-label={`${titre} — entrée ${i + 1}`}
            onChange={(e) => onChange(valeurs.map((x, j) => (i === j ? e.target.value : x)))}
            placeholder={placeholder}
          />
          <Button variant="ghost" size="icon" aria-label={`Monter l’entrée ${i + 1}`} disabled={i === 0} onClick={() => bouger(i, -1)}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descendre l’entrée ${i + 1}`}
            disabled={i === valeurs.length - 1}
            onClick={() => bouger(i, 1)}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Retirer l’entrée ${i + 1}`} onClick={() => retirer(i)}>
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ))}
      {/*
        LE BOUTON RESTE, DÉSACTIVÉ, ET PORTE SA RAISON.

        Il DISPARAISSAIT à la limite. Un bouton évaporé ne s'explique pas : il
        fait chercher ce qu'on a cassé, ou croire que la fonctionnalité dépend
        d'un droit qu'on n'a pas.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={plein}
          title={plein ? limiteAtteinte(max, quoi) : undefined}
          onClick={() => appliquer([...valeurs, ''], [...cles.current, `l${Math.random().toString(36).slice(2)}`])}
        >
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
        {plein && <span className="text-xs text-muted-foreground">{limiteAtteinte(max, quoi)}</span>}
      </div>
    </div>
  );
}

/**
 * UNE LISTE D'ARGUMENTS — résultats, engagements, tuiles de la maquette.
 *
 * Les trois s'écrivent pareil (un titre, une ligne) et diffèrent par ce qu'ils
 * PORTENT EN PLUS : une icône, un chiffre, ni l'un ni l'autre. Trois éditeurs
 * auraient triplé le code d'ajout, de retrait et de réordonnancement pour une
 * différence de deux champs — et le troisième aurait fini par oublier les
 * flèches, comme cela s'est produit pour les « atouts ».
 */
function ListeArguments({
  titre, aide, quoi, items, avecIcone, avecChiffre, max, longueurs, placeholders, onChange,
}: {
  titre: string;
  aide?: string;
  /** Le nom des éléments, au pluriel — sert à écrire la phrase de limite. */
  quoi: string;
  items: HomeArgument[];
  avecIcone: boolean;
  avecChiffre: boolean;
  max: number;
  /** Les plafonds de saisie, venus de `@/config/limits`. */
  longueurs: { chiffre?: number; titre: number; texte: number };
  placeholders: { titre: string; texte: string };
  onChange: (items: HomeArgument[]) => void;
}) {
  const maj = (i: number, patch: Partial<HomeArgument>) =>
    onChange(items.map((it, j) => (i === j ? { ...it, ...patch } : it)));

  const bouger = (i: number, delta: number) => {
    const suivant = [...items];
    const [v] = suivant.splice(i, 1);
    suivant.splice(i + delta, 0, v);
    onChange(suivant.map((it, j) => ({ ...it, order: (j + 1) * 10 })));
  };

  const plein = items.length >= max;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold">{titre}</span>
        <span className="text-xs text-muted-foreground">
          {max} au maximum{aide ? ` — ${aide.charAt(0).toLowerCase()}${aide.slice(1)}` : '.'}
        </span>
      </div>
      {items.map((it, i) => (
        <div key={it._id ?? i} className="space-y-2 rounded-md border border-border p-2.5">
          {/*
            LA RANGÉE S'EMPILE SUR PETIT ÉCRAN.

            Elle était en `flex` sans repli : à 375 px, le sélecteur d'icône, le
            chiffre, le titre et TROIS boutons se partageaient la largeur — le
            champ de titre tombait sous les 60 px, et les boutons perdaient
            leur cible tactile. `flex-wrap` laisse les commandes passer à la
            ligne plutôt que d'écraser la saisie.
          */}
          <div className="flex flex-wrap items-start gap-2">
            {avecIcone && <IconPicker value={it.icon ?? 'Sparkles'} onChange={(icon) => maj(i, { icon })} />}
            {avecChiffre && longueurs.chiffre !== undefined && (
              <Input
                className="w-24 shrink-0"
                value={it.value ?? ''}
                maxLength={longueurs.chiffre}
                aria-label={`${titre} — chiffre ${i + 1}`}
                onChange={(e) => maj(i, { value: e.target.value })}
                placeholder="Ex : 30 s"
              />
            )}
            <Input
              className="min-w-[10rem] flex-1"
              value={it.title ?? ''}
              maxLength={longueurs.titre}
              aria-label={`${titre} — titre ${i + 1}`}
              onChange={(e) => maj(i, { title: e.target.value })}
              placeholder={placeholders.titre}
            />
            <div className="ml-auto flex shrink-0 items-center">
              <Button variant="ghost" size="icon" aria-label={`Monter l’élément ${i + 1}`} disabled={i === 0} onClick={() => bouger(i, -1)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Descendre l’élément ${i + 1}`}
                disabled={i === items.length - 1}
                onClick={() => bouger(i, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Retirer l’élément ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <X className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          </div>
          <Field count={(it.text ?? '').length} max={longueurs.texte}>
            <Input
              value={it.text ?? ''}
              maxLength={longueurs.texte}
              aria-label={`${titre} — explication ${i + 1}`}
              onChange={(e) => maj(i, { text: e.target.value })}
              placeholder={placeholders.texte}
            />
          </Field>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={plein}
          title={plein ? limiteAtteinte(max, quoi) : undefined}
          onClick={() => onChange([...items, { icon: 'Sparkles', value: '', title: '', text: '', order: (items.length + 1) * 10 }])}
        >
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
        {plein && <span className="text-xs text-muted-foreground">{limiteAtteinte(max, quoi)}</span>}
      </div>
    </div>
  );
}
