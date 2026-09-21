import * as React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { SitePageBlock, SitePageBlockItem } from '@/types';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { siteIcon } from '@/lib/siteIcons';
import { Lightbox } from '@/components/Lightbox';
import { cn } from '@/lib/utils';

/**
 * LE RENDU DES BLOCS D'UNE PAGE ÉDITORIALE.
 *
 * ══ LE CONTRAT AVEC L'ÉDITEUR ═══════════════════════════════════════════════
 *
 * Le rédacteur choisit CE QU'IL DIT ; ce fichier décide COMMENT ça se voit.
 * Aucune couleur, aucune police, aucune taille ne remonte de la base : tout
 * dérive des jetons du thème. C'est la seule façon d'obtenir qu'une page
 * saisie par un client ressemble à une page dessinée — et la raison pour
 * laquelle l'éditeur ne propose pas de sélecteur de police.
 *
 * ══ LE HTML EST INJECTÉ TEL QUEL, ET C'EST SÛR ══════════════════════════════
 *
 * `block.html` a été RÉÉCRIT par le serveur à l'écriture
 * (`backend/utils/richText.js`, liste blanche stricte) : ce qui est stocké est
 * déjà sûr. Le refiltrer ici demanderait une seconde bibliothèque, qui
 * divergerait de la première — et c'est toujours la plus permissive des deux
 * qui décide.
 */

/** La largeur de lecture d'un bloc, en trois crans et pas un de plus. */
const LARGEURS: Record<SitePageBlock['width'], string> = {
  // 65–75 caractères par ligne : la colonne de lecture confortable.
  NARROW: 'max-w-3xl',
  WIDE: 'max-w-5xl',
  FULL: 'max-w-6xl',
};

function Enveloppe({
  bloc, children, className,
}: {
  bloc: SitePageBlock;
  children: React.ReactNode;
  className?: string;
}) {
  const sobre = useReducedMotion();
  const contenu = (
    <motion.div
      initial={sobre ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn('mx-auto px-5 md:px-8', LARGEURS[bloc.width] ?? LARGEURS.NARROW, className)}
    >
      {children}
    </motion.div>
  );

  /**
   * LE FOND CONTRASTÉ COURT SUR TOUTE LA LARGEUR, pas seulement sous le texte.
   *
   * Une bande limitée à la colonne de lecture se lit comme un encadré — ce
   * n'est pas ce que le rédacteur demande quand il coche « fond contrasté » :
   * il veut une RESPIRATION dans la page, donc une bande qui traverse.
   */
  if (!bloc.surface) return <section className="py-8 md:py-12">{contenu}</section>;
  return (
    <section className="py-12 md:py-20" style={{ background: 'var(--v-surface)' }}>
      {contenu}
    </section>
  );
}

