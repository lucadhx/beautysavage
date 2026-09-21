import mongoose from 'mongoose';
import { mediaDescriptorSchema } from './mediaDescriptor.schema.js';

/**
 * LE CONTENU DE LA PAGE D'ACCUEIL — singleton, et entièrement éditable.
 *
 * ══ POURQUOI CE MODÈLE EXISTE ═══════════════════════════════════════════════
 *
 * L'accueil tirait son texte de trois sources — `Company.homeIntro`, les
 * chiffres clés, les chapitres — et écrivait TOUT LE RESTE en dur : le titre
 * de la bannière, les intertitres, la phrase d'invitation, le libellé des
 * boutons. Un propriétaire qui voulait changer « Parlez-nous de votre
 * entreprise » devait demander une mise en production.
 *
 * C'est précisément ce que le site promet de ne pas faire subir à ses clients.
 * Un argumentaire de conversion, surtout, se RÉÉCRIT : on change un verbe, on
 * déplace une preuve, on essaie un autre appel à l'action. Le figer dans le
 * code, c'est décider qu'il ne sera jamais essayé.
 *
 * ══ POURQUOI PAS DANS `Company` ═════════════════════════════════════════════
 *
 * `Company` décrit l'ENTREPRISE — son nom, ses logos, ses coordonnées, ses
 * destinataires de notification. Elle est lue par le pied de page, les e-mails,
 * les documents légaux et le pont vers le Panel. Y verser la mise en scène
 * d'une page ferait grossir un document que six consommateurs relisent, pour
 * des champs dont un seul écran se sert.
 *
 * ══ AUCUN CONTENU EN DÉFAUT — NI ICI, NI AILLEURS ═══════════════════════════
 *
 * Même règle que `Company`, et pour la même raison : un défaut de schéma est
 * RÉAPPLIQUÉ par Mongoose à chaque `save()` dont le champ est `undefined`. Un
 * propriétaire qui vide son accroche la verrait revenir seule. Le schéma décrit
 * une FORME ; le texte se sème par migration et s'édite au Manager.
 *
 * Une chaîne vide se voit à l'écran et s'appelle « à renseigner ». Une phrase
 * héritée se lit comme un choix qu'on aurait fait pour lui.
 */

