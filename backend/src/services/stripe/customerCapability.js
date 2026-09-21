/**
 * LE CLIENT STRIPE D'UN CONTRAT — demandé, plus créé (L6.2D).
 *
 * ══ CE QUI A CHANGÉ ═════════════════════════════════════════════════════════
 *
 * `ensureCustomer` appelait `customers.create` avec la clé Stripe du projet, et
 * décidait donc seul du compte qui portera la facturation de ce contrat.
 *
 * Il demande désormais `billing.customer.ensure`. Il apporte l'identité de la
 * personne à facturer — le Panel ne peut pas la deviner, sa projection de
 * contrat ne porte pas les signataires — et rien d'autre.
 *
 * ══ CE QU'IL NE PEUT PLUS FAIRE, ET C'EST VOULU ═════════════════════════════
 *
 * Il ne peut pas nommer l'acte. Le contrat d'entrée n'accepte AUCUN
 * `operationId` : le Panel le dérive du contrat vérifié. « Garantir le client de
 * ce contrat » n'a qu'une réponse correcte, et laisser le projet nommer l'acte
 * lui permettrait d'en obtenir deux — c'est-à-dire deux clients pour un même
 * engagement, deux historiques de facturation, et un prélèvement rattaché au
 * mauvais.
 *
 * Il ne peut pas non plus proposer un client à ADOPTER. Un identifiant présenté
 * par celui qui demande n'est pas une preuve de propriété ; le champ n'existe
 * pas dans le schéma, donc la question ne se pose jamais.
 *
 * ══ AUCUN REPLI ═════════════════════════════════════════════════════════════
 *
 * Panel injoignable ⇒ échec explicite. Un repli sur la clé locale créerait le
 * client sur un compte, et la session d'abonnement le chercherait sur l'autre.
 */
import { invokeCapability } from '../panelBridge/capabilityClient.js';

export const CUSTOMER_CAPABILITY = 'billing.customer.ensure';

/**
 * Garantit que ce contrat a son client Stripe, et rend son identifiant.
 *
 * `status: 'EXISTING'` n'est pas un échec : c'est la preuve que le Panel avait
 * déjà créé ce client et l'a retrouvé par son lien, au lieu d'en produire un
 * second. L'appelant doit le traiter comme un succès.
 *
 * @param {object} args
 * @param {object} args.contract  le contrat, tel que le projet le détient
 * @param {string} [args.email]   adresse du signataire CLIENT
 * @param {string} [args.name]    raison sociale du client, ou référence du contrat
 * @returns {Promise<{customerId: string, status: 'CREATED'|'EXISTING'}>}
 * @throws {BridgeError} LÈVE — il n'y a pas de repli local.
 */
export async function ensureCustomerViaPanel({ contract, email = '', name = '' }) {
  const envelope = await invokeCapability(CUSTOMER_CAPABILITY, {
    contractRef: String(contract._id),
    customer: {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    },
  });

  const result = envelope?.result ?? null;
  if (!result?.customerId) {
    const err = new Error('Le Panel n’a pas rendu de client Stripe exploitable.');
    err.code = 'CUSTOMER_RESULT_INVALID';
    throw err;
  }
  return result;
}

export default { CUSTOMER_CAPABILITY, ensureCustomerViaPanel };
