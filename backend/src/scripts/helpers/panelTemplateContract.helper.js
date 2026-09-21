// LE CONTRAT DE MODÈLES DU PANEL, LU DEPUIS UNE RECETTE DE CE PROJET.
//
// ── POURQUOI CE HELPER EXISTE (L12.1) ───────────────────────────────────────
//
// Plusieurs recettes de ce projet ont besoin de connaître les variables d'un
// modèle — pour vérifier qu'un résolveur métier produit bien tout ce qu'on
// attend de lui, ou qu'aucun identifiant fournisseur ne fuit dans un message
// client. Elles le lisaient dans `utils/emailTemplateRegistry.js`, supprimé
// avec ce lot : le vocabulaire appartient au Panel.
//
// Le rétablir sous forme de fixture locale serait la duplication qu'on vient de
// retirer, déguisée en donnée de test — et elle divergerait exactement comme
// l'originale l'a fait, sans que rien ne le signale.
//
// Ce helper lit donc la SOURCE, dans le dépôt voisin.
//
// ── ET POURQUOI SON ABSENCE N'EST PAS UN SUCCÈS ─────────────────────────────
//
// Le Panel vit dans un autre dépôt : sur une machine qui ne l'a pas, ces
// contrôles ne peuvent pas tourner. Ils le DISENT (`available: false`) et
// l'appelant échoue explicitement. Le seul résultat inacceptable serait de
// croire la parité vérifiée alors que personne ne l'a regardée.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REGISTRE = path.resolve(
  ICI, '../../../../../Panel/backend/src/services/email/panelEmailTemplateRegistry.js',
);
const DEFINITIONS = path.resolve(
  ICI, '../../../../../Panel/backend/src/services/email/panelEmailTemplateDefinitions.js',
);

let cache = null;

/**
 * Rend `{ available, variablesFor, templateCodes, templateDefinition }`.
 *
 * `variablesFor(code)` rend `[]` pour un code inconnu — jamais `undefined` :
 * un appelant qui itère dessus ne doit pas échouer sur une forme, il doit
 * échouer sur un contenu.
 */
export async function loadPanelTemplateContract() {
  if (cache) return cache;

  if (!fs.existsSync(REGISTRE) || !fs.existsSync(DEFINITIONS)) {
    cache = {
      available: false,
      reason: `Registre du Panel introuvable (${REGISTRE}).`,
      variablesFor: () => [],
      templateCodes: () => [],
      templateDefinition: () => null,
    };
    return cache;
  }

  const url = (p) => `file://${p.replace(/\\/g, '/')}`;
  const registre = await import(url(REGISTRE));
  const definitions = await import(url(DEFINITIONS));

  cache = {
    available: true,
    reason: '',
    variablesFor: (code) => (registre.isKnownTemplateId(code) ? registre.variablesFor(code) : []),
    templateCodes: () => [...registre.EMAIL_TEMPLATE_IDS],
    templateDefinition: (code) => definitions.templateDefinition(code),
  };
  return cache;
}

export default { loadPanelTemplateContract };
