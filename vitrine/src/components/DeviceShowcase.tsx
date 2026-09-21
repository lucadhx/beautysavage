import * as React from 'react';

/**
 * UN ORDINATEUR ET UN TÉLÉPHONE, montrant le MÊME site — la preuve, pas l'idée.
 *
 * ══ CE QUE CE COMPOSANT REMPLACE, ET POURQUOI ═══════════════════════════════
 *
 * L'accueil montrait un monolithe en fil de fer qui tournait sur une grille en
 * perspective. C'était beau, et illisible : un visiteur qui cherche « est-ce
 * que ces gens peuvent me faire un site » regardait un cube. On lui demandait
 * de traduire une métaphore d'architecture en compétence commerciale, debout,
 * en trois secondes, avant d'avoir lu une ligne.
 *
 * Ici il voit un site. Sur un écran d'ordinateur, et sur un téléphone, avec la
 * même chose dessus adaptée aux deux. La question « et sur mobile, ça donne
 * quoi ? » — que tout prospect pose — trouve sa réponse avant d'être posée.
 *
 * ══ POURQUOI LE FAUX SITE EST CLAIR ALORS QUE LA VITRINE EST SOMBRE ═════════
 *
 * Parce qu'un écran allumé est clair. Peindre la maquette avec la palette de
 * la page l'y aurait dissoute : on aurait vu un cadre, pas un écran. Le
 * contraste EST l'effet — c'est ce qui fait lire « voici un site » plutôt que
 * « voici une illustration ».
 *
 * L'ACCENT, lui, reste celui du thème : les boutons du faux site portent la
 * couleur du vrai. La maquette appartient donc visiblement à cette page, sans
 * se confondre avec elle.
 *
 * ══ TOUT LE TEXTE VIENT DES PROPS ═══════════════════════════════════════════
 *
 * Le métier montré est un ARGUMENT commercial : selon qu'on démarche des
 * restaurateurs ou des artisans, la maquette doit dire « Réserver une table »
 * ou « Demander un devis ». Cela s'édite au Manager et ne peut pas dépendre
 * d'un déploiement. Le DESSIN, lui, reste ici : châssis, proportions, ombres.
 *
 * ══ LES TROIS RÈGLES D'UN COMPOSANT PARTAGÉ ═════════════════════════════════
 *
 * Ce fichier est lu par la vitrine ET par le Manager (aperçu de l'écran
 * « Accueil »). Il ne doit donc jamais enfreindre, comme `HeroBanner` :
 *
 *   · AUCUN import en `@/…` — l'alias désigne un dossier différent de chaque
 *     côté ;
 *   · AUCUN contexte, AUCUN appel réseau — tout entre par les props, y compris
 *     l'adresse de l'image, déjà résolue par l'appelant ;
 *   · AUCUNE couleur de Tailwind — ces noms sont câblés sur `--m-*` dans le
 *     Manager et sur `--v-*` dans la vitrine.
 *
 * C'est aussi pourquoi les keyframes voyagent dans une balise `<style>` posée
 * par le composant : la vitrine a `index.css`, le Manager ne l'a pas.
 *
 * ══ L'ÉCHELLE SUIT LE CONTENEUR, PAS LA FENÊTRE ═════════════════════════════
 *
 * Tout l'intérieur est dimensionné en `em`, et la taille de police de la scène
 * est exprimée en `cqw` — pourcentage de la largeur du CONTENEUR. La maquette
 * se réduit donc proportionnellement, texte compris, qu'elle occupe la moitié
 * d'une bannière ou toute la largeur d'un téléphone.
 *
 * Une échelle en `vw` aurait suivi la FENÊTRE : dans l'aperçu étroit du
 * Manager, la maquette aurait débordé de son cadre alors que la fenêtre, elle,
 * était large. Le repli en `vw` est déclaré d'abord, pour les moteurs sans
 * requêtes de conteneur ; ceux qui les comprennent écrasent la ligne suivante.
 */

export interface ShowcaseCard {
  _id?: string;
  title?: string;
  text?: string;
}

