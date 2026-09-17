// services/mail/mailBrevoGateway.js
// Sprint F3B — Split de mailService (extraction PUREMENT STRUCTURELLE, comportement
// identique). Bloc déplacé verbatim depuis services/mailService.js ; seuls les imports/exports
// et les chemins des imports dynamiques ont été adaptés au nouvel emplacement.

import { getCredential } from '../integratedApiCredentialService.js';
import { createQueuedSendLog, markSendLogSent, markSendLogFailed } from './mailTrackingService.js';

async function postToBrevo(payload, context = {}) {
  // Observability: create a queued SendLog, then mark sent/failed. All SendLog
  // ops are defensive (never break the email flow). `context` optionally attaches
  // a business contextType/contextId (else contextType is derived from the tag).
  const sendLog = await createQueuedSendLog(payload, context);

  let apiKey = '';
  try {
    apiKey = String((await getCredential('brevo', { role: 'api_key' })) || '').trim();
  } catch (_err) {
    apiKey = '';
  }

  if (!apiKey) {
    console.error('[mailService] API_KEY_MISSING: cle Brevo (brevo/api_key) absente du coffre, email non envoye');
    await markSendLogFailed(sendLog, { errorCode: 'API_KEY_MISSING', errorMessageSafe: 'Brevo API key unavailable' });
    return false;
  }

  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    console.error('[mailService] Brevo injoignable', networkError?.message || networkError);
    await markSendLogFailed(sendLog, { errorCode: 'network_error', errorMessageSafe: 'Brevo request failed' });
    return false;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[mailService] Brevo a refusé le mail', response.status, body);
    await markSendLogFailed(sendLog, { errorCode: `http_${response.status}`, errorMessageSafe: 'Brevo rejected the message' });
    return false;
  }

  let providerMessageId = '';
  try {
    const data = await response.json();
    providerMessageId = String(data?.messageId || '').trim();
  } catch (_err) {
    providerMessageId = '';
  }
  await markSendLogSent(sendLog, { providerMessageId });
  return true;
}




export {
  postToBrevo
};
