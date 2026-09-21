// LE CONTRAT DE VARIABLES D'UN MODÈLE, TEL QUE LE PANEL LE SERT.
//
// ── CE QUE CETTE COLLECTION REMPLACE, ET CE QU'ELLE N'EST PAS ───────────────
//
// Elle remplace `EmailTemplate` / `EmailTemplateVersion`, supprimées : ce
// projet tenait une base complète de modèles — sujet, HTML, versions,
// historique, interrupteur — que le Manager éditait et que le Panel n'expédiait
// jamais. Sept modèles sur quatorze y divergeaient du contenu réellement
// envoyé, sans que rien ne le signale.
//
// Elle N'EST PAS un cache de contenu. Il n'y a ici ni sujet, ni HTML, ni
// version de contenu, ni interrupteur : les remettre recréerait la seconde
// autorité qu'on vient de retirer, sous un autre nom. Ce qui est conservé est
// le VOCABULAIRE — quelles variables existent, lesquelles sont obligatoires, de
// quel type — et rien d'autre.
//
// ── POURQUOI LE VOCABULAIRE, LUI, DOIT ÊTRE CONSERVÉ ────────────────────────
//
// Le projet reste autorité de la FAÇON de produire les valeurs. Il a donc
// besoin de savoir ce qu'on attend de lui, et il en a besoin :
//
//   — HORS CONNEXION. Valider les variables avant de traverser le pont donne un
//     diagnostic précis et local (« `invoice.url` manque ») au lieu d'un refus
//     générique après un aller-retour réseau.
//
//   — POUR SE DÉCLARER. L'empreinte servie par le Panel est renvoyée dans la
//     déclaration d'usage : c'est elle qui rend un écart de contrat détectable
//     AVANT le premier envoi raté.
//
// ── POURQUOI UNE ABSENCE N'EST JAMAIS UN BLOCAGE ────────────────────────────
//
// Un projet fraîchement démarré, ou dont le Panel est injoignable, n'a pas
// encore ce contrat. Il doit pouvoir envoyer quand même : le Panel validera,
// puisque c'est lui l'autorité. Faire de ce cache une condition d'envoi en
// referait un veto local — exactement la faute que ce lot corrige.

import mongoose from 'mongoose';

const variableSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: '' },
    description: { type: String, default: '' },
    type: { type: String, required: true },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

const emailTemplateContractSchema = new mongoose.Schema(
  {
    templateCode: { type: String, required: true, unique: true },

    /** À qui appartient la communication, d'après le Panel. Informatif. */
    ownedBy: { type: String, enum: ['PANEL', 'PROJECT'], default: 'PROJECT' },

    variables: { type: [variableSchema], default: [] },

    /**
     * L'EMPREINTE SERVIE PAR LE PANEL — jamais recalculée ici.
     *
     * La recalculer localement supposerait que ce projet connaisse la règle de
     * hachage du Panel, donc qu'il la duplique, donc qu'elle puisse diverger :
     * on retrouverait deux vérités là où le lot n'en veut qu'une. Le projet
     * TRANSPORTE une valeur, il ne la reproduit pas.
     */
    fingerprint: { type: String, default: '' },

    /** Quand ce contrat a été lu chez le Panel. Sert au diagnostic. */
    refreshedAt: { type: String, default: null },
  },
  { minimize: false, versionKey: false },
);

export const EmailTemplateContract = mongoose.model(
  'EmailTemplateContract',
  emailTemplateContractSchema,
);

export default EmailTemplateContract;
