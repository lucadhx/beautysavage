import mongoose from 'mongoose';

/**
 * DERNIÈRE PHOTOGRAPHIE ENVOYÉE au Panel, par type de collection.
 *
 * ── POURQUOI CE MODÈLE EXISTE ───────────────────────────────────────────────
 * Projeter une collection, ce n'est pas projeter des documents un par un :
 * c'est aussi savoir dire qui a DISPARU. Or un `upsert` ne dit jamais qu'un
 * élément n'est plus là, et une suppression faite pendant que le pont ne
 * regardait pas — suppression en lot, écriture directe en base, hook manqué —
 * ne laisse aucune trace à rejouer.
 *
 * On garde donc la liste des identifiants réellement émis. À la
 * réconciliation, comparer cette liste à la réalité produit les deux moitiés
 * de la vérité : ce qu'il faut mettre à jour, et ce qu'il faut effacer.
 *
 * Ce n'est PAS un miroir de ce que le Panel détient — nul ne peut le savoir
 * d'ici. C'est la mémoire de ce que le projet a annoncé, et elle suffit à
 * réparer.
 */
const rosterStateSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, unique: true },
    entityIds: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const PanelRosterState = mongoose.model('PanelRosterState', rosterStateSchema);

export default PanelRosterState;
