/* Vérification (LECTURE SEULE) de la cohérence entitlement contrat <-> abonnement
 * <-> site. Usage : npm run contracts:verify-entitlements
 * Détecte : contrat vivant sans abonnement valide, abonnement actif mais contrat
 * incohérent, résiliation demandée non reflétée, site actif sans contrat servable.
 * N'écrit rien, n'affiche aucun secret. Code de sortie 1 si des anomalies. */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { verifyEntitlements } from '../services/reconciliation.service.js';
import { logger } from '../utils/logger.js';

await connectDatabase();
let anomalies = [];
try {
  const res = await verifyEntitlements();
  anomalies = res.anomalies;
  if (!anomalies.length) {
    logger.success(`Entitlements cohérents (${res.checked} contrat(s) vérifié(s)).`);
  } else {
    logger.warn(`${anomalies.length} anomalie(s) sur ${res.checked} contrat(s) :`);
    for (const a of anomalies) logger.warn(`  ${a.reference || '(site)'} : ${a.issue}${a.status ? ` [${a.status}/${a.subscription || '-'}]` : ''}`);
  }
} finally {
  await disconnectDatabase();
}
process.exit(anomalies.length ? 1 : 0);
