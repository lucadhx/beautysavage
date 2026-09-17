// services/mail/mailContextResolver.js
// Sprint F3B — Résolution du contexte business d'un envoi (contextType / contextId, dérivation
// tag → domaine, hash destinataire). Cette logique vit dans services/sendLogService.js
// (`createQueuedSendLog` dérive le contextType depuis le tag quand le contexte n'est pas fourni,
// `hashRecipient` ne stocke jamais l'email en clair). Ce module expose ces règles « safe » sous
// la frontière mail. Aucune modification de comportement : ré-export.

export { hashRecipient } from '../sendLogService.js';
