// RX-BLOCKER-2 — E-mails d'authentification manager/client avec ROUTAGE d'expéditeur explicite (aucun sender
// hardcodé, aucun fallback MAIL_FROM) :
//   - invitation manager      → support     (technique plateforme)
//   - reset mot de passe manager → support
//   - reset mot de passe client  → commerciale (institut → client)
// Réutilise le moteur mail existant (templates code-définis, resolveSender M1, postToBrevo, DomainResolver
// flag-aware). Aucun token n'est journalisé.
import { resolveSender } from './communicationRoleResolver.js';
import { loadTemplate } from './mail/mailTemplateRuntime.js';
import { postToBrevo } from './mail/mailBrevoGateway.js';
import { withMailThemeVars, replaceTemplateVariables, stripHtml } from './mail/mailRenderer.js';
import { resolveFrontendUrl } from './system/frontendUrl.js';

const ROLE_LABEL = { admin: 'Administrateur', dev: 'Développeur', client: 'Client' };

/**
 * Envoi générique d'un e-mail d'auth. Résout l'expéditeur par rôle (support/commerciale), rend le template,
 * poste vers Brevo. Retourne false (contrôlé) si template/expéditeur indisponible — jamais de throw non géré.
 */
async function sendAuthMail({ user, fromRole, templateKey, link, extraVars = {}, tags = [] }) {
  try {
    const recipient = String(user?.email || '').trim();
    if (!recipient || !link) return false;

    const template = await loadTemplate(templateKey);
    if (!template) {
      console.warn(`[authMail] Template "${templateKey}" introuvable`);
      return false;
    }
    let sender;
    try {
      sender = await resolveSender(fromRole);
    } catch (senderErr) {
      // Identité de communication non configurée → erreur contrôlée, pas de fallback MAIL_FROM.
      console.warn(`[authMail] Expéditeur "${fromRole}" indisponible pour ${templateKey}: ${senderErr?.message || senderErr}`);
      return false;
    }
    if (!sender?.email) return false;

    const payloadData = await withMailThemeVars({
      firstname: user.firstName || '',
      lastname: user.lastName || '',
      link,
      ...extraVars
    });
    const subject = replaceTemplateVariables(template.subject, payloadData) || template.subject;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? replaceTemplateVariables(htmlTemplate, payloadData, { html: true }) || htmlTemplate : '';
    let textTemplate = template.bodyHtml || '';
    if (!textTemplate && template.fullHtml) textTemplate = stripHtml(template.fullHtml);
    const textContent = textTemplate ? replaceTemplateVariables(textTemplate, payloadData) || textTemplate : '';

    const payload = {
      sender: { email: sender.email, name: sender.name || 'Beauty Savage' },
      to: [{ email: recipient }],
      subject,
      tags: ['transactional', ...tags]
    };
    if (htmlContent) payload.htmlContent = htmlContent;
    if (textContent) payload.textContent = textContent;

    return await postToBrevo(payload, { contextType: 'user', contextId: String(user?._id || '') || null });
  } catch (error) {
    console.error(`[authMail] Envoi ${templateKey} impossible`, error?.message || error);
    return false;
  }
}

/** Invitation manager (expéditeur support). Lien /manager/invitation/:token (flag-aware, toujours React). */
export async function sendManagerInvitationEmail(user, token) {
  if (!token) return false;
  return sendAuthMail({
    user,
    fromRole: 'support',
    templateKey: 'manager_invitation',
    link: resolveFrontendUrl('manager-invitation', { token }),
    extraVars: { rolelabel: ROLE_LABEL[user?.role] || String(user?.role || ''), email: user?.email || '' },
    tags: ['manager_invitation']
  });
}

/** Reset mot de passe MANAGER (expéditeur support). Lien /manager/reinitialiser-mot-de-passe/:token. */
export async function sendManagerPasswordResetEmail(user, token) {
  if (!token) return false;
  return sendAuthMail({
    user,
    fromRole: 'support',
    templateKey: 'manager_password_reset',
    link: resolveFrontendUrl('manager-password-reset', { token }),
    tags: ['manager_password_reset']
  });
}

/** Reset mot de passe CLIENT (expéditeur commerciale). Lien /app/reinitialiser-mot-de-passe (flag-aware). */
export async function sendClientPasswordResetEmail(user, token) {
  if (!token) return false;
  return sendAuthMail({
    user,
    fromRole: 'commerciale',
    templateKey: 'password_reset',
    link: resolveFrontendUrl('password-reset', { token }),
    tags: ['password_reset']
  });
}
