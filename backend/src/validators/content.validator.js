import { z } from 'zod';
import { BLOCK_TYPE_VALUES } from '../models/SitePage.model.js';
import { CHAPTER_LAYOUT_VALUES } from '../models/Chapter.model.js';
import { CHAPTER_LIMITS, SITE_PAGE_LIMITS } from '../utils/contentLimits.js';

/**
 * VALIDATION DES ÉCRANS DE CONTENU — la frontière, et la seule.
 *
 * ══ POURQUOI `passthrough()` ICI, ET STRICT AILLEURS ════════════════════════
 *
 * Ces deux entités portent des DESCRIPTEURS DE MÉDIA (`heroImageMedia`,
 * `imageMedia`, les images de blocs) : des objets à onze champs, décrits par un
 * schéma mongoose qui fait déjà autorité et qui évoluera. Les réépeler en zod
 * donnerait deux définitions du même contrat, et la première fois que l'une
 * gagnerait un champ, l'autre le supprimerait EN SILENCE — c'est exactement le
 * défaut qui fait disparaître un média à l'enregistrement.
 *
 * On valide donc ici ce qui décide d'un REFUS — un titre vide, une mise en
 * page inconnue, un type de bloc inventé — et on laisse la structure profonde
 * à mongoose, qui la connaît.
 *
 * ⚠️ `passthrough()` n'est PAS anodin : il laisse passer des clés inconnues
 * jusqu'à mongoose. Ces routes n'utilisent donc jamais `findByIdAndUpdate`
 * avec le corps brut — les contrôleurs chargent le document et appellent
 * `.set()`, ce qui interdit tout opérateur Mongo de transiter.
 */

/* ── CHAPITRES ────────────────────────────────────────────────────────────── */

/**
 * LA MISE EN PAGE EST VALIDÉE, PAS DEVINÉE.
 *
 * Un `layout` inconnu arriverait jusqu'à la vitrine, qui n'aurait aucun rendu
 * à lui appliquer : le chapitre s'afficherait vide, sans que rien ne dise
 * pourquoi. Les valeurs sont reprises du modèle par IMPORT, jamais recopiées —
 * en ajouter une au modèle sans l'ajouter ici la rendrait inutilisable.
 */
export const chapterSchema = {
  body: z
    .object({
      title: z
        .string()
        .trim()
        .min(1, 'Titre du chapitre requis')
        .max(CHAPTER_LIMITS.titleMax, `${CHAPTER_LIMITS.titleMax} caractères au maximum pour un titre.`),
      layout: z
        .enum(CHAPTER_LAYOUT_VALUES, {
          errorMap: () => ({
            message: `Mise en page inconnue. Attendu l’une de : ${CHAPTER_LAYOUT_VALUES.join(', ')}.`,
          }),
        })
        .optional(),
      items: z
        .array(
          z.object({
            title: z
              .string()
              .trim()
              .min(1, 'Chaque volet doit porter un titre.')
              .max(
                CHAPTER_LIMITS.items.titleMax,
                `${CHAPTER_LIMITS.items.titleMax} caractères au maximum pour un titre de volet.`,
              ),
          }).passthrough(),
        )
        .max(
          CHAPTER_LIMITS.items.maxItems,
          `${CHAPTER_LIMITS.items.maxItems} volets au maximum dans un chapitre.`,
        )
        .optional(),
    })
    .passthrough(),
};

/* ── PAGES ÉDITORIALES ────────────────────────────────────────────────────── */

export const sitePageSchema = {
  body: z
    .object({
      title: z
        .string()
        .trim()
        .min(1, 'Titre de la page requis')
        .max(SITE_PAGE_LIMITS.titleMax, `${SITE_PAGE_LIMITS.titleMax} caractères au maximum pour un titre.`),
      blocks: z
        .array(
          z.object({
            type: z.enum(BLOCK_TYPE_VALUES, {
              errorMap: () => ({ message: `Type de bloc inconnu. Attendu l’un de : ${BLOCK_TYPE_VALUES.join(', ')}.` }),
            }),
          }).passthrough(),
        )
        .max(
          SITE_PAGE_LIMITS.blocks.maxItems,
          `${SITE_PAGE_LIMITS.blocks.maxItems} blocs au maximum sur une page.`,
        )
        .optional(),
    })
    .passthrough(),
};

export const reorderSchema = {
  body: z.object({
    items: z.array(z.object({ id: z.string().min(1), order: z.coerce.number() })),
  }),
};

export default { chapterSchema, sitePageSchema, reorderSchema };
