import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { DeviceShowcase, type ShowcaseContent } from './DeviceShowcase';

/**
 * LA BANNIÈRE D'ACCUEIL — source UNIQUE, partagée avec le Manager.
 *
 * ══ POURQUOI CE FICHIER EXISTE ══════════════════════════════════════════════
 *
 * Le Manager affichait autrefois une « simulation accueil » écrite à la main,
 * qui ne ressemblait pas à la vraie. Personne ne l'avait cassée : elle n'a
 * jamais suivi. Deux dessins séparés qui prétendent montrer la même chose
 * divergent au premier changement, et rien ne le signale : un aperçu faux est
 * pire que pas d'aperçu, puisqu'on décide en le regardant.
 *
 * Ce composant est donc rendu par la vitrine ET par le Manager. Retoucher la
 * bannière ici, c'est la retoucher aux deux endroits, par construction.
 *
 * ══ DEUX ÉTAGES, ET C'EST LA CORRECTION DE CE LOT ═══════════════════════════
 *
 * ── CE QUI PRÉCÉDAIT, ET POURQUOI C'ÉTAIT FAUX ───────────────────────────
 *
 * La photographie était le FOND de toute la bannière : elle passait derrière
 * le titre, le sous-titre, les boutons, les rassurances ET la maquette. Pour
 * que ces cinq textes restent lisibles, il fallait la recouvrir presque
 * partout. Le propriétaire téléversait une image et ne la voyait pas.
 *
 * Le réglage n'était pas en cause : la STRUCTURE l'était. Une image qui sert
 * de fond à une colonne de texte ne peut pas être vue.
 *
 * ── CE QUE FAIT LA BANNIÈRE MAINTENANT ───────────────────────────────────
 *
 *   1. UN BANDEAU en haut de page, où la photographie s'affiche À SA HAUTEUR
 *      NATURELLE, sans recadrage, et se voit pleinement.
 *   2. LE SUR-TITRE et LE TITRE posés en bas de ce bandeau, sur une OMBRE
 *      douce et à moitié transparente qui suit la zone de texte au lieu de
 *      couvrir l'image.
 *   3. UN FONDU en bas de l'image, et seulement là, qui la raccorde à la
 *      couleur de la page sans arête.
 *   4. EN DESSOUS, sur le fond uni, le sous-titre, les deux boutons, les
 *      rassurances, et la maquette d'appareils.
 *
 * Un seul texte reste donc superposé à la photographie : l'en-tête, protégé
 * par son ombre. Tous les autres sont sur le fond de la page.
 *
 * ── SANS IMAGE, LE BANDEAU N'EXISTE PAS ──────────────────────────────────
 *
 * Il ne devient pas une bande vide : le titre reprend simplement sa place en
 * haut de la page, sur le fond du thème. Un projet qui n'a pas encore
 * téléversé d'image ne doit pas voir un rectangle en attente.
 *
 * ══ LE TEXTE S'ÉDITE, ET C'EST LE POINT ════════════════════════════════════
 *
 * Un argumentaire se RÉÉCRIT : on change un verbe, on déplace une preuve, on
 * essaie un autre appel à l'action. Tout ce qui est affiché ici vient donc de
 * `HomeContent`, éditable depuis le Manager. Le figer dans le code, c'est
 * décider qu'il ne sera jamais essayé, et le reprocher aux agences en le
 * faisant soi-même.
 *
 * ══ CE QUI ENTRE, ET CE QUI EST DE REPLI ════════════════════════════════════
 *
 * `hero` et `showcase` portent le contenu éditorial. `name` et `tagline`
 * restent des REPLIS : c'est ce qui permet à l'écran « Informations » du
 * Manager de montrer honnêtement l'effet du nom et de l'image, sans avoir à
 * charger le contenu d'accueil qu'un autre écran édite.
 *
 * ══ LES TROIS RÈGLES D'UN COMPOSANT PARTAGÉ ═════════════════════════════════
 *
 *   · AUCUN import en `@/…` — l'alias pointe sur `src` de CHAQUE application ;
 *     il désignerait deux fichiers différents selon qui compile. Les imports
 *     relatifs (`./DeviceShowcase`) et les paquets (`framer-motion`,
 *     `lucide-react`, présents des deux côtés) sont en revanche sûrs ;
 *   · AUCUN contexte, AUCUN appel réseau — tout entre par les props, y compris
 *     l'adresse de l'image, déjà résolue par l'appelant ;
 *   · AUCUNE couleur de Tailwind (`bg-background`…) — ces noms sont câblés sur
 *     `--m-*` dans le Manager et sur `--v-*` dans la vitrine.
 */