export interface ShowcaseContent {
  browserUrl?: string;
  siteName?: string;
  navItems?: string[];
  headline?: string;
  subline?: string;
  ctaLabel?: string;
  badge?: string;
  cards?: ShowcaseCard[];
  /** Adresse DÉJÀ RÉSOLUE. Absente, la bannière du faux site est un dégradé. */
  image?: string | null;
}

/**
 * LA PALETTE DU FAUX SITE — fixe, et c'est ce qui en fait un écran.
 *
 * Seul l'accent est emprunté au thème. Les autres valeurs décrivent du papier
 * blanc et de l'encre : les changer avec le thème ferait disparaître l'écran
 * dans la page au premier thème clair.
 */
const PAPIER = {
  fond: '#ffffff',
  fondDoux: '#f5f6f8',
  encre: '#12141a',
  encreDouce: '#6b7280',
  filet: '#e6e8ec',
};

const SCENE_CSS = `
/*
  L'ECHELLE EST CALEE SUR CE QUE LA DALLE PEUT CONTENIR.

  ATTENTION : ce commentaire vit DANS un litteral gabarit. Aucun accent grave
  ici, jamais : il fermerait la chaine, et le fichier cesserait de compiler
  pour une note de bas de page. La prose commentee de ce projet en met
  partout ; c'est le seul endroit du depot ou elle ne peut pas.

  LE DEFAUT REPARE. Le faux site a gagne une barre utilitaire et trois
  vignettes. Le contenu, mesure en em, a donc grandi ; la dalle, elle, est un
  rapport 16/10 de la LARGEUR et n'a pas bouge. Les tuiles du bas se
  faisaient couper de treize a vingt-sept pixels selon la largeur, en
  silence, la dalle masquant ce qui deborde.

  Rogner les marges une a une ne reglait rien : le debordement est
  PROPORTIONNEL, donc c'est le rapport qui doit changer. Descendre de 2,05 a
  1,85 pour cent de la largeur du conteneur reduit le contenu d'un dixieme
  sans toucher a la dalle, et rend la meme marge a toutes les largeurs.

  Le plancher passe de 5,5 a 5 px pour la meme raison : sous 250 px de
  conteneur, il devenait contraignant et le contenu cessait de suivre.
*/
.lydev-scene {
  /* Repli pour les moteurs sans requêtes de conteneur. */
  font-size: clamp(5px, 1.35vw, 10px);
}
@supports (container-type: inline-size) {
  .lydev-wrap { container-type: inline-size; }
  .lydev-scene { font-size: clamp(5px, 1.85cqw, 10.5px); }
}
@keyframes lydev-flotte {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-0.9em); }
}
@keyframes lydev-flotte-tel {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.6em); }
}
@keyframes lydev-halo {
  0%, 100% { opacity: 0.30; }
  50%      { opacity: 0.55; }
}
.lydev-ordi { animation: lydev-flotte 9s ease-in-out infinite; }
.lydev-tel  { animation: lydev-flotte-tel 9s ease-in-out infinite 1.1s; }
.lydev-halo { animation: lydev-halo 11s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .lydev-ordi, .lydev-tel, .lydev-halo { animation: none; }
}
`;

/* ── Les images du faux site ──────────────────────────────────────────────── */

/**
 * DES PHOTOGRAPHIES COMPOSÉES EN CSS — et pourquoi pas de vraies images.
 *
 * ══ CE QUE LA MAQUETTE MONTRAIT AVANT ═══════════════════════════════════════
 *
 * Un seul aplat dégradé, à droite de la bannière. Les trois tuiles n'avaient
 * qu'un petit trait de couleur. C'était propre, et ça ne ressemblait pas à un
 * site : aucun site de restaurant, d'artisan ou de boutique ne se passe de
 * photographies, et leur absence était le détail qui trahissait la maquette.
 *
 * ══ POURQUOI ELLES NE SONT PAS DE VRAIES PHOTOS ═════════════════════════════
 *
 * Deux raisons, et la seconde suffirait. D'abord ce fichier est lu par le
 * Manager autant que par la vitrine : il ne peut charger aucune ressource
 * externe sans qu'une des deux applications se retrouve avec une image
 * manquante. Ensuite, embarquer quatre photographies en `data:` alourdirait
 * de plusieurs centaines de kilo-octets la première image de la page d'accueil,
 * c'est-à-dire la mesure même que ce site promet de soigner.
 *
 * À la taille où elles s'affichent, entre soixante et cent-vingt pixels, une
 * composition de dégradés se lit comme une photographie : l'œil y voit une
 * matière et une lumière, pas des formes. Chaque tuile reçoit une composition
 * DIFFÉRENTE, tirée de son rang, parce que quatre fois la même trahirait le
 * procédé aussi sûrement que l'absence d'images.
 *
 * La photographie que le propriétaire téléverse, elle, est bien réelle : elle
 * remplace la composition dans la bannière du faux site.
 */
