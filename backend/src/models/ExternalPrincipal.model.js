// UNE IDENTITÉ QUI N'EST PAS À NOUS — la projection d'un compte Panel (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« EXTERNAL PRINCIPAL ».
//
// ── POURQUOI UNE COLLECTION SÉPARÉE DE `User` ───────────────────────────────
//
// La tentation était d'ajouter `panelUserId` au modèle `User` : un champ de
// plus, aucun modèle à écrire. Elle a été écartée, et pour une raison qui n'est
// pas esthétique.
//
// `User` porte `password` (requis), `passwordReset`, un hook `pre('save')` qui
// hache, et une méthode `comparePassword`. Un compte Panel logé là-dedans
// aurait un mot de passe — inventé, aléatoire, mais réel — et donc une surface
// de connexion locale que personne n'aurait décidée. Le CRUD DEV existant
// (`account.routes.js`) permettrait d'en changer, et l'écran de comptes
// offrirait un bouton « réinitialiser » sur une identité dont ce projet n'est
// pas propriétaire.
//
// Deux collections rendent tout cela IMPOSSIBLE plutôt qu'INTERDIT.
//
// ── CE QUI EST STOCKÉ, ET CE QUI NE PEUT PAS L'ÊTRE ─────────────────────────
//
// Aucun secret. `displayName` et `email` sont des données d'AFFICHAGE,
// rafraîchies par l'introspection du Panel — jamais une autorité. `enabled`
// est un REFLET : la sécurité ne le lit pas, elle redemande au Panel.
//
// Un test structurel échoue si `password`, `passwordHash`, `resetToken` ou
// `resetTokenHash` apparaissent un jour dans ce schéma. Il ne dit pas « ce
// serait mal » : il empêche de le committer.
import mongoose from 'mongoose';

/** Le seul fournisseur d'identité externe reconnu à ce jour. */
export const EXTERNAL_PROVIDERS = Object.freeze({
  LY_SOLUTION_PANEL: 'LY_SOLUTION_PANEL',
});

/**
 * LES CHAMPS QUI NE DOIVENT JAMAIS APPARAÎTRE ICI.
 *
 * Exportés pour que la recette les lise plutôt que de les recopier : une liste
 * dupliquée dans un test finit par diverger du modèle qu'elle surveille.
 */
export const FORBIDDEN_CREDENTIAL_FIELDS = Object.freeze([
  'password', 'passwordHash', 'resetToken', 'resetTokenHash',
  'passwordReset', 'salt', 'secret',
]);

const externalPrincipalSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: Object.values(EXTERNAL_PROVIDERS),
      required: true,
      default: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
    },

    /**
     * L'identifiant CHEZ LE FOURNISSEUR — `PanelUser.userId`.
     *
     * C'est la seule clé de correspondance, et elle n'est PAS l'adresse
     * e-mail : deux personnes différentes peuvent porter la même adresse dans
     * deux systèmes, et rapprocher sur l'adresse fusionnerait deux identités
     * que rien ne dit identiques. Cf. la recette « même e-mail, deux
     * principals ».
     */
    externalUserId: { type: String, required: true, trim: true },

    /** Le rôle tel que le Panel l'a affirmé. Reflet, jamais autorité. */
    role: { type: String, default: 'DEV' },

    /**
     * REFLET de l'état du compte au dernier contact.
     *
     * ⚠️ LA SÉCURITÉ NE LIT PAS CE CHAMP. Il sert à l'écran des comptes, pour
     * montrer un accès révoqué sans attendre qu'on essaie de s'en servir. Un
     * accès est refusé parce que le PANEL l'a dit à l'instant, jamais parce
     * qu'une copie locale disait « faux ».
     */
    enabled: { type: Boolean, default: true },

    /** Affichage seulement. Rafraîchis par l'introspection. */
    displayName: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },

    lastSyncedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

/**
 * UNE SEULE PROJECTION PAR (fournisseur, identifiant externe).
 *
 * Sans cet index, deux connexions simultanées du même développeur créeraient
 * deux projections, et l'écran des comptes montrerait la même personne deux
 * fois — avec deux états qui divergeraient ensuite.
 */
externalPrincipalSchema.index(
  { provider: 1, externalUserId: 1 },
  { unique: true, name: 'uniq_external_principal' },
);

export const ExternalPrincipal = mongoose.model('ExternalPrincipal', externalPrincipalSchema);
export default ExternalPrincipal;
