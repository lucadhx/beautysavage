// seeders/seedDevCommunicationIdentity.js
// DEV-ONLY. Crée/assure une identité expéditrice 'commerciale' (scope institute) ACTIVE et
// VÉRIFIÉE pour que les envois e-mail locaux fonctionnent après la suppression du vestige
// MAIL_FROM (LOT1). En production, ne fait RIEN : l'identité doit y être créée + vérifiée par
// OTP via le Communication Center. N'introduit AUCUNE variable d'environnement expéditrice.
//
// Idempotent : si une identité 'commerciale' active existe déjà, on la laisse (on la promeut en
// 'verified' si besoin). L'adresse dev vient de SystemConfiguration.institute.email si présente,
// sinon d'un défaut local.

import CommunicationIdentity from '../models/CommunicationIdentity.js';

const DEV_DEFAULT_EMAIL = 'no-reply@beautysavage.dev';
const DEV_DEFAULT_NAME = 'Beauty Savage';

function isProd() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

async function resolveDevSenderEmail() {
  // Réutilise l'e-mail institut si configuré (SystemConfiguration), sinon défaut dev local.
  try {
    const { resolveInstituteEmail } = await import('../services/system/systemConfigurationService.js');
    const email = String(resolveInstituteEmail() || '').trim().toLowerCase();
    if (email) return email;
  } catch (_err) {
    /* ignore — config indisponible au boot */
  }
  return DEV_DEFAULT_EMAIL;
}

/**
 * @param {{force?: boolean}} [opts] force=true : exécute même en prod (réservé aux tests).
 * @returns {Promise<{created:boolean, promoted:boolean, skipped:boolean, email?:string}>}
 */
export async function seedDevCommunicationIdentity(opts = {}) {
  if (isProd() && !opts.force) {
    return { created: false, promoted: false, skipped: true };
  }

  const existingActive = await CommunicationIdentity.findOne({ role: 'commerciale', scope: 'institute', active: true });
  if (existingActive) {
    if (existingActive.status !== 'verified') {
      existingActive.status = 'verified';
      existingActive.providerVerificationStatus = existingActive.providerVerificationStatus || 'verified';
      existingActive.providerVerifiedAt = existingActive.providerVerifiedAt || new Date();
      await existingActive.save();
      return { created: false, promoted: true, skipped: false, email: existingActive.email };
    }
    return { created: false, promoted: false, skipped: true, email: existingActive.email };
  }

  const email = await resolveDevSenderEmail();
  // Réutilise un doc non-actif du même e-mail s'il existe, sinon crée.
  let identity = await CommunicationIdentity.findOne({ role: 'commerciale', scope: 'institute', email });
  const created = !identity;
  if (!identity) {
    identity = new CommunicationIdentity({ role: 'commerciale', scope: 'institute', email, displayName: DEV_DEFAULT_NAME });
  }
  identity.status = 'verified';
  identity.active = true;
  identity.provider = identity.provider || 'brevo';
  identity.providerVerificationStatus = 'verified';
  identity.providerVerifiedAt = identity.providerVerifiedAt || new Date();
  identity.verification = { ...(identity.verification?.toObject?.() || {}), verifiedAt: new Date(), lastErrorCode: '', lastErrorMessageSafe: '' };
  await identity.save();

  console.log(`[seedDevCommIdentity] identité 'commerciale' dev ${created ? 'créée' : 'promue'} (${email}) — active & vérifiée.`);
  return { created, promoted: !created, skipped: false, email };
}

export default seedDevCommunicationIdentity;