/**
 * CE QUI FAIT QU'UN DÉGRADÉ SE LIT COMME UNE PHOTOGRAPHIE.
 *
 * Trois choses, et il en manquait deux à la première version : une SOURCE DE
 * LUMIÈRE franche d'un côté, une OMBRE portée du côté opposé, et un SUJET,
 * c'est-à-dire une masse plus dense quelque part au milieu. Sans elles, on
 * obtient un aplat teinté — joli, et manifestement décoratif.
 *
 * Les quatre compositions ci-dessous portent donc chacune ces trois couches,
 * dans des positions différentes : la lumière ne vient jamais du même angle
 * d'une vignette à l'autre, faute de quoi trois tuiles côte à côte se
 * dénoncent comme un motif répété.
 */
const MATIERES = [
  // Pain doré, lumière rasante venue de la gauche.
  'radial-gradient(ellipse 46% 52% at 62% 58%, rgba(120,64,22,0.55) 0%, transparent 66%),'
  + 'radial-gradient(ellipse 58% 48% at 18% 16%, rgba(255,242,208,0.98) 0%, transparent 58%),'
  + 'radial-gradient(ellipse 74% 62% at 96% 96%, rgba(58,32,12,0.72) 0%, transparent 62%),'
  + 'linear-gradient(148deg, #e3ae66 0%, #b1763b 48%, #6b4423 100%)',
  // Herbes fraîches, contre-jour par la droite.
  'radial-gradient(ellipse 44% 50% at 40% 62%, rgba(18,52,28,0.5) 0%, transparent 64%),'
  + 'radial-gradient(ellipse 52% 46% at 84% 14%, rgba(238,255,222,0.95) 0%, transparent 58%),'
  + 'radial-gradient(ellipse 70% 62% at 6% 98%, rgba(12,34,18,0.75) 0%, transparent 62%),'
  + 'linear-gradient(158deg, #8fbb66 0%, #4d8043 50%, #24401f 100%)',
  // Nappe et céramique, lumière zénithale.
  'radial-gradient(ellipse 40% 44% at 52% 66%, rgba(126,112,96,0.45) 0%, transparent 64%),'
  + 'radial-gradient(ellipse 62% 44% at 46% 4%, rgba(255,255,255,1) 0%, transparent 60%),'
  + 'radial-gradient(ellipse 66% 58% at 6% 96%, rgba(108,96,84,0.6) 0%, transparent 62%),'
  + 'linear-gradient(142deg, #f4efe7 0%, #d5c9b8 52%, #9b8e80 100%)',
  // Salle en soirée, deux lampes et beaucoup d'ombre.
  'radial-gradient(ellipse 30% 34% at 72% 26%, rgba(255,206,138,0.92) 0%, transparent 60%),'
  + 'radial-gradient(ellipse 22% 26% at 34% 44%, rgba(255,182,104,0.5) 0%, transparent 62%),'
  + 'radial-gradient(ellipse 80% 66% at 12% 98%, rgba(10,8,12,0.86) 0%, transparent 64%),'
  + 'linear-gradient(160deg, #7a5540 0%, #3d2c26 52%, #171216 100%)',
];

