// services/mail/mailTrackingService.js
// Sprint F3B — Couche de suivi des envois (SendLog). L'implémentation vit dans
// services/sendLogService.js (création SendLog queued, transitions sent/failed, hash
// destinataire, événements email.*). Ce module est le point d'accès « tracking » du domaine
// mail : la passerelle Brevo (mailBrevoGateway) y crée le SendLog queued puis le marque
// sent/failed. Aucune modification de comportement : simple ré-export.

export {
  createQueuedSendLog,
  markSendLogSent,
  markSendLogFailed
} from '../sendLogService.js';
