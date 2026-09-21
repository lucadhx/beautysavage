// MÉDIA MÉTIER DU PROJET — LOT 5.
//
// ══ POURQUOI UN DESCRIPTEUR, ET PAS UNE CHAÎNE ══════════════════════════════
//
// Les médias du projet — logo client, favicon, hero, avant/après, galerie,
// bannières — n'existaient que sous forme de chemin `/uploads/<fichier>` posé
// dans une fiche. Personne ne pouvait répondre à :
//
//   · à quel projet appartient ce fichier ? (deux projets voisins sur le même
//     serveur, deux dossiers `/uploads`, et un nom de fichier qui ne dit rien)
//   · est-ce la même image qu'hier ? (aucune empreinte)
//   · quel type réel, quelles dimensions, quelle taille ?
//   · qui l'a importé, et quand ?
//   · est-il encore utilisé quelque part ?
//
// Sans ces réponses, aucune suppression n'était sûre et aucune migration
// n'était vérifiable. On rapprochait des médias par NOM DE FICHIER — ce qui,
// entre deux projets, est exactement la façon de mélanger leurs images.
import mongoose from 'mongoose';

const projectMediaSchema = new mongoose.Schema(
  {
    /** Identité STABLE du média, indépendante de son emplacement. */
    mediaId: { type: String, required: true, unique: true },

    // ── PORTÉE MÉTIER — déclarée, jamais déduite d'un nom de fichier ─────
    /** Le projet propriétaire. Deux projets ne partagent JAMAIS un média. */
    projectId: { type: String, default: null, index: true },
    /**
     * L'identité de projet, qui SURVIT à un changement de domaine. C'est elle
     * qui autorise une migration de médias — jamais le domaine, jamais la
     * base, jamais le serveur : deux projets distincts peuvent partager les
     * trois.
     */
    projectIdentityId: { type: String, default: null, index: true },
    /** Type métier : logo · favicon · hero · before-after · gallery · banner… */
    mediaType: { type: String, default: 'other', index: true },

    /**
     * ENVIRONNEMENT — TEST ou PROD, et un média ne franchit JAMAIS la frontière.
     *
     * ── LE DÉFAUT CORRIGÉ ────────────────────────────────────────────────
     * Le champ n'existait pas. Un poste de recette partageant la base d'un
     * projet déployé relayait ses imports vers l'instance canonique, quelle
     * qu'elle soit : un média de recette pouvait être servi en production sans
     * qu'aucun signal ne l'indique.
     *
     * Requis : un média sans environnement est un média dont on ne sait pas
     * s'il a le droit d'être publié.
     */
    environment: { type: String, enum: ['TEST', 'PROD'], required: true, index: true },

    /**
     * EST-IL SERVI PAR UNE DESTINATION, ou seulement présent ici ?
     *
     *   LOCAL_ONLY  le fichier n'existe que sur cette instance. C'est l'état
     *               NORMAL d'un projet qu'on configure avant sa mise en ligne ;
     *   PUBLISHED   le fichier a été CONSTATÉ sur la destination — empreinte
     *               et taille relues sur le serveur, pas déduites d'un envoi.
     *
     * Il redevient LOCAL_ONLY au retrait de la destination : un média ne reste
     * pas « publié » sur un serveur qui ne le sert plus.
     */
    publicationState: {
      type: String,
      enum: ['LOCAL_ONLY', 'PUBLISHED'],
      default: 'LOCAL_ONLY',
      index: true,
    },
    /** L'hôte sur lequel la présence a été constatée. */
    publishedHost: { type: String, default: null },
    publishedAt: { type: String, default: null },
    /** Propriétaire métier : la fiche qui référence ce média. */
    owner: {
      collection: { type: String, default: null },
      documentId: { type: String, default: null },
      field: { type: String, default: null },
    },

    /** Nom de l'objet stocké sous `/uploads`. */
    objectKey: { type: String, required: true, index: true },
    /** Chemin public RELATIF. L'absolu est résolu à l'affichage. */
    path: { type: String, required: true },

    // ── CE QUE LE FICHIER EST RÉELLEMENT ────────────────────────────────
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    /** Empreinte du CONTENU : « même image » ou « autre ». */
    sha256: { type: String, required: true, index: true },
    /** Monotone — jamais réutilisée. */
    version: { type: Number, required: true, default: 1 },

    createdBy: { type: String, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    /** Retiré : le descripteur survit, pour pouvoir répondre 410. */
    deletedAt: { type: String, default: null },
  },
  { minimize: false, versionKey: false },
);

/**
 * Un même CONTENU peut exister deux fois s'il sert à deux choses — mais une
 * seule fois par projet ET par type. C'est cette portée qui rend la
 * déduplication sûre : sans elle, supprimer le logo ferait disparaître une
 * photo de galerie qui se trouvait être le même fichier.
 */
projectMediaSchema.index({ projectId: 1, mediaType: 1, sha256: 1 });

/**
 * La déduplication est aussi scopée à l'ENVIRONNEMENT.
 *
 * Sans cela, importer en recette une image déjà présente en production
 * rendrait le média de production — et la fiche de recette référencerait un
 * objet appartenant à l'autre monde.
 */
projectMediaSchema.index({ environment: 1, mediaType: 1, sha256: 1 });

export const ProjectMedia = mongoose.model('ProjectMedia', projectMediaSchema);
export default ProjectMedia;
