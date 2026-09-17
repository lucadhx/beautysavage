import { resolveSender } from '../communicationRoleResolver.js';

// Résolution de l'expéditeur des envois e-mail legacy directs.
// SOURCE UNIQUE = CommunicationIdentity (identité 'commerciale'/'support' active ET vérifiée).
//
// LOT1 — le vestige de fallback `.env MAIL_FROM`/`MAIL_FROM_NAME` a été SUPPRIMÉ : il masquait
// une identité non configurée derrière une valeur d'environnement dev-only, et laissait la prod
// dropper silencieusement les e-mails. L'expéditeur vient désormais EXCLUSIVEMENT de la base.
// En développement, un seed crée une identité 'commerciale' vérifiée (seedDevCommunicationIdentity)
// pour que les envois locaux (dont le code de vérification signup) fonctionnent.
//
// `buildSenderForRole` renvoie `null` quand aucune identité vérifiée n'existe (compat avec les
// 12 dispatchers legacy qui avalent ce cas) ; les appels CRITIQUES utilisent `resolveSenderStrict`
// qui lève une `SenderNotConfiguredError` typée (jamais d'échec silencieux).

/** Erreur typée : aucune identité expéditrice vérifiée pour le rôle demandé. */
export class SenderNotConfiguredError extends Error {
  constructor(role) {
    super(`[mailSender] SENDER_NOT_CONFIGURED: aucune identité expéditrice vérifiée pour le rôle "${role}".`);
    this.name = 'SenderNotConfiguredError';
    this.code = 'SENDER_NOT_CONFIGURED';
    this.role = role;
  }
}

async function resolveConfiguredSender(role) {
  const normalizedRole = role === 'support' ? 'support' : 'commerciale';
  const sender = await resolveSender(normalizedRole); // throws si identité absente/non vérifiée
  const email = String(sender?.email || '').trim();
  if (!email) return null;
  const name = String(sender?.name || '').trim();
  return { email, name: name || undefined };
}

/**
 * Expéditeur pour un rôle, ou `null` si non configuré (usage non critique — l'appelant avale).
 * @param {'commerciale'|'support'} [role]
 * @returns {Promise<{email:string, name?:string}|null>}
 */
export async function buildSenderForRole(role = 'commerciale') {
  try {
    return await resolveConfiguredSender(role);
  } catch (_err) {
    return null; // identité non configurée → l'appelant legacy loggue + ignore
  }
}

/**
 * Expéditeur pour un rôle — FAIL-LOUD (usage critique : code de vérification, reset…).
 * @throws {SenderNotConfiguredError} si aucune identité vérifiée.
 */
export async function resolveSenderStrict(role = 'commerciale') {
  const sender = await buildSenderForRole(role);
  if (!sender) throw new SenderNotConfiguredError(role === 'support' ? 'support' : 'commerciale');
  return sender;
}

// Rétro-compat : l'expéditeur commerciale (institut → client) reste le défaut historique.
export async function buildSender() {
  return buildSenderForRole('commerciale');
}