/** Une ligne de réassurance : une icône, une phrase courte. */
const preuveSchema = new mongoose.Schema(
  {
    icon: { type: String, default: 'Check' },
    text: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

/** Un argument : icône, chiffre facultatif, titre, explication. */
const argumentSchema = new mongoose.Schema(
  {
    icon: { type: String, default: 'Sparkles' },
    /**
     * Le chiffre mis en avant — « 30 s », « ×2 ». FACULTATIF, et c'est un
     * garde-fou : un argument sans chiffre vaut mieux qu'un chiffre inventé
     * pour remplir une case. La vitrine rend la tuile sans lui.
     */
    value: { type: String, default: '', trim: true },
    title: { type: String, default: '', trim: true },
    text: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
  },
  { _id: true },
);

/**
 * LA MAQUETTE — le faux site montré dans l'écran d'ordinateur et le téléphone.
 *
 * ══ POURQUOI SON CONTENU EST EN BASE, ET NON DANS LE COMPOSANT ══════════════
 *
 * Parce que c'est un ARGUMENT DE VENTE, pas une décoration. Ce que la maquette
 * affiche — le métier, le libellé du bouton, la pastille de réassurance —
 * s'adresse à un prospect précis. Le jour où L.Y Solution démarche des
 * restaurateurs plutôt que des artisans, la maquette doit parler de
 * réservations et non de devis, et cela ne peut pas demander un déploiement.
 *
 * Le DESSIN, lui, reste dans le composant : châssis, proportions, ombres,
 * couleurs du thème. L'éditeur choisit CE QUE LA MAQUETTE DIT ; la vitrine
 * décide de quoi elle a l'air. Même contrat que les blocs d'une page.
 */
const maquetteSchema = new mongoose.Schema(
  {
    /** Ce qui s'affiche dans la barre d'adresse du faux navigateur. */
    browserUrl: { type: String, default: '', trim: true },
    /** Le nom de l'entreprise fictive, en haut de la maquette. */
    siteName: { type: String, default: '', trim: true },
    /** Les entrées du menu du faux site. Trois ou quatre suffisent. */
    navItems: { type: [String], default: [] },
    headline: { type: String, default: '', trim: true },
    subline: { type: String, default: '', trim: true },
    /** Le bouton du faux site — « Réserver une table », « Demander un devis ». */
    ctaLabel: { type: String, default: '', trim: true },
    /** La pastille de réassurance — « Ouvert · Réponse sous 24 h ». */
    badge: { type: String, default: '', trim: true },
    /** Les tuiles sous la bannière du faux site. */
    cards: { type: [argumentSchema], default: [] },
    /**
     * Une photographie DANS la maquette. Facultative : sans elle, la bannière
     * du faux site se peint d'un dégradé du thème — jamais un rectangle vide,
     * qui se lirait comme une image cassée.
     */
    image: { type: String, default: '' },
    imageMedia: { type: mediaDescriptorSchema, default: null },
  },
  { _id: false },
);

const homeContentSchema = new mongoose.Schema(
  {
    /** LA BANNIÈRE — la promesse, deux boutons, et la rangée de réassurance. */
    hero: {
      kicker: { type: String, default: '', trim: true },
      title: { type: String, default: '', trim: true },
      subtitle: { type: String, default: '', trim: true },
      primaryLabel: { type: String, default: '', trim: true },
      primaryUrl: { type: String, default: '', trim: true },
      /**
       * Le SECOND bouton est facultatif, et la vitrine le sait. Deux appels à
       * l'action de même poids se neutralisent : celui-ci est dessiné en
       * retrait, et disparaît si son libellé est vide.
       */
      secondaryLabel: { type: String, default: '', trim: true },
      secondaryUrl: { type: String, default: '', trim: true },
      proofs: { type: [preuveSchema], default: [] },

      /**
       * L'IMAGE DE FOND DE LA BANNIÈRE — et pourquoi elle vit ICI.
       *
       * ══ CE QU'ELLE REMPLACE ═══════════════════════════════════════════════
       *
       * La bannière lisait `Company.heroImage`, un champ de la fiche
       * ENTREPRISE, édité depuis l'écran « Informations ». Deux défauts :
       *
       *   · le propriétaire qui veut changer l'image de son accueil ne la
       *     trouve pas sur l'écran « Accueil », où vit tout le reste de la
       *     bannière. Il la cherche, ne la trouve pas, et conclut qu'il n'y en
       *     a pas ;
       *   · ce champ décrit l'ENTREPRISE, pas une page. Le jour où une seconde
       *     page voudra sa propre image de tête, il faudra le dédoubler.
       *
       * `Company.heroImage` reste lu en REPLI par la bannière : les projets du
       * parc qui l'ont renseigné continuent de l'afficher, et rien ne casse.
       *
       * Même contrat média que partout : le descripteur fait autorité, la
       * chaîne n'est qu'un repli, l'adresse est dérivée à la lecture.
       */
      image: { type: String, default: '' },
      imageMedia: { type: mediaDescriptorSchema, default: null },
    },

    showcase: { type: maquetteSchema, default: () => ({}) },

    /** CE QUE ÇA CHANGE — les résultats, du point de vue du prospect. */
    outcomes: {
      eyebrow: { type: String, default: '', trim: true },
      title: { type: String, default: '', trim: true },
      lead: { type: String, default: '', trim: true },
      items: { type: [argumentSchema], default: [] },
    },

    /**
     * LE POSITIONNEMENT — le texte qui suit les trois mots barrés.
     *
     * Les trois refus eux-mêmes restent dans le code : ils ne décrivent pas
     * l'entreprise, ils décrivent ce qu'elle refuse. Le reste s'édite.
     */
    positioning: {
      eyebrow: { type: String, default: '', trim: true },
      title: { type: String, default: '', trim: true },
      text: { type: String, default: '', trim: true },
    },

    /** LES PREUVES DE CONFIANCE — engagements vérifiables, pas des promesses. */
    trust: {
      eyebrow: { type: String, default: '', trim: true },
      title: { type: String, default: '', trim: true },
      items: { type: [argumentSchema], default: [] },
    },

    /** L'INVITATION FINALE. */
    invitation: {
      title: { type: String, default: '', trim: true },
      text: { type: String, default: '', trim: true },
      buttonLabel: { type: String, default: '', trim: true },
      buttonUrl: { type: String, default: '', trim: true },
    },
  },
  { timestamps: true },
);

/**
 * AUCUNE ANNONCE AU PONT — et c'est un choix, pas un oubli.
 *
 * `Company` en émet une parce que le Panel projette l'identité du projet :
 * nom, logos, coordonnées. Le texte d'une page d'accueil n'entre dans aucune
 * de ces projections — le Panel n'a rien à en faire.
 *
 * Surtout, `notifyEntitySaved` attend un TYPE que le pont sait interpréter
 * (`COMPANY`, `NETWORK`, `CONTRACT`, `TEAM_MEMBER`, `TEAM_ROSTER`). Inventer un
 * `HOME_CONTENT` ferait passer à chaque enregistrement un type que personne ne
 * traite : le notifieur avale les erreurs de son auditeur, donc rien ne le
 * signalerait — un fil branché sur rien, indiscernable d'un fil qui marche.
 */
export const HomeContent = mongoose.model('HomeContent', homeContentSchema);
export default HomeContent;