export interface HeroCopy {
  kicker?: string;
  title?: string;
  subtitle?: string;
  primaryLabel?: string;
  primaryUrl?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
  proofs?: { _id?: string; text?: string }[];
  /** Adresse DÉJÀ RÉSOLUE de l'image de bandeau. Prime sur `imageUrl`. */
  image?: string;
}

/**
 * LE LIEN EST FOURNI PAR L'APPELANT — la vitrine passe un `<Link>`, le Manager
 * un `<span>`.
 *
 * `react-router-dom` est présent dans les deux applications, mais leurs
 * routeurs ne le sont pas : un `<Link>` rendu dans le Manager hors de SON
 * routeur lève. Et un aperçu n'a de toute façon rien à faire de cliquable.
 */
export type RenduLien = (props: {
  to: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) => React.ReactElement;

const lienInerte: RenduLien = ({ className, style, children }) => (
  <span className={className} style={style}>{children}</span>
);

/**
 * UN FONDU, ET UNE OMBRE — deux calques, parce qu'ils font deux métiers.
 *
 * ══ CE QU'UN SEUL CALQUE PRODUISAIT ════════════════════════════════════════
 *
 * Le même dégradé devait raccorder le bandeau à la page ET rendre le titre
 * lisible. Le second rôle exige de la densité ; il fallait donc le rendre
 * opaque haut dans l'image, et il en cachait un tiers. Ce n'était plus un
 * fondu, c'était un bloc noir posé sur la photographie.
 *
 * ══ CE QUE CHACUN FAIT MAINTENANT ══════════════════════════════════════════
 *
 * LE FONDU ne raccorde plus que le BAS de l'image à la couleur de la page :
 * rien sur les trois quarts du haut, la couleur pleine sur le dernier quart.
 * C'est la transition demandée, et elle a lieu là où on l'attend.
 *
 * L'OMBRE est une ellipse douce posée derrière la seule zone de texte. Elle
 * culmine à 58 % et s'éteint avant ses bords : on ne voit pas où elle
 * s'arrête, ce qui est la différence entre une ombre et un rectangle.
 *
 * ══ CE QUE CELA COÛTE, ET QUI L'A ARBITRÉ ══════════════════════════════════
 *
 * Une ombre à moitié transparente ne garantit plus le seuil AA sur une
 * photographie claire : le calcul donne, sur un fond `#0a0a0a`, une valeur de
 * (1 - d) x 255 pour un pixel blanc recouvert à la densité d. À 58 % cela
 * fait rgb(107), soit 4,82:1 pour un texte clair — suffisant — mais la
 * couleur d'ACCENT, elle, n'y atteindrait que 1,3:1.
 *
 * C'est pourquoi le sur-titre passe au premier plan CLAIR quand il est posé
 * sur l'image, et ne reprend l'accent que sans photographie. La demande était
 * explicite et répétée : une ombre, pas un bloc. On tient donc la lisibilité
 * par la couleur du texte, puisqu'on ne peut plus la tenir par le fond.
 *
 * ATTENTION : ce commentaire ne vit PAS dans un litteral gabarit, mais la
 * feuille juste en dessous, si. Aucun accent grave a l'interieur de celle-ci.
 */
const BANDEAU_CSS = `
/*
  ══ DEUX CALQUES, ET PLUS UN SEUL ═══════════════════════════════════════
  ATTENTION : aucun accent grave dans ce commentaire, litteral gabarit.

  Un unique degrade devait a la fois raccorder le bandeau a la page ET rendre
  le titre lisible. Pour le second role il fallait le rendre opaque haut dans
  l'image, et il finissait par en cacher un tiers : un gros bloc noir plutot
  qu'un fondu.

  Les deux roles sont donc separes.

  LE FONDU ne fait plus que raccorder, et il le fait VRAIMENT EN BAS de
  l'image : rien sur les trois quarts du haut, puis la couleur de la page sur
  le dernier quart.

  L'OMBRE est une ellipse douce posee derriere la seule zone de texte, a
  moitie transparente et sans arete. Elle suit le bloc de titre au lieu de
  couvrir le bandeau.
*/
.lyhero-fondu {
  background: linear-gradient(to bottom,
    transparent 0%,
    transparent 74%,
    color-mix(in srgb, var(--v-background) 38%, transparent) 88%,
    var(--v-background) 100%);
}
/*
  L'OMBRE COUVRE TOUTE LA CELLULE, et c'est ce qui la rend invisible.

  Elle etait posee sur une boite calee au bloc de titre. Le degrade n'avait
  pas fini de s'eteindre en atteignant les bords de cette boite : on voyait
  donc une couture horizontale et une couture verticale, c'est-a-dire un
  rectangle, exactement ce qu'une ombre ne doit pas etre.

  Elle occupe desormais la cellule entiere, et l'ellipse est centree sur la
  zone de texte. Elle s'eteint AVANT les bords du haut et de la droite ; en
  bas, la ou elle est encore dense, c'est le fondu qui prend le relais, donc
  aucune couture ne peut s'y voir.
*/
.lyhero-ombre {
  background: radial-gradient(ellipse 84% 56% at 28% 86%,
    color-mix(in srgb, var(--v-background) 58%, transparent) 0%,
    color-mix(in srgb, var(--v-background) 46%, transparent) 44%,
    color-mix(in srgb, var(--v-background) 20%, transparent) 74%,
    transparent 100%);
}
/*
  LE HALO DU TEXTE — ce qui rend lisible SANS assombrir la photographie.

  Une ombre a moitie transparente ne peut pas garantir le seuil de contraste
  sur une image claire : mesure sur une banniere entierement blanche, le
  sur-titre tombait a 1,17:1. Le densifier assez pour y remedier reviendrait
  au bloc opaque qu'on vient de retirer.

  Le halo regle le cas autrement : il epaissit le fond IMMEDIATEMENT autour
  des lettres, la ou le contraste se joue reellement, et laisse le reste de
  l'image intact. C'est la technique faite pour le texte sur photographie.
*/
.lyhero-texte {
  text-shadow:
    0 0 2px color-mix(in srgb, var(--v-background) 96%, transparent),
    0 1px 4px color-mix(in srgb, var(--v-background) 92%, transparent),
    0 2px 16px color-mix(in srgb, var(--v-background) 86%, transparent),
    0 0 36px color-mix(in srgb, var(--v-background) 72%, transparent);
}
@media (max-width: 767px) {
  /*
    TELEPHONE : le titre est passe SOUS l'image. Il n'y a donc plus rien a
    ombrer, et une ombre posee sur le fond de page ne ferait qu'y creer une
    tache. Le fondu, lui, garde son unique role.
  */
  .lyhero-ombre { background: none; }
}
`;

export function HeroBanner({
  imageUrl,
  name,
  tagline,
  animate = true,
  titleAs = 'h1',
  kicker,
  hero,
  showcase,
  imageWidth,
  imageHeight,
  renderLink = lienInerte,
}: {
  /** Adresse déjà résolue — ce composant ne sait pas résoudre un média. */
  imageUrl?: string | null;
  name: string;
  tagline?: string | null;
  /** Coupé dans un aperçu : rejouer la scène à chaque frappe est insupportable. */
  animate?: boolean;
  /** `h1` sur la page d'accueil ; `p` dans un aperçu, qui n'est pas la page. */
  titleAs?: 'h1' | 'p';
  /** Le filet au-dessus du titre. Repli quand `hero.kicker` est vide. */
  kicker?: string | null;
  hero?: HeroCopy | null;
  showcase?: ShowcaseContent | null;
  /** Dimensions NATURELLES de l image de bandeau, pour reserver sa place. */
  imageWidth?: number | null;
  imageHeight?: number | null;
  renderLink?: RenduLien;
}) {
  const Titre = titleAs;
  const Lien = renderLink;

  const surTitre = hero?.kicker?.trim() || kicker || '';
  const titre = hero?.title?.trim() || name;
  const sousTitre = hero?.subtitle?.trim() || tagline || '';
  const preuves = (hero?.proofs ?? []).filter((p) => p?.text?.trim());

  /**
   * L'IMAGE DU BANDEAU — celle choisie ici prime sur celle de la fiche
   * entreprise, qui reste lue pour les projets du parc qui l'ont renseignée.
   */
  const fond = hero?.image?.trim() || imageUrl || '';

  const principal = hero?.primaryLabel?.trim();
  const secondaire = hero?.secondaryLabel?.trim();

  /* ── L'EN-TÊTE : sur-titre et titre, ensemble partout où ils vont ─────── */
  const enTete = (
    <>
      {surTitre && (
        <p
          className={`mb-5 text-xs font-semibold uppercase tracking-[0.32em] ${fond ? 'lyhero-texte' : ''}`}
          /*
            L'ACCENT NE TIENT PAS SUR UNE PHOTOGRAPHIE, et c'est arithmétique.

            Sa luminance est telle qu'il plafonne à 4,22:1 sur le fond de page
            lui-même. Derrière une ombre à moitié transparente posée sur une
            image claire, il tombe à 1,3:1 : illisible, et aucun réglage
            d'ombre ne le rattrape sans redevenir le bloc opaque qu'on vient
            de retirer.

            Sur l'image, le sur-titre passe donc au premier plan clair, qui y
            atteint 4,82:1. Sans photographie il reprend l'accent, où celui-ci
            est chez lui.
          */
          style={{ color: fond ? 'var(--v-foreground)' : 'var(--v-accent)' }}
        >
          {surTitre}
        </p>
      )}
      <div>
        <Titre
          className={`max-w-3xl text-[2.1rem] font-semibold leading-[1.06] tracking-[-0.03em] sm:text-5xl md:text-6xl ${fond ? 'lyhero-texte' : ''}`}
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {titre}
        </Titre>
      </div>
    </>
  );

  return (
    <section className="relative" style={{ background: 'var(--v-background)' }}>
      {fond ? (
        /* ══ ÉTAGE 1 : LE BANDEAU, À LA HAUTEUR NATURELLE DE LA PHOTO ══════
           ══ CE QUI A CHANGÉ, ET POURQUOI ═══════════════════════════════════

           Le bandeau avait une hauteur imposée et l'image la remplissait en
           `object-cover` : elle était donc RECADRÉE. Sur une photographie de
           2:1 affichée dans une bande de 62 % de la fenêtre, on en perdait le
           haut et le bas. Le propriétaire choisit son cadrage en amont ; le
           site n'a pas à en redécouper un autre.

           L'image est désormais en flux normal, pleine largeur et hauteur
           AUTO : c'est elle qui donne sa hauteur au bandeau, et on la voit en
           entier.

           ══ POURQUOI UNE GRILLE À UNE SEULE CELLULE ════════════════════════

           Le titre doit se superposer au bas de l'image, mais l'image n'a plus
           de hauteur connue : un positionnement absolu classique ne peut donc
           plus s'y accrocher. Image et calque partagent la MÊME cellule de
           grille ; la cellule prend la hauteur du plus grand des deux.

           C'est aussi ce qui sauve le cas d'une image très large sur un écran
           étroit : un cliché 2:1 ne fait que 195 px de haut sur un portable de
           390 px, moins que le titre. La cellule grandit alors pour le titre,
           l'image reste en haut à sa taille réelle, et le fondu raccorde les
           deux sans qu'on voie une couture. */
        <div className="relative grid">
          <style>{BANDEAU_CSS}</style>
          <img
            src={fond}
            alt=""
            fetchPriority="high"
            decoding="async"
            /**
             * LES DIMENSIONS RÉSERVENT LA PLACE — et c'est ce qui supprime le
             * saut au chargement.
             *
             * ══ LE DÉFAUT ═══════════════════════════════════════════════════
             * L'image est en hauteur AUTO : tant qu'elle n'est pas téléchargée,
             * elle n'occupe rien. Le bandeau ne faisait donc que la hauteur du
             * titre, qui s'affichait tout en haut ; puis l'image arrivait, la
             * cellule passait d'un coup à sept cents pixels, le titre était
             * repoussé et l'ombre repeinte. Vu de l'écran : « le texte
             * disparaît puis réapparaît avec un fond noir ».
             *
             * ══ LA CORRECTION ═══════════════════════════════════════════════
             * `width` et `height` donnent au navigateur le rapport d'image
             * AVANT le premier octet : il réserve la boîte, et plus rien ne
             * bouge. Ces deux nombres viennent du descripteur du média, que le
             * backend publie déjà — on ne les devine pas.
             */
            width={imageWidth || undefined}
            height={imageHeight || undefined}
            className="col-start-1 row-start-1 h-auto w-full self-start"
          />
          {/* L'ombre douce, sous le texte, posée sur toute la cellule pour
              n'avoir aucun bord à révéler. */}
          <div className="lyhero-ombre pointer-events-none col-start-1 row-start-1" />
          {/* Le fondu qui raccorde le BAS de l'image à la couleur de la page. */}
          <div className="lyhero-fondu pointer-events-none col-start-1 row-start-1" />
          {/* Le titre se pose EN BAS du bandeau, donc sur la partie opaque du
              fondu : il est lisible sans qu'on ait à voiler la photographie. */}
          {/*
            AUCUN GRAND RETRAIT EN HAUT, et c'est ce qui découvre la
            photographie.

            Le bloc portait `pt-32 md:pt-40` pour dégager l'en-tête fixe. Mais
            il est ancré EN BAS : ce retrait ne le descendait pas, il gonflait
            sa hauteur, et le fondu devait donc devenir opaque bien plus haut
            pour le couvrir. Sur une image de 715 px, il en masquait près de la
            moitié. Sans lui, le titre tient dans le dernier tiers, et les deux
            premiers tiers de la photographie restent visibles.
          */}
          {/*
            ══ SUR TÉLÉPHONE, LE TITRE PASSE SOUS L'IMAGE ═══════════════════

            Une photographie 2:1 ne fait que 190 px de haut sur un écran de
            390 px, et le titre en réclame autant. Le superposer reviendrait à
            recouvrir la totalité de la photographie d'un fondu opaque, c'est-à-
            dire à ne plus la montrer du tout : l'inverse exact de ce qu'un
            bandeau est censé faire.

            Le titre prend donc la ligne SUIVANTE de la grille en dessous de
            768 px, et revient se superposer au-dessus, là où l'image est assez
            haute pour l'accueillir sans disparaître.
          */}
          <div className="col-start-1 row-start-2 flex items-end md:row-start-1">
            <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-7 md:px-8 md:pb-5 md:pt-0">
              {enTete}
            </div>
          </div>
        </div>
      ) : (
        /* Sans image, pas de bande vide : le titre prend sa place en haut de
           page, sur le fond du thème. */
        <div className="mx-auto w-full max-w-7xl px-5 pb-4 pt-32 md:px-8 md:pb-6 md:pt-40">
          {enTete}
        </div>
      )}

      {/* ══ ÉTAGE 2 : la parole et la démonstration, sur le fond de la page ══ */}
      <div className="mx-auto w-full max-w-7xl px-5 pb-16 pt-10 md:px-8 md:pb-20 md:pt-12">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          <div className="max-w-2xl">
            {sousTitre && (
              <motion.p
                initial={animate ? { opacity: 0, y: 20 } : false}
                animate={animate ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.8, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-xl text-base font-light leading-relaxed md:text-lg"
                style={{ color: 'color-mix(in srgb, var(--v-foreground) 74%, var(--v-background))' }}
              >
                {sousTitre}
              </motion.p>
            )}

            {/*
              LES DEUX BOUTONS N'ONT PAS LE MÊME POIDS, et c'est la règle.

              Deux appels à l'action de même intensité se neutralisent : le
              visiteur arbitre au lieu d'agir. Le principal est plein, le
              second n'est qu'un filet. Le second disparaît entièrement si son
              libellé est vide : jamais un bouton fantôme.
            */}
            {(principal || secondaire) && (
              <motion.div
                initial={animate ? { opacity: 0, y: 18 } : false}
                animate={animate ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.8, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="mt-9 flex flex-wrap items-center gap-3"
              >
                {principal && (
                  <Lien
                    to={hero?.primaryUrl || '/contact'}
                    className="inline-flex min-h-[48px] items-center gap-2.5 px-7 py-3.5 text-sm font-semibold transition-transform duration-300 hover:-translate-y-0.5"
                    style={{
                      background: 'var(--v-accent)',
                      color: 'var(--v-accent-foreground)',
                      borderRadius: 'var(--v-radius)',
                    }}
                  >
                    {principal}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Lien>
                )}
                {secondaire && (
                  <Lien
                    to={hero?.secondaryUrl || '/'}
                    className="inline-flex min-h-[48px] items-center px-6 py-3.5 text-sm font-medium transition-colors"
                    style={{
                      border: '1px solid var(--v-border)',
                      color: 'var(--v-foreground)',
                      borderRadius: 'var(--v-radius)',
                    }}
                  >
                    {secondaire}
                  </Lien>
                )}
              </motion.div>
            )}

            {preuves.length > 0 && (
              <motion.ul
                initial={animate ? { opacity: 0 } : false}
                animate={animate ? { opacity: 1 } : undefined}
                transition={{ duration: 0.8, delay: 0.24 }}
                className="mt-8 flex flex-wrap gap-x-6 gap-y-3"
              >
                {preuves.map((p, i) => (
                  <li
                    key={p._id ?? i}
                    className="flex items-center gap-2 text-[13px] font-medium"
                    style={{ color: 'color-mix(in srgb, var(--v-foreground) 62%, var(--v-background))' }}
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--v-accent)' }} aria-hidden="true" />
                    {p.text}
                  </li>
                ))}
              </motion.ul>
            )}
          </div>

          {/* ── LA DÉMONSTRATION ───────────────────────────────────────── */}
          <motion.div
            initial={animate ? { opacity: 0, y: 30 } : false}
            animate={animate ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 1, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <DeviceShowcase content={showcase ?? {}} animate={animate} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
