// CONFIGURATION REÇUE DU PANEL — Phase 4.
//
// Ce que le projet a RÉELLEMENT appliqué de ce que le Panel lui a envoyé :
// l'identité de l'entreprise qu'il représente, et les accès aux services
// tiers qui lui ont été accordés.
//
// ── POURQUOI PERSISTER ──────────────────────────────────────────────────────
// Le projet doit rester AUTONOME (04_STANDALONE). Si le Panel disparaît, le
// site continue d'afficher le bon logo, les bonnes mentions légales, et
// continue d'appeler les bons services. Une configuration gardée en mémoire
// serait perdue au premier redémarrage, et le site repartirait sans identité
// — exactement ce que l'autonomie interdit.
//
// ── UN SEUL DOCUMENT DEPUIS L4 ──────────────────────────────────────────────
//
// `PanelCompanyConfiguration` — singleton, PUBLIC, jamais chiffré : tout y est
// destiné à être affiché.
//
// `PanelProvidedApi` A ÉTÉ SUPPRIMÉ. Il stockait, chiffrés, les identifiants
// fournisseurs que le Panel envoyait sur le pont. L'audit du plan de contrôle
// a établi deux faits :
//
//   · son unique lecteur déchiffrant, `getProvidedApiCredentials()`, n'avait
//     AUCUN appelant — pas un driver, pas un service, pas une route ;
//   · les modules métier (Stripe, Brevo, Yousign, Hostinger) lisaient, et
//     lisent toujours, le registre LOCAL `IntegratedApi`.
//
// Des secrets traversaient donc le pont, étaient rechiffrés, persistés — et
// jamais utilisés. La collection est purgée au démarrage
// (`purgePanelProvidedApis`) : laisser des secrets au repos dans une
// collection que plus aucun code ne connaît serait le pire des deux mondes.
import mongoose from 'mongoose';

/** L'entreprise que ce projet représente — un seul document. */
const companyConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'SINGLETON', unique: true },

    companyId: { type: String, default: null },
    slug: { type: String, default: null },
    environment: { type: String, enum: ['TEST', 'PROD', null], default: null },
    // Version PUBLIÉE appliquée localement. C'est ce numéro que le projet
    // renvoie au Panel dans son identité : il permet de constater la
    // convergence, ou de constater qu'elle n'a pas eu lieu.
    version: { type: Number, default: null },

    identity: { type: mongoose.Schema.Types.Mixed, default: null },
    branding: { type: mongoose.Schema.Types.Mixed, default: null },
    domains: { type: mongoose.Schema.Types.Mixed, default: null },
    contacts: { type: mongoose.Schema.Types.Mixed, default: null },
    legal: { type: mongoose.Schema.Types.Mixed, default: null },
    settings: { type: mongoose.Schema.Types.Mixed, default: null },
    // Identité DÉVELOPPEUR dont le Panel est désormais l'autorité. `null` /
    // tableau vide tant qu'un Panel antérieur ne les envoie pas : le projet
    // n'invente rien à la place.
    signer: { type: mongoose.Schema.Types.Mixed, default: null },
    references: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // L'ÉQUIPE publiée par le Panel — affichée par la page Support. Stockée
    // telle qu'elle arrive : le projet n'en est pas l'auteur.
    team: { type: [mongoose.Schema.Types.Mixed], default: [] },

    appliedAt: { type: Date, default: null },
    // D'où vient la configuration : jointe à l'appairage, ou tirée par
    // synchronisation. Utile pour diagnostiquer un projet qui n'a jamais
    // rattrapé quoi que ce soit.
    source: { type: String, enum: ['BOOTSTRAP', 'SYNC', null], default: null },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

