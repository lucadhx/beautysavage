import { z } from 'zod';
import { KEY_FIGURE_LIMITS } from '../utils/contentLimits.js';

/**
 * Le manager renvoie tout le document company : on valide ce qui décide d'un
 * refus, et l'on laisse passer le reste (`passthrough`).
 *
 * ══ `signer` A QUITTÉ CE SCHÉMA ═════════════════════════════════════════════
 *
 * Le signataire contractuel du client était validé ici, puis écrit dans
 * `Company.signer` — une fiche éditée depuis CE Manager. Son autorité est
 * désormais la fiche « Clients » du Panel, publiée par le pont
 * (`CLIENT_COMPANY`), et aucun écran de ce projet ne le porte plus.
 *
 * ── POURQUOI IL N'EST PAS REFUSÉ, MAIS RETIRÉ ───────────────────────────────
 *
 * `passthrough` laisse passer un `signer` envoyé par un onglet resté ouvert sur
 * l'ancienne version de l'écran. C'est le contrôleur qui l'ÉCARTE, avant
 * l'enregistrement (`singleton.controllers.js`).
 *
 * Le refuser ici ferait échouer l'enregistrement entier de cet onglet — une
 * régression franche, pour un champ dont la valeur n'est de toute façon plus
 * lue par personne.
 */
export const companyUpdateSchema = {
  body: z
    .object({
      /**
       * LES CHIFFRES CLÉS — un refus, jamais un écrêtage.
       *
       * ══ LES NOMBRES NE SONT PLUS ÉCRITS ICI ═════════════════════════════
       *
       * Ils viennent de `utils/contentLimits.js`, et c'est la correction de
       * fond. Ce schéma refusait au-delà de TROIS pendant que la graine en
       * semait QUATRE et que la vitrine en dessinait une grille de quatre :
       * un propriétaire ouvrait un écran déjà invalide, et l'apprenait au
       * clic sur « Enregistrer ». Trois vérités pour une seule règle.
       *
       * Le libellé, lui, était borné à 40 caractères — la longueur d'un
       * complément de deux mots (« de piste »), héritée du moteur d'origine.
       * Il porte désormais une PHRASE, et la graine livrée en écrit 54.
       *
       * ══ POURQUOI UN REFUS, ET NON UNE COUPE ═════════════════════════════
       *
       * Un écrêtage silencieux ferait croire à l'administrateur qu'il a publié
       * une tuile qui ne s'affiche nulle part. C'est la même raison qui rend
       * ce refus NÉCESSAIRE : la vitrine, elle, ne coupe pas — elle rendrait
       * une cinquième tuile dans une grille qui n'en dessine que quatre.
       *
       * ══ LE CHIFFRE EST UNE CHAÎNE ═══════════════════════════════════════
       *
       * « 10 000 m² » n'est pas calculable, et le forcer en nombre obligerait
       * à ranger l'unité dans un second champ — donc à décider, ici, comment
       * on recolle les deux.
       */
      keyFigures: z
        .array(
          z.object({
            value: z
              .string()
              .trim()
              .min(1, 'Un chiffre clé sans valeur n’a rien à dire')
              .max(
                KEY_FIGURE_LIMITS.valueMax,
                `${KEY_FIGURE_LIMITS.valueMax} caractères au maximum pour le chiffre.`,
              ),
            label: z
              .string()
              .trim()
              .max(
                KEY_FIGURE_LIMITS.labelMax,
                `${KEY_FIGURE_LIMITS.labelMax} caractères au maximum pour l’explication.`,
              )
              .optional(),
            icon: z.string().trim().max(KEY_FIGURE_LIMITS.iconMax).optional(),
            order: z.coerce.number().optional(),
          }).passthrough(),
        )
        .max(
          KEY_FIGURE_LIMITS.maxItems,
          `${KEY_FIGURE_LIMITS.maxItems} chiffres clés au maximum — la page d’accueil `
          + 'n’en dessine pas davantage.',
        )
        .optional(),
    })
    .passthrough(),
};