function TexteRiche({ html }: { html: string }) {
  if (!html?.trim()) return null;
  // eslint-disable-next-line react/no-danger
  return <div className="v-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * LES INITIALES — ce qu'on affiche quand il n'y a pas de portrait.
 *
 * Un membre d'équipe qui ne veut pas de sa photo en ligne est un cas
 * ORDINAIRE, pas une fiche incomplète. Un cadre vide, une silhouette grise ou
 * un avatar générique diraient tous « il manque quelque chose ». Deux
 * initiales dans la couleur d'accent disent « c'est elle », et tiennent la
 * mise en page exactement comme une photographie.
 */
function initiales(nom: string) {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('');
}

function Membre({ membre, inverse }: { membre: SitePageBlockItem; inverse: boolean }) {
  const url = membre.image?.url ? resolvePreviewMediaUrl(membre.image.url) : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="grid items-center gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-14"
    >
      <div className={cn(inverse && 'md:order-2')}>
        {url ? (
          <img
            src={url}
            alt={membre.image?.alt || membre.title || ''}
            loading="lazy"
            className="aspect-[4/5] w-full rounded-2xl border object-cover"
            style={{ borderColor: 'var(--v-border)' }}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border"
            style={{
              borderColor: 'var(--v-border)',
              background: 'var(--v-surface)',
            }}
          >
            <span
              className="text-5xl font-semibold tracking-tight md:text-6xl"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--v-accent)' }}
            >
              {initiales(membre.title ?? '')}
            </span>
          </div>
        )}
      </div>

      <div>
        {membre.role && (
          <p className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: 'var(--v-accent)' }}>
            {membre.role}
          </p>
        )}
        <h3
          className="mt-4 text-3xl font-semibold tracking-[-0.02em] md:text-4xl"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {membre.title}
        </h3>
        <span className="mt-6 block h-px w-12" style={{ background: 'var(--v-accent)' }} />
        {membre.text && (
          <p
            className="mt-6 whitespace-pre-line text-base font-light leading-relaxed"
            style={{ color: 'color-mix(in srgb, var(--v-foreground) 66%, var(--v-background))' }}
          >
            {membre.text}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export function PageBlocks({ blocks }: { blocks: SitePageBlock[] }) {
  /**
   * LA VISIONNEUSE EST UNIQUE POUR TOUTE LA PAGE.
   *
   * Une par bloc « galerie » ouvrirait autant de verrous de défilement
   * concurrents ; la première fermeture rendrait le défilement alors qu'une
   * autre visionneuse serait encore ouverte. On tient donc UN état, qui nomme
   * la galerie ET l'image.
   */
  const [visionneuse, setVisionneuse] = React.useState<{ blocId: string; index: number } | null>(null);

  return (
    <>
      {blocks.map((bloc, i) => {
        const cle = bloc._id ?? `bloc-${i}`;

        switch (bloc.type) {
          /* ── TITRE DE SECTION ────────────────────────────────────────── */
          case 'HEADING':
            return (
              <Enveloppe key={cle} bloc={bloc}>
                {bloc.eyebrow && (
                  <div className="mb-4">
                    <p className="text-sm font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>
                      {bloc.eyebrow}
                    </p>
                    <span className="mt-2 block h-px w-12" style={{ background: 'var(--v-accent)' }} />
                  </div>
                )}
                {bloc.title && <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">{bloc.title}</h2>}
                {bloc.subtitle && <p className="mt-3 text-base text-muted-foreground">{bloc.subtitle}</p>}
              </Enveloppe>
            );

          /* ── TEXTE ───────────────────────────────────────────────────── */
          case 'RICH_TEXT':
            return (
              <Enveloppe key={cle} bloc={bloc}>
                <TexteRiche html={bloc.html} />
              </Enveloppe>
            );

          /* ── IMAGE ───────────────────────────────────────────────────── */
          case 'IMAGE': {
            const url = bloc.image?.url ? resolvePreviewMediaUrl(bloc.image.url) : '';
            if (!url) return null;
            return (
              <Enveloppe key={cle} bloc={bloc}>
                <figure>
                  <img
                    src={url}
                    alt={bloc.image?.alt || ''}
                    loading="lazy"
                    className="w-full rounded-2xl border object-cover"
                    style={{ borderColor: 'var(--v-border)' }}
                  />
                  {bloc.image?.caption && (
                    <figcaption className="mt-2 text-center text-xs text-muted-foreground">
                      {bloc.image.caption}
                    </figcaption>
                  )}
                </figure>
              </Enveloppe>
            );
          }

          /* ── IMAGE + TEXTE ───────────────────────────────────────────── */
          case 'IMAGE_TEXT': {
            const url = bloc.image?.url ? resolvePreviewMediaUrl(bloc.image.url) : '';
            return (
              <Enveloppe key={cle} bloc={bloc}>
                <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
                  {url && (
                    <img
                      src={url}
                      alt={bloc.image?.alt || bloc.title || ''}
                      loading="lazy"
                      className={cn(
                        'w-full rounded-2xl border object-cover',
                        // L'ordre visuel change, l'ordre du DOM ne change pas :
                        // un lecteur d'écran suit toujours titre puis image.
                        bloc.imageSide === 'RIGHT' && 'md:order-2',
                      )}
                      style={{ borderColor: 'var(--v-border)' }}
                    />
                  )}
                  <div className={cn(!url && 'md:col-span-2')}>
                    {bloc.title && <h3 className="mb-3 text-2xl font-extrabold md:text-3xl">{bloc.title}</h3>}
                    <TexteRiche html={bloc.html} />
                  </div>
                </div>
              </Enveloppe>
            );
          }

          /* ── CHIFFRES CLÉS ───────────────────────────────────────────── */
          case 'STATS':
            return (
              <Enveloppe key={cle} bloc={bloc}>
                {(bloc.eyebrow || bloc.title) && (
                  <div className="mb-8 text-center">
                    {bloc.eyebrow && (
                      <p className="text-sm font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>
                        {bloc.eyebrow}
                      </p>
                    )}
                    {bloc.title && <h2 className="mt-2 text-2xl font-extrabold md:text-3xl">{bloc.title}</h2>}
                  </div>
                )}
                {/*
                  DES CHIFFRES POSÉS SUR UNE RANGÉE, séparés par des filets.

                  Pas de tuiles : une grille de cartes ombrées ferait de trois
                  chiffres un tableau de bord. Ici on veut qu'ils se lisent
                  comme une phrase — d'où la rangée, les filets d'un pixel, et
                  le repli centré quand la place manque.
                */}
                <div className="flex flex-wrap justify-center gap-px" style={{ background: 'var(--v-border)' }}>
                  {bloc.items.map((it, j) => {
                    const Icone = siteIcon(it.icon);
                    return (
                      <div
                        key={it._id ?? j}
                        className="flex min-w-[9rem] flex-1 flex-col items-center px-6 py-8 text-center"
                        style={{ background: 'var(--v-background)' }}
                      >
                        <Icone className="h-4 w-4" style={{ color: 'var(--v-accent)' }} />
                        <span
                          className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl"
                          style={{ fontFamily: 'var(--font-heading)' }}
                        >
                          {it.value}
                        </span>
                        {it.text && (
                          <span
                            className="mt-2 text-xs font-light uppercase tracking-[0.14em]"
                            style={{ color: 'color-mix(in srgb, var(--v-foreground) 52%, var(--v-background))' }}
                          >
                            {it.text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Enveloppe>
            );

          /* ── ATOUTS ──────────────────────────────────────────────────── */
          case 'FEATURES':
            return (
              <Enveloppe key={cle} bloc={bloc}>
                {(bloc.eyebrow || bloc.title) && (
                  <div className="mb-8">
                    {bloc.eyebrow && (
                      <p className="text-sm font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>
                        {bloc.eyebrow}
                      </p>
                    )}
                    {bloc.title && <h2 className="mt-2 text-2xl font-extrabold md:text-3xl">{bloc.title}</h2>}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bloc.items.map((it, j) => {
                    const I = siteIcon(it.icon);
                    return (
                      <motion.div
                        key={it._id ?? j}
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.5, delay: j * 0.06 }}
                        className="rounded-2xl border p-5"
                        style={{ borderColor: 'var(--v-border)' }}
                      >
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-xl"
                          style={{ background: 'color-mix(in srgb, var(--v-accent) 16%, transparent)', color: 'var(--v-accent)' }}
                        >
                          <I className="h-5 w-5" aria-hidden="true" />
                        </span>
                        {it.title && <h3 className="mt-4 font-bold">{it.title}</h3>}
                        {it.text && <p className="mt-1 text-sm text-muted-foreground">{it.text}</p>}
                      </motion.div>
                    );
                  })}
                </div>
              </Enveloppe>
            );

          /* ── CITATION ────────────────────────────────────────────────── */
          case 'QUOTE':
            if (!bloc.text?.trim()) return null;
            return (
              <Enveloppe key={cle} bloc={bloc}>
                <blockquote
                  className="border-l-4 pl-6 text-xl font-medium italic leading-relaxed md:text-2xl"
                  style={{ borderColor: 'var(--v-accent)' }}
                >
                  « {bloc.text} »
                  {/*
                    L'ATTRIBUTION SE MARQUE PAR UN FILET, plus par un tiret.

                    Le tiret cadratin est la convention typographique d'une
                    citation, mais le site n'en veut plus nulle part : un seul
                    survivant se remarque plus qu'aucun. Un trait à l'accent
                    dit la même chose, et le dit mieux.
                  */}
                  {bloc.author && (
                    <footer className="mt-3 flex items-center gap-3 text-sm font-normal not-italic text-muted-foreground">
                      <span className="h-px w-6 shrink-0" style={{ background: 'var(--v-accent)' }} />
                      {bloc.author}
                    </footer>
                  )}
                </blockquote>
              </Enveloppe>
            );

          /* ── APPEL À L'ACTION ────────────────────────────────────────── */
          case 'CTA': {
            const externe = /^https?:\/\//i.test(bloc.buttonUrl ?? '');
            const bouton = bloc.buttonLabel && bloc.buttonUrl && (
              <span
                className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-base font-semibold transition-all hover:opacity-90 hover:shadow-lg active:scale-[0.98]"
                style={{ background: 'var(--v-accent)', color: 'var(--v-accent-foreground)' }}
              >
                {bloc.buttonLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            );
            return (
              <Enveloppe key={cle} bloc={bloc}>
                <div
                  className="relative overflow-hidden rounded-3xl border px-8 py-12 text-center md:py-16"
                  style={{ background: 'var(--v-surface)', borderColor: 'var(--v-border)' }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full blur-3xl"
                    style={{ background: 'var(--v-accent)', opacity: 0.16 }}
                  />
                  <div className="relative">
                    {bloc.title && <h2 className="text-2xl font-extrabold md:text-3xl">{bloc.title}</h2>}
                    {bloc.subtitle && <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{bloc.subtitle}</p>}
                    {bouton && (
                      <div className="mt-8">
                        {/*
                          Un lien INTERNE passe par le routeur : recharger la
                          page entière pour aller de /presentation à /contact
                          rejouerait le bootstrap et l'écran de chargement.
                        */}
                        {externe ? (
                          <a href={bloc.buttonUrl} target="_blank" rel="noreferrer">{bouton}</a>
                        ) : (
                          <Link to={bloc.buttonUrl}>{bouton}</Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Enveloppe>
            );
          }

          /* ── GALERIE ─────────────────────────────────────────────────── */
          case 'GALLERY': {
            const urls = bloc.images.map((im) => resolvePreviewMediaUrl(im.url)).filter(Boolean);
            if (!urls.length) return null;
            return (
              <Enveloppe key={cle} bloc={bloc}>
                {bloc.title && <h2 className="mb-6 text-2xl font-extrabold md:text-3xl">{bloc.title}</h2>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {bloc.images.map((im, j) => {
                    const url = resolvePreviewMediaUrl(im.url);
                    if (!url) return null;
                    return (
                      <motion.button
                        key={im._id ?? j}
                        type="button"
                        onClick={() => setVisionneuse({ blocId: cle, index: j })}
                        initial={{ opacity: 0, scale: 0.96 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.45, delay: (j % 6) * 0.05 }}
                        className="group relative aspect-[4/3] overflow-hidden rounded-xl border"
                        style={{ borderColor: 'var(--v-border)' }}
                        aria-label={im.caption || `Photo ${j + 1}`}
                      >
                        <img
                          src={url}
                          alt={im.alt || im.caption || ''}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        {im.caption && (
                          <span
                            className="absolute inset-x-0 bottom-0 translate-y-full px-2 py-1.5 text-left text-[11px] transition-transform duration-300 group-hover:translate-y-0"
                            style={{ background: 'color-mix(in srgb, var(--v-background) 80%, transparent)' }}
                          >
                            {im.caption}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                <Lightbox
                  images={urls}
                  index={visionneuse?.blocId === cle ? visionneuse.index : null}
                  onClose={() => setVisionneuse(null)}
                  onIndexChange={(index) => setVisionneuse({ blocId: cle, index })}
                />
              </Enveloppe>
            );
          }

          /* ── L'ÉQUIPE ────────────────────────────────────────────────── */
          case 'TEAM': {
            const membres = bloc.items.filter((it) => it.title?.trim());
            if (!membres.length) return null;
            return (
              <Enveloppe key={cle} bloc={bloc}>
                {(bloc.eyebrow || bloc.title) && (
                  <div className="mb-12 md:mb-16">
                    {bloc.eyebrow && (
                      <p className="text-sm font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--v-accent)' }}>
                        {bloc.eyebrow}
                      </p>
                    )}
                    {bloc.title && <h2 className="mt-2 text-2xl font-extrabold md:text-3xl">{bloc.title}</h2>}
                  </div>
                )}
                {/*
                  UNE PERSONNE PAR RANGÉE, et le portrait CHANGE DE CÔTÉ.

                  L'alternance n'est pas un ornement : elle marque la frontière
                  entre deux personnes mieux qu'un filet ne le ferait. Quatre
                  portraits alignés à gauche se lisent comme un tableau du
                  personnel ; alternés, ils se lisent un par un.
                */}
                <div className="space-y-16 md:space-y-24">
                  {membres.map((m, j) => (
                    <Membre key={m._id ?? j} membre={m} inverse={j % 2 === 1} />
                  ))}
                </div>
              </Enveloppe>
            );
          }

          default:
            /**
             * UN TYPE INCONNU NE REND RIEN — et ne casse pas la page.
             *
             * Le cas n'arrive que si la base porte un bloc écrit par une
             * version plus récente du Manager. Afficher un avertissement le
             * montrerait aux VISITEURS, ce qui est pire que l'absence.
             */
            return null;
        }
      })}
    </>
  );
}
