import { z } from 'zod';
import { HOME_CONTENT_LIMITS as L } from '../utils/contentLimits.js';

/**
 * LE CONTENU DE L'ACCUEIL — validé, enfin.
 *
 * ══ LE DÉFAUT QUE CE FICHIER FERME ══════════════════════════════════════════
 *
 * `PUT /api/home-content` n'avait AUCUN validateur. C'est l'écran le plus
 * édité du Manager — la page qui vend —, et le seul dont la route acceptait
 * n'importe quoi : le schéma mongoose ne pose ni longueur ni cardinalité, et
 * les seules limites du produit vivaient dans les props `max={…}` d'un
 * composant React.
 *
 * Autrement dit : les limites existaient pour qui utilisait l'écran, et pour
 * personne d'autre. Une requête directe pouvait poser trente entrées de menu
 * dans la maquette ; la vitrine en aurait rendu quatre (`slice(0, 4)`) et
 * n'aurait rien dit — l'éditeur aurait vu ses vingt-six autres disparaître
 * sans un mot, ce que ce dépôt refuse explicitement par ailleurs.
 *
 * ══ POURQUOI `passthrough()` ════════════════════════════════════════════════
 *
 * Même raison que pour les pages et les chapitres : ces objets portent des
 * DESCRIPTEURS DE MÉDIA (`imageMedia`) décrits par un schéma mongoose qui fait
 * autorité. Les réépeler en zod donnerait deux définitions du même contrat, et
 * la première à gagner un champ le verrait supprimé en silence par l'autre.
 *
 * On valide donc ce qui décide d'un REFUS — cardinalités et longueurs, les
 * deux choses que la vitrine ne peut pas rattraper — et l'on confie le reste
 * à mongoose. Les contrôleurs de singletons chargent le document et appellent
 * `.set()` : aucun opérateur Mongo ne peut transiter par `passthrough`.
 *
 * ══ TOUT EST FACULTATIF, ET C'EST VOULU ═════════════════════════════════════
 *
 * Le Manager enregistre le document ENTIER, mais un client plus ancien — ou
 * une migration — peut n'en envoyer qu'une section. Exiger un champ ici
 * reviendrait à interdire de vider une accroche, alors que « vide » est un
 * état légitime que la vitrine sait rendre (elle masque la section).
 */

/** Une chaîne bornée, facultative, et qu'on accepte vide. */
const texte = (max) => z.string().trim().max(max).optional();

/** Une liste bornée — le refus que la vitrine ne peut pas exprimer elle-même. */
const liste = (schema, maxItems, quoi) =>
  z.array(schema).max(maxItems, `${maxItems} ${quoi} au maximum.`).optional();

/** Un argument : icône, chiffre facultatif, titre, explication. */
const argument = ({ valueMax, titleMax, textMax }) =>
  z
    .object({
      icon: texte(L.iconMax),
      ...(valueMax ? { value: texte(valueMax) } : {}),
      title: texte(titleMax),
      text: texte(textMax),
      order: z.coerce.number().optional(),
    })
    .passthrough();

export const homeContentUpdateSchema = {
  body: z
    .object({
      hero: z
        .object({
          kicker: texte(L.hero.kickerMax),
          title: texte(L.hero.titleMax),
          subtitle: texte(L.hero.subtitleMax),
          primaryLabel: texte(L.hero.labelMax),
          primaryUrl: texte(L.hero.urlMax),
          secondaryLabel: texte(L.hero.labelMax),
          secondaryUrl: texte(L.hero.urlMax),
          proofs: liste(
            z
              .object({
                icon: texte(L.iconMax),
                text: texte(L.hero.proofs.textMax),
                order: z.coerce.number().optional(),
              })
              .passthrough(),
            L.hero.proofs.maxItems,
            'rassurances',
          ),
        })
        .passthrough()
        .optional(),

      showcase: z
        .object({
          browserUrl: texte(L.showcase.browserUrlMax),
          siteName: texte(L.showcase.siteNameMax),
          /*
            Le menu du site fictif : quatre entrées, parce que `DeviceShowcase`
            en dessine quatre. Une cinquième ne « déborderait » pas — elle
            serait coupée sans un mot.
          */
          navItems: liste(
            z.string().trim().max(L.showcase.navItems.textMax),
            L.showcase.navItems.maxItems,
            'entrées de menu',
          ),
          headline: texte(L.showcase.headlineMax),
          subline: texte(L.showcase.sublineMax),
          ctaLabel: texte(L.showcase.ctaLabelMax),
          badge: texte(L.showcase.badgeMax),
          cards: liste(
            argument({ titleMax: L.showcase.cards.titleMax, textMax: L.showcase.cards.textMax }),
            L.showcase.cards.maxItems,
            'tuiles',
          ),
        })
        .passthrough()
        .optional(),

      outcomes: z
        .object({
          eyebrow: texte(L.outcomes.eyebrowMax),
          title: texte(L.outcomes.titleMax),
          lead: texte(L.outcomes.leadMax),
          items: liste(argument(L.outcomes.items), L.outcomes.items.maxItems, 'résultats'),
        })
        .passthrough()
        .optional(),

      positioning: z
        .object({
          eyebrow: texte(L.positioning.eyebrowMax),
          title: texte(L.positioning.titleMax),
          text: texte(L.positioning.textMax),
        })
        .passthrough()
        .optional(),

      trust: z
        .object({
          eyebrow: texte(L.trust.eyebrowMax),
          title: texte(L.trust.titleMax),
          items: liste(argument(L.trust.items), L.trust.items.maxItems, 'engagements'),
        })
        .passthrough()
        .optional(),

      invitation: z
        .object({
          title: texte(L.invitation.titleMax),
          text: texte(L.invitation.textMax),
          buttonLabel: texte(L.invitation.labelMax),
          buttonUrl: texte(L.invitation.urlMax),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
};

export default { homeContentUpdateSchema };
