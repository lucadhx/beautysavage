import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { WEBHOOK_CONFIG_STATUS } from '../../utils/brevoWebhookConstants.js';
import { SUBSCRIBED_CONFIG_EVENTS } from '../../utils/brevoTransactionalEventRegistry.js';
import { encryptSecret, lastFourOf } from '../../utils/integratedApiCrypto.js';
import { resetOperationalProbeCooldown } from '../../services/email/brevoOperational.service.js';

/**
 * Outillage de test pour la règle « pas de suivi, pas d'envoi ».
 *
 * Depuis que le suivi de livraison est obligatoire, un envoi ne PEUT plus
 * réussir dans un test sans que le webhook soit opérationnel. C'est voulu : si
 * un test envoie un e-mail sans l'avoir déclaré, c'est que le garde-fou serait
 * contournable en production aussi.
 *
 * Ces aides rendent donc l'état opérationnel EXPLICITE dans chaque scénario,
 * plutôt que de le supposer.
 */

/**
 * L'ADRESSE DE RECETTE NE NOMME AUCUN PROJET.
 *
 * Elle valait `tests.sbauto.invalid`. Le domaine `.invalid` est réservé et ne
 * résout nulle part : il n'y avait donc aucun risque — seulement le nom d'un
 * client, recopié dans chaque projet issu de la fabrique, et relevé à chaque
 * balayage d'identité résiduelle. Une fixture doit être reconnaissable comme
 * fixture, pas comme un héritage.
 */
export const TEST_PUBLIC_URL = 'https://tests.projet.invalid';

/**
 * Rend Brevo pleinement opérationnel pour un mode : URL publique, webhook
 * enregistré et aligné, secret présent, joignabilité prouvée et encore valide.
 *
 * La santé est posée DIRECTEMENT (`healthyUntil` dans le futur) plutôt que
 * sondée : un test n'a pas de tunnel à joindre, et la sonde réseau a ses
 * propres tests dédiés.
 */
export async function makeBrevoOperational(mode = 'TEST', { ttlMs = 3_600_000 } = {}) {
  await SystemConfiguration.updateOne({}, { $set: { 'network.backendUrl': TEST_PUBLIC_URL } }, { upsert: true });

  const url = `${TEST_PUBLIC_URL}/api/webhooks/brevo/transactional/${mode.toLowerCase()}`;
  const doc = await IntegratedApi.findOne({ provider: 'BREVO' });
  if (!doc) throw new Error('IntegratedApi BREVO absent : lancer le bootstrap avant.');

  doc.modes[mode].credentials.set('webhookSecret', {
    encryptedValue: encryptSecret('secret-webhook-de-test'),
    lastFour: lastFourOf('secret-webhook-de-test'),
    updatedAt: new Date(),
  });
  doc.modes[mode].webhook = {
    webhookId: `wh-${mode.toLowerCase()}`,
    webhookUrl: url,
    subscribedEvents: [...SUBSCRIBED_CONFIG_EVENTS],
    authenticationType: 'BEARER',
    status: WEBHOOK_CONFIG_STATUS.CONFIGURED,
    active: true,
    lastSyncedAt: new Date(),
    healthStatus: 'HEALTHY',
    healthCheckedAt: new Date(),
    healthyUntil: new Date(Date.now() + ttlMs),
  };
  doc.markModified(`modes.${mode}.webhook`);
  doc.markModified(`modes.${mode}.credentials`);
  await doc.save();
  resetOperationalProbeCooldown(mode);
  return url;
}

/**
 * Casse la JOIGNABILITÉ sans toucher à la configuration : le webhook reste
 * enregistré et aligné, mais sa dernière preuve d'accessibilité a expiré. C'est
 * exactement le cas d'un tunnel de développement refermé.
 */
export async function expireWebhookHealth(mode = 'TEST') {
  await IntegratedApi.updateOne(
    { provider: 'BREVO' },
    {
      $set: {
        [`modes.${mode}.webhook.healthStatus`]: 'UNKNOWN',
        [`modes.${mode}.webhook.healthyUntil`]: new Date(Date.now() - 1000),
      },
    }
  );
  resetOperationalProbeCooldown(mode);
}

/** Retire complètement le webhook : cas « suivi jamais activé ». */
export async function removeWebhook(mode = 'TEST') {
  await IntegratedApi.updateOne(
    { provider: 'BREVO' },
    {
      $set: {
        [`modes.${mode}.webhook.status`]: WEBHOOK_CONFIG_STATUS.NOT_CONFIGURED,
        [`modes.${mode}.webhook.webhookId`]: null,
        [`modes.${mode}.webhook.active`]: false,
        [`modes.${mode}.webhook.healthStatus`]: 'UNKNOWN',
        [`modes.${mode}.webhook.healthyUntil`]: null,
      },
    }
  );
  resetOperationalProbeCooldown(mode);
}
