import mongoose from 'mongoose';

/**
 * DESCRIPTEUR STABLE D'UN MÉDIA — ce qu'une fiche métier conserve d'une image.
 *
 * ══ POURQUOI PAS UNE URL ════════════════════════════════════════════════════
 *
 * Une adresse dépend du domaine courant. Deux conséquences, et les deux se
 * sont produites :
 *
 *   · un projet non encore déployé n'a AUCUNE adresse publique — donc aucun
 *     média enregistrable, c'est-à-dire aucune configuration possible avant sa
 *     première mise en ligne, au seul moment où on le configure ;
 *   · le jour d'un changement de domaine, toutes les fiches pointaient encore
 *     sur l'ancien, et il fallait toutes les réécrire.
 *
 * L'identité d'un média est sa CLÉ D'OBJET et son EMPREINTE. L'adresse en est
 * DÉRIVÉE, à la lecture, contre la destination ACTIVE du moment — voir
 * `resolveProjectMediaUrl`. Une fiche n'a donc plus jamais à être réécrite.
 *
 * ══ TOUS CES CHAMPS SONT IMMUABLES POUR UNE CLÉ DONNÉE ══════════════════════
 *
 * Le nom de l'objet porte l'empreinte de son contenu : un contenu différent a
 * forcément une autre clé. Recopier ces valeurs dans une fiche ne peut donc
 * pas produire de dérive — c'est ce qui rend la dénormalisation sûre ici, là
 * où elle serait dangereuse pour une donnée qui bouge.
 *
 * `_id: false` : un descripteur n'est pas une entité, c'est une description.
 */
export const mediaDescriptorSchema = new mongoose.Schema(
  {
    /**
     * QUI DÉTIENT CE MÉDIA — déclaré, jamais déduit.
     *
     * ══ LE DÉFAUT QUE CE CHAMP FERME ════════════════════════════════════════
     *
     * La résolution décidait « média du projet » sur la simple présence d'une
     * clé d'objet. Or le Panel en publie aussi : un logo d'agence, décrit avec
     * sa clé et son empreinte, était donc réécrit contre le domaine du CLIENT
     * — `https://<client>/uploads/<clé du Panel>` — et répondait 404.
     *
     * Aucune déduction ne peut rattraper cela : ni l'hôte, ni la clé, ni le
     * type métier, ni la position du champ ne disent à QUI un média appartient.
     * Seul son émetteur le sait, et il le DIT.
     *
     * `null` n'existe que pour les projections écrites AVANT ce champ : elles
     * restent LISIBLES, leur autorité étant alors donnée par le schéma du champ
     * qui les porte (ici : un média métier du projet). Toute écriture nouvelle
     * porte la valeur.
     */
    authority: { type: String, enum: ['PANEL', 'PROJECT', null], default: null },
    mediaId: { type: String, default: null },
    /** Le nom de l'objet sous `/uploads` — l'identité, avec l'empreinte. */
    objectKey: { type: String, required: true },
    /** TEST ou PROD — un média ne franchit jamais cette frontière. */
    environment: { type: String, enum: ['TEST', 'PROD', null], default: null },
    /** Ce que l'image REPRÉSENTE — jamais déduit du nom de fichier. */
    mediaType: { type: String, default: null },
    /** Empreinte du CONTENU : ce qui distingue « même image » d'« autre ». */
    sha256: { type: String, default: null },
    /** Le type RÉEL, mesuré à l'encodage — jamais déduit d'une extension. */
    mime: { type: String, default: null },
    size: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    /** Monotone — un consommateur refuse une projection plus ancienne. */
    version: { type: Number, default: 1 },
  },
  { _id: false },
);

export default mediaDescriptorSchema;