/**
 * L'ENTREPRISE CLIENTE DE CE PROJET — reçue du Panel, jamais saisie ici.
 *
 * ══ DEUX ENTREPRISES, ET ELLES SE FONT FACE ═════════════════════════════════
 *
 *   PanelCompanyConfiguration        L.Y SOLUTION — le PRESTATAIRE. Ce que le
 *                                    pied de page affiche, ce qui signe nos
 *                                    contrats côté développeur, ce que tout le
 *                                    parc reçoit à l'identique.
 *
 *   PanelClientCompanyConfiguration  L'ENTREPRISE DE CE PROJET — le CLIENT. Ce
 *                                    que la facture porte en « Facturer à », et
 *                                    qui désigne le signataire client.
 *
 * Les fondre en un seul document aurait obligé chaque lecteur à deviner
 * laquelle des deux il consulte — et la page « Mon entreprise » aurait fini par
 * afficher les mentions légales de son prestataire.
 *
 * ══ POURQUOI CE PROJET LA PERSISTE ═════════════════════════════════════════
 *
 * Pour la même raison que l'entreprise développeur : l'AUTONOMIE. Si le Panel
 * disparaît, le Manager continue d'afficher les informations légales du client,
 * et les gardes de paiement continuent de décider avec ce qu'elles savent. Une
 * configuration gardée en mémoire serait perdue au premier redémarrage.
 *
 * ══ CE QU'IL N'ÉCRIT JAMAIS ════════════════════════════════════════════════
 *
 * TOUT. Aucun écran, aucune route, aucun service de ce projet n'écrit dans
 * cette collection : seul l'applicateur du pont le fait, sur réception. Le
 * Panel est l'autorité de l'identité juridique du client — pouvoir l'éditer ici
 * reviendrait à laisser un client choisir la raison sociale sur laquelle il est
 * facturé et la personne qui l'engage.
 */
const clientCompanyConfigurationSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'SINGLETON', unique: true },

    /**
     * `null` se lit « aucune entreprise cliente rattachée à ce projet », et
     * c'est un ÉTAT — pas une absence de convergence. Il a des conséquences
     * exactes : ni paiement, ni signature.
     */
    clientCompanyId: { type: String, default: null },

    /**
     * L'IDENTIFIANT D'ENTITÉ DU PONT — celui que porte l'écriture.
     *
     * ══ POURQUOI IL NE SUFFIT PAS DE GARDER `clientCompanyId` ═════════════
     *
     * Le contrat impose `entityId: uuid`. L'identifiant métier du Panel n'en
     * est pas un : l'écriture porte donc un UUID DÉRIVÉ, tandis que la charge
     * utile porte l'identifiant lisible. Les deux ne sont pas comparables.
     *
     * Un TOMBSTONE, lui, n'a PAS de charge utile : il ne désigne l'entreprise
     * QUE par son `entityId`. Sans mémoriser celui-ci à l'application du
     * profil, le retrait ne pourrait jamais être rapproché de l'entreprise
     * courante — et serait donc soit toujours ignoré, soit toujours appliqué.
     * Les deux sont faux, et le second efface une entreprise valide.
     *
     * `null` sur les fiches appliquées avant ce champ : le retrait retombe
     * alors sur l'ancienne comparaison, qui reste juste pour elles.
     */
    bridgeEntityId: { type: String, default: null },

    environment: { type: String, enum: ['TEST', 'PROD', null], default: null },
    /**
     * La version PUBLIÉE appliquée localement. Elle sert à écarter une écriture
     * plus ancienne que celle déjà appliquée — le cas normal après un
     * rattrapage désordonné, où le journal se rejoue dans l'ordre du journal et
     * non dans celui des décisions.
     */
    version: { type: Number, default: null },

    /**
     * LE PROFIL TEL QUE LE PANEL LE PUBLIE — stocké en bloc.
     *
     * `Mixed` volontairement : c'est un objet de CONTRAT, validé à l'entrée par
     * `clientCompanyProfileSchema`. Le redéclarer champ par champ ici créerait
     * une seconde définition à maintenir, et c'est exactement le genre de
     * divergence qui fait perdre un champ en silence à la première évolution.
     */
    profile: { type: mongoose.Schema.Types.Mixed, default: null },

    appliedAt: { type: Date, default: null },
    source: { type: String, enum: ['BOOTSTRAP', 'SYNC', null], default: null },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const PanelCompanyConfiguration = mongoose.model(
  'PanelCompanyConfiguration',
  companyConfigurationSchema,
);

export const PanelClientCompanyConfiguration = mongoose.model(
  'PanelClientCompanyConfiguration',
  clientCompanyConfigurationSchema,
);

export default { PanelCompanyConfiguration, PanelClientCompanyConfiguration };
