/**
 * POSER LE SECRET DE VÉRIFICATION STRIPE, COMME LE PANEL LE POSE (L6.3 FINAL).
 *
 * ══ POURQUOI CE HELPER EXISTE ═══════════════════════════════════════════════
 *
 * Les suites amorçaient Stripe par l'API du projet :
 *
 *     PUT /api/integrated-apis/STRIPE/modes/TEST
 *         { credentials: { secretKey: 'sk_test_…', webhookSecret: 'whsec_…' } }
 *
 * Cette route REFUSE désormais toute écriture : Stripe est administré par la
 * plateforme, et le projet ne détient plus de clé d'appel. C'est précisément ce
 * que le lot verrouille — et les suites devaient donc cesser de faire ce qu'un
 * projet ne peut plus faire.
 *
 * ══ CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ══════════════════════════════════
 *
 * Il écrit UNIQUEMENT le `whsec_` de vérification, directement dans le coffre —
 * exactement par le chemin qu'emprunte `panelWebhookProvisioning` quand le
 * Panel livre ce secret (L6.3A). Aucune clé d'appel n'est posée, et il n'existe
 * plus aucun moyen d'en poser une.
 *
 * Écrire en base plutôt que par l'API n'est pas un contournement : c'est
 * reproduire le SEUL chemin d'écriture qui subsiste en production.
 */
import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import { encryptSecret, lastFourOf } from '../../utils/integratedApiCrypto.js';

/**
 * @param {string} secret   le `whsec_…` que le Panel aurait livré
 * @param {'TEST'|'PROD'} [mode]
 */
export async function seedStripeVerificationSecret(secret, mode = 'TEST') {
  const doc = await IntegratedApi.findOne({ provider: 'STRIPE' });
  if (!doc) throw new Error('STRIPE absent du registre : `bootstrap()` doit précéder.');
  doc.enabled = true;
  doc.modes[mode].credentials.set('webhookSecret', {
    encryptedValue: encryptSecret(secret),
    lastFour: lastFourOf(secret),
    updatedAt: new Date(),
  });
  doc.markModified(`modes.${mode}.credentials`);
  await doc.save();
  return doc;
}

export default seedStripeVerificationSecret;
