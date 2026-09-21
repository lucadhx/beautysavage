// LE DOCUMENT LÉGAL REÇU DU PANEL — répliqué, jamais rédigé ici.
//
// ══ POURQUOI CE PROJET LE PERSISTE ══════════════════════════════════════════
//
// Pour la même raison que l'identité de l'entreprise : l'AUTONOMIE
// (`04_STANDALONE`). Si le Panel disparaît, `/mentions-legales` doit continuer
// d'afficher le dernier document valide. Une page de mentions légales est une
// obligation ; la rendre dépendante de la disponibilité d'un outil interne
// serait un choix d'architecture qu'aucun visiteur n'a à subir.
//
// Une lecture directe du Panel à chaque affichage aurait par ailleurs deux
// autres défauts : une latence sur une page publique, et un point de panne qui
// n'existe nulle part ailleurs dans le rendu du site.
//
// ══ CE QU'IL CONTIENT : UN RENDU, PAS UN GABARIT ════════════════════════════
//
// Les valeurs sont DÉJÀ substituées. Ce projet ne connaît ni les variables, ni
// le registre, ni la règle qui retire un bloc dont une donnée manque. Il ne
// pourrait pas les connaître sans recevoir l'identité juridique complète du
// client, la nôtre et celle de l'hébergeur — pour n'en afficher qu'une part.
//
// Corollaire : le contenu ne peut PAS être édité ici. Aucun écran, aucune
// route, aucun service de ce dépôt n'écrit dans cette collection. Seul
// l'applicateur du pont le fait, sur réception. Pouvoir l'éditer localement
// recréerait exactement la copie divergente que le référentiel central existe
// pour supprimer.
//
// ══ AUCUN HTML, JAMAIS ══════════════════════════════════════════════════════
//
// Les blocs portent du TEXTE. La vitrine les rend avec son propre design, et
// aucun lecteur n'a à échapper quoi que ce soit : l'injection est impossible
// par construction, pas par filtrage.
import mongoose from 'mongoose';

/** Les deux documents servis. Un troisième exigerait une route publique de plus. */
export const LEGAL_DOCUMENT_TYPES = Object.freeze(['LEGAL_NOTICE', 'PRIVACY_POLICY']);

/**
 * UN BLOC — trois formes, et seulement trois.
 *
 * `Mixed` aurait été plus court. Il aurait aussi laissé passer n'importe quelle
 * structure jusqu'au composant de rendu, qui aurait alors dû se défendre. Le
 * schéma d'entrée du pont valide déjà la forme ; la redéclarer ici assure que
 * ce qui a été ÉCRIT reste lisible même après une évolution du contrat.
 */
const blockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['PARAGRAPH', 'LIST', 'FIELDS'], required: true },
    text: { type: String, default: '' },
    items: { type: [String], default: [] },
    fields: {
      type: [new mongoose.Schema({ label: String, value: String }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
);

const sectionSchema = new mongoose.Schema(
  {
    heading: { type: String, default: '' },
    blocks: { type: [blockSchema], default: [] },
  },
  { _id: false },
);

const legalDocumentSchema = new mongoose.Schema(
  {
    /** `LEGAL_NOTICE` ou `PRIVACY_POLICY`. Un document par type, pas plus. */
    type: { type: String, enum: LEGAL_DOCUMENT_TYPES, required: true, unique: true },

    /**
     * L'IDENTIFIANT D'ENTITÉ DU PONT — le seul rapprochement possible pour un
     * TOMBSTONE, qui n'a pas de charge utile.
     *
     * Même leçon que pour l'entreprise cliente : sans lui, un retrait ne
     * pourrait être rattaché à rien, et serait donc soit toujours ignoré, soit
     * toujours appliqué. Les deux sont faux, et le second efface une page
     * valide.
     */
    bridgeEntityId: { type: String, default: null },

    templateId: { type: String, default: null },
    templateName: { type: String, default: null },
    templateVersion: { type: Number, default: null },

    /**
     * LE COMPTEUR DE PUBLICATION, tenu par le Panel POUR CE PROJET.
     *
     * C'est LUI qui sert à écarter une écriture périmée — jamais
     * `templateVersion`. Changer d'affectation de A(v4) vers B(v1) émettrait
     * sinon une « version 1 » que la garde rejetterait comme plus ancienne, et
     * le site continuerait d'afficher A pour toujours.
     */
    documentVersion: { type: Number, default: 0 },

    environment: { type: String, enum: ['TEST', 'PROD', null], default: null },

    title: { type: String, default: '' },
    sections: { type: [sectionSchema], default: [] },

    /** Date de publication du template, telle que le Panel la donne. */
    documentUpdatedAt: { type: String, default: null },

    appliedAt: { type: Date, default: null },
    source: { type: String, enum: ['BOOTSTRAP', 'SYNC', null], default: null },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const LegalDocument = mongoose.model('LegalDocument', legalDocumentSchema);
export default LegalDocument;