function Photo({
  seed = 0, hauteur, rayon = '0.5em', image,
}: {
  seed?: number;
  hauteur: string;
  rayon?: string;
  /** Une VRAIE image, déjà résolue. Elle remplace la composition. */
  image?: string | null;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        height: hauteur,
        borderRadius: rayon,
        overflow: 'hidden',
        position: 'relative',
        background: image ? PAPIER.fondDoux : MATIERES[seed % MATIERES.length],
      }}
    >
      {image && (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {/* Le voile du bas : ce qui donne à une image sa profondeur plutôt que
          son aplat. Posé aussi sur une vraie photo, pour que les deux se
          ressemblent. */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.22) 0%, transparent 46%)',
        }}
      />
    </div>
  );
}

/** La marque du faux site : une pastille à l'accent portant son initiale. */
function Marque({ nom, taille = '1.5em' }: { nom: string; taille?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: taille,
        height: taille,
        borderRadius: '0.4em',
        background: 'var(--v-accent)',
        color: 'var(--v-accent-foreground, #ffffff)',
        fontSize: '0.8em',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {(nom || 'V').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function BoutonFaux({ children, taille = 1 }: { children: React.ReactNode; taille?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'var(--v-accent)',
        color: 'var(--v-accent-foreground, #ffffff)',
        borderRadius: '0.45em',
        padding: `${0.55 * taille}em ${1.1 * taille}em`,
        fontSize: `${0.95 * taille}em`,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/**
 * LA PASTILLE DE RÉASSURANCE — en gélule sur l'écran large, à nu sur le petit.
 *
 * ══ LE DÉFAUT QUE `nu` RÉPARE ═══════════════════════════════════════════════
 *
 * La gélule était rendue à l'identique dans le téléphone. Elle y porte le même
 * texte — « Ouvert · Réponse sous 24 h » — dans un quart de la largeur, avec
 * `white-space: nowrap` : elle sortait de l'écran et se faisait couper en
 * plein mot. Une pastille tronquée dans une maquette censée démontrer qu'on
 * sait faire du responsive est le pire endroit possible pour ce défaut.
 *
 * Sur petit écran on retire donc le contour et le fond, et on laisse le texte
 * revenir à la ligne : c'est exactement ce qu'un bon site fait de ce motif, et
 * la maquette le montre au lieu de le prétendre.
 */
function Pastille({ texte, nu = false }: { texte: string; nu?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: nu ? 'flex-start' : 'center',
        gap: '0.4em',
        maxWidth: '100%',
        ...(nu
          ? { fontSize: '0.78em', lineHeight: 1.35 }
          : {
            borderRadius: '999px',
            border: `1px solid ${PAPIER.filet}`,
            background: PAPIER.fond,
            padding: '0.3em 0.7em',
            fontSize: '0.82em',
            whiteSpace: 'nowrap' as const,
          }),
        fontWeight: 600,
        color: PAPIER.encreDouce,
      }}
    >
      <span
        style={{
          width: '0.42em',
          height: '0.42em',
          marginTop: nu ? '0.45em' : 0,
          borderRadius: '999px',
          background: 'var(--v-accent)',
          flexShrink: 0,
        }}
      />
      {texte}
    </span>
  );
}

/* ── Le faux site, en deux mises en page ──────────────────────────────────── */

function FauxSiteBureau({ c }: { c: ShowcaseContent }) {
  const cartes = (c.cards ?? []).slice(0, 3);
  const nom = c.siteName || 'Votre entreprise';
  return (
    <div style={{ background: PAPIER.fond, color: PAPIER.encre, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/*
        LA BARRE UTILITAIRE — le détail qui fait « vrai site de commerce ».
        Téléphone et horaires en haut à droite : c'est là que tout visiteur va
        les chercher, et aucune maquette crédible ne s'en passe.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '1.1em',
          padding: '0.4em 1.35em',
          background: PAPIER.fondDoux,
          borderBottom: `1px solid ${PAPIER.filet}`,
          fontSize: '0.72em',
          color: PAPIER.encreDouce,
          whiteSpace: 'nowrap',
        }}
      >
        <span>04 XX XX XX XX</span>
        <span>Ouvert aujourd’hui de 12h à 14h</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '0.75em 1.2em 0.8em' }}>
        {/* En-tête du faux site */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1em', paddingBottom: '0.7em', borderBottom: `1px solid ${PAPIER.filet}` }}>
          <Marque nom={nom} />
          <span style={{ fontSize: '1.02em', fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            {nom}
          </span>
          <span style={{ display: 'flex', gap: '1.1em', flex: 1, minWidth: 0 }}>
            {(c.navItems ?? []).slice(0, 4).map((n) => (
              <span key={n} style={{ fontSize: '0.82em', color: PAPIER.encreDouce, whiteSpace: 'nowrap' }}>{n}</span>
            ))}
          </span>
          <BoutonFaux taille={0.82}>{c.ctaLabel || 'Nous contacter'}</BoutonFaux>
        </div>

        {/* La bannière : texte à gauche, photographie à droite */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: '1.25em', alignItems: 'center', padding: '0.85em 0 0.8em' }}>
          <div>
            {c.badge && <div style={{ marginBottom: '0.7em' }}><Pastille texte={c.badge} /></div>}
            <div style={{ fontSize: '1.75em', fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.025em' }}>
              {c.headline || 'Le titre qui dit ce que vous faites'}
            </div>
            {c.subline && (
              <div style={{ marginTop: '0.55em', fontSize: '0.88em', lineHeight: 1.5, color: PAPIER.encreDouce }}>
                {c.subline}
              </div>
            )}
            <div style={{ marginTop: '0.95em', display: 'flex', alignItems: 'center', gap: '0.7em' }}>
              <BoutonFaux>{c.ctaLabel || 'Nous contacter'}</BoutonFaux>
              {/* Le second bouton, en filet : un vrai site en a deux, et leur
                  différence de poids est ce qu'un prospect reconnaît. */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  border: `1px solid ${PAPIER.filet}`,
                  borderRadius: '0.45em',
                  padding: '0.55em 0.9em',
                  fontSize: '0.85em',
                  fontWeight: 600,
                  color: PAPIER.encre,
                  whiteSpace: 'nowrap',
                }}
              >
                Voir la carte
              </span>
            </div>
          </div>
          <Photo image={c.image} seed={0} hauteur="7.9em" rayon="0.6em" />
        </div>

        {/* Trois tuiles, chacune avec sa vignette */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75em' }}>
          {cartes.map((k, i) => (
            <div
              key={k._id ?? i}
              style={{
                border: `1px solid ${PAPIER.filet}`,
                background: PAPIER.fond,
                borderRadius: '0.6em',
                overflow: 'hidden',
              }}
            >
              <Photo seed={i + 1} hauteur="2.7em" rayon="0" />
              <div style={{ padding: '0.5em 0.65em 0.6em' }}>
                <div style={{ fontSize: '0.86em', fontWeight: 650, lineHeight: 1.25 }}>{k.title}</div>
                {k.text && (
                  <div style={{ marginTop: '0.22em', fontSize: '0.74em', lineHeight: 1.4, color: PAPIER.encreDouce }}>{k.text}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FauxSiteMobile({ c }: { c: ShowcaseContent }) {
  const cartes = (c.cards ?? []).slice(0, 2);
  const nom = c.siteName || 'Votre entreprise';
  return (
    <div style={{ background: PAPIER.fond, color: PAPIER.encre, height: '100%', padding: '0.85em 0.8em', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', paddingBottom: '0.65em', borderBottom: `1px solid ${PAPIER.filet}` }}>
        <Marque nom={nom} taille="1.3em" />
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.9em', fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nom}
        </span>
        {/* Le menu replié : trois filets. Ce que devient une barre sur mobile. */}
        <span style={{ display: 'grid', gap: '0.2em', flexShrink: 0 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ display: 'block', width: '1.05em', height: '0.15em', borderRadius: '999px', background: PAPIER.encre }} />
          ))}
        </span>
      </div>

      <div style={{ paddingTop: '0.8em' }}>
        {/*
          LA PHOTOGRAPHIE PASSE EN PREMIER SUR MOBILE, et c'est la
          démonstration : ce n'est pas la même page en plus étroit, c'est la
          même page REPENSÉE. Sur un téléphone, une image en tête donne le ton
          avant que le pouce ne descende.
        */}
        <Photo image={c.image} seed={0} hauteur="4.7em" rayon="0.5em" />
        {c.badge && <div style={{ marginTop: '0.6em' }}><Pastille texte={c.badge} nu /></div>}
        <div style={{ marginTop: '0.5em', fontSize: '1.3em', fontWeight: 700, lineHeight: 1.14, letterSpacing: '-0.02em' }}>
          {c.headline || 'Le titre qui dit ce que vous faites'}
        </div>
        {c.subline && (
          <div style={{ marginTop: '0.45em', fontSize: '0.82em', lineHeight: 1.45, color: PAPIER.encreDouce }}>
            {c.subline}
          </div>
        )}
        <div style={{ marginTop: '0.8em' }}>
          {/*
            LE BOUTON EST PLEINE LARGEUR SUR MOBILE, et c'est le second détail
            de la démonstration : une cible qu'on atteint au pouce.
          */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--v-accent)',
              color: 'var(--v-accent-foreground, #ffffff)',
              borderRadius: '0.5em',
              padding: '0.7em 1em',
              fontSize: '0.88em',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {c.ctaLabel || 'Nous contacter'}
          </span>
        </div>
        {/* Les tuiles s'empilent : une colonne, vignette à gauche. */}
        <div style={{ marginTop: '0.8em', display: 'grid', gap: '0.55em' }}>
          {cartes.map((k, i) => (
            <div
              key={k._id ?? i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6em',
                border: `1px solid ${PAPIER.filet}`,
                background: PAPIER.fond,
                borderRadius: '0.5em',
                padding: '0.45em',
              }}
            >
              <div style={{ width: '2.6em', flexShrink: 0 }}>
                <Photo seed={i + 1} hauteur="2.2em" rayon="0.35em" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8em', fontWeight: 650, lineHeight: 1.2 }}>{k.title}</div>
                {k.text && (
                  <div style={{ marginTop: '0.15em', fontSize: '0.7em', lineHeight: 1.35, color: PAPIER.encreDouce }}>{k.text}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Les châssis ──────────────────────────────────────────────────────────── */

/** La barre du faux navigateur : trois pastilles, un cadenas, une adresse. */
function BarreNavigateur({ url }: { url?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.7em',
        padding: '0.55em 0.8em',
        background: '#e9ebef',
        borderBottom: '1px solid #d7dade',
      }}
    >
      <span style={{ display: 'flex', gap: '0.32em' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((t) => (
          <span key={t} style={{ width: '0.55em', height: '0.55em', borderRadius: '999px', background: t }} />
        ))}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4em',
          background: '#ffffff',
          borderRadius: '999px',
          padding: '0.28em 0.75em',
          fontSize: '0.72em',
          color: PAPIER.encreDouce,
          overflow: 'hidden',
        }}
      >
        {/* Le cadenas : dessiné, pas importé — ce fichier ne dépend d'aucune
            bibliothèque d'icônes, qui diffère entre les deux applications. */}
        <svg viewBox="0 0 24 24" style={{ width: '0.95em', height: '0.95em', flexShrink: 0 }} aria-hidden="true">
          <path
            d="M7 10V7a5 5 0 0110 0v3M5 10h14v10H5z"
            fill="none"
            stroke="#3fa46a"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url || 'www.votre-entreprise.fr'}
        </span>
      </span>
    </div>
  );
}

export function DeviceShowcase({
  content,
  animate = true,
  className,
}: {
  content: ShowcaseContent;
  /** Coupé dans un aperçu : une scène qui flotte pendant qu'on tape épuise. */
  animate?: boolean;
  className?: string;
}) {
  return (
    <div className={className} style={{ width: '100%' }}>
      <style>{SCENE_CSS}</style>
      <div className="lydev-wrap" style={{ width: '100%' }}>
        {/*
          LA RÉSERVE À DROITE ET EN BAS N'EST PAS UNE MARGE, C'EST LA PLACE DU
          TÉLÉPHONE.

          ══ LE DÉFAUT QU'ELLE RÉPARE ═══════════════════════════════════════
          Le téléphone était posé à `right: -1.2em`, donc HORS de la boîte de
          la scène. Il sortait du conteneur, et la colonne de la bannière le
          rognait : on voyait un téléphone coupé dans le sens de la longueur —
          ce qui se lit comme un défaut d'affichage, pas comme une profondeur.

          L'ordinateur occupe désormais la largeur MOINS cette réserve, et le
          téléphone vient s'y loger en débordant sur lui. Le chevauchement est
          voulu ; le débordement hors cadre ne l'était pas.
        */}
        <div
          className="lydev-scene"
          style={{ position: 'relative', width: '100%', paddingRight: '9%', paddingBottom: '5.2em' }}
        >
          {/* Le halo : ce qui décolle la scène du fond au lieu de l'y poser. */}
          <div
            aria-hidden="true"
            className={animate ? 'lydev-halo' : undefined}
            style={{
              position: 'absolute',
              left: '50%',
              top: '46%',
              width: '92%',
              height: '62%',
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--v-accent) 42%, transparent) 0%, transparent 70%)',
              filter: 'blur(3.5em)',
              opacity: 0.36,
              pointerEvents: 'none',
            }}
          />

          {/* ── L'ORDINATEUR ───────────────────────────────────────────── */}
          <div className={animate ? 'lydev-ordi' : undefined} style={{ position: 'relative' }}>
            <div
              style={{
                borderRadius: '0.95em',
                padding: '0.62em',
                background: 'linear-gradient(160deg, #3a3d45 0%, #202329 55%, #15171c 100%)',
                boxShadow: '0 2.2em 4em -1.4em rgba(0,0,0,0.72), 0 0 0 1px rgba(255,255,255,0.06) inset',
              }}
            >
              <div
                style={{
                  borderRadius: '0.5em',
                  overflow: 'hidden',
                  aspectRatio: '16 / 10',
                  background: PAPIER.fond,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <BarreNavigateur url={content.browserUrl} />
                <div style={{ flex: 1, minHeight: 0 }}>
                  <FauxSiteBureau c={content} />
                </div>
              </div>
            </div>

            {/*
              LE SOCLE — deux pièces, et la seconde est ce qui fait « posé ».
              Une barre seule sous un écran se lit comme une ombre ratée ; la
              charnière plus étroite, elle, donne l'épaisseur.
            */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: '18%',
                  height: '0.5em',
                  background: 'linear-gradient(180deg, #23262c 0%, #14161a 100%)',
                }}
              />
              <div
                style={{
                  width: '112%',
                  height: '0.72em',
                  borderRadius: '0 0 0.6em 0.6em',
                  background: 'linear-gradient(180deg, #2e3138 0%, #171a1f 100%)',
                  boxShadow: '0 1.2em 2.2em -0.9em rgba(0,0,0,0.7)',
                }}
              />
            </div>
          </div>

          {/* ── LE TÉLÉPHONE ───────────────────────────────────────────── */}
          <div
            className={animate ? 'lydev-tel' : undefined}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: '23%',
            }}
          >
            <div
              style={{
                borderRadius: '1.5em',
                padding: '0.32em',
                background: 'linear-gradient(160deg, #3a3d45 0%, #1d2025 60%, #131519 100%)',
                boxShadow: '0 1.8em 3.2em -1em rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.07) inset',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  borderRadius: '1.25em',
                  overflow: 'hidden',
                  aspectRatio: '9 / 19',
                  background: PAPIER.fond,
                }}
              >
                {/* L'îlot de l'écran — une pilule, pas une encoche : c'est ce
                    que porte un téléphone récent, et la maquette doit dater
                    d'aujourd'hui. */}
                <span
                  style={{
                    position: 'absolute',
                    top: '0.5em',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '30%',
                    height: '0.72em',
                    borderRadius: '999px',
                    background: '#14161a',
                    zIndex: 2,
                  }}
                />
                <div style={{ height: '100%', paddingTop: '1.5em' }}>
                  <FauxSiteMobile c={content} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeviceShowcase;
