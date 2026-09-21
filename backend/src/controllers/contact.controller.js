import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { created } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/eventPayloadSafety.js';
import { assessSubmission } from '../services/contact/contactAbuse.js';
import { createSubmission } from '../services/contact/contactSubmission.service.js';
import { recordContactDecision, CONTACT_DECISION } from '../services/contact/contactDiagnostics.js';

/**
 * Route PUBLIQUE de dépôt d'une demande de contact.
 *
 * ═══ LA RÉPONSE NE DIT RIEN DE L'INFRASTRUCTURE ══════════════════════════════
 *
 * Sortie : `{ submissionId }`. Rien d'autre. Ni l'état de l'e-mail, ni le nombre
 * d'administrateurs, ni un identifiant interne, ni une erreur Brevo.
 *
 * Deux raisons. D'abord la sécurité : chaque détail renvoyé à un inconnu est un
 * renseignement gratuit sur nos systèmes. Ensuite l'honnêteté : le visiteur n'a
 * pas à savoir si un e-mail est parti — ce qui le concerne, c'est que sa demande
 * est enregistrée, et elle l'est.
 *
 * ═══ LE SUCCÈS NE DÉPEND PAS DE LA NOTIFICATION ══════════════════════════════
 *
 * `createSubmission` persiste PUIS émet. Si l'e-mail échoue — Brevo indisponible,
 * expéditeur non vérifié, aucun administrateur — le visiteur reçoit quand même sa
 * confirmation, parce que sa demande existe. L'échec est visible dans le Manager.
 */
export const submitContact = asyncHandler(async (req, res) => {
  const { hpCheck: website, formStartedAt, ...data } = req.body;

  // --- Anti-abus : un SIGNAL, pas une décision -----------------------------
  const verdict = assessSubmission({ website, formStartedAt, message: data.message });

  if (!verdict.accept) {
    // ── RÉPONSE NEUTRE ──────────────────────────────────────────────────────
    //
    // On renvoie un succès ordinaire, avec un identifiant crédible. Répondre
    // « rejeté » apprendrait au robot exactement quoi corriger : il retirerait le
    // honeypot au premier essai, attendrait trois secondes au second.
    //
    // RIEN n'est créé : pas de ContactSubmission, pas d'événement, pas d'e-mail.
    // L'identifiant renvoyé ne correspond à aucune demande — c'est le but.
    //
    // Le prix, assumé : un humain victime d'un faux positif croirait sa demande
    // envoyée. C'est pourquoi chaque règle est réglée du côté permissif (cf.
    // contactAbuse.js), et pourquoi le rejet est journalisé — un pic de
    // `TOO_FAST` signalerait un seuil mal réglé.
    logger.warn(`Demande de contact rejetée (anti-abus : ${verdict.reason}) — aucune donnée enregistrée.`);
    // OBSERVABILITÉ DEV : la décision est tracée (sans le message) pour que la
    // recette puisse voir un rejet, là où la réponse neutre le cache au visiteur.
    recordContactDecision({
      decision: CONTACT_DECISION.REJECTED_AS_SPAM,
      reason: verdict.reason,
      emailMasked: maskEmail(data.email || ''),
    });
    return created(res, { submissionId: crypto.randomUUID() });
  }

  const { submission, deduplicated } = await createSubmission({
    ...data,
    // Le referrer est lu dans l'en-tête, jamais demandé au client : il n'a pas à
    // pouvoir le choisir. Borné pour ne pas dépendre de ce qu'envoie un tiers.
    referrerUrl: String(req.get('referer') || '').slice(0, 500),
    metadataSafe: {
      // FAMILLE de navigateur, jamais la chaîne User-Agent complète (qui est un
      // quasi-identifiant). « Chrome » suffit à diagnostiquer un bug d'affichage.
      userAgentFamily: userAgentFamily(req.get('user-agent')),
      locale: String(req.get('accept-language') || '').slice(0, 2).toLowerCase(),
    },
    // Signaux isolés (ex. honeypot rempli par autofill) : TRACÉS, jamais
    // bloquants. La demande est enregistrée normalement, en NON LU.
    antiAbuseSignals: verdict.signals,
  });

  if (deduplicated) {
    logger.info(`Demande de contact rejouée (idempotence) : ${submission.submissionId}`);
    recordContactDecision({
      decision: CONTACT_DECISION.DUPLICATE,
      emailMasked: maskEmail(submission.contact?.email || ''),
      submissionId: submission.submissionId,
    });
  } else {
    logger.info(
      `Demande de contact enregistrée : ${submission.submissionId} — ` +
        `${maskEmail(submission.contact.email)}, motif ${submission.reason}.`
    );
    recordContactDecision({
      decision: CONTACT_DECISION.ACCEPTED,
      emailMasked: maskEmail(submission.contact?.email || ''),
      submissionId: submission.submissionId,
      // Un signal isolé (autofill du honeypot) est TRACÉ ici, côté DEV, sans que
      // la demande soit dégradée pour autant.
      reason: verdict.signals.length ? verdict.signals.join('+') : null,
    });
  }

  created(res, { submissionId: submission.submissionId });
});

/**
 * Famille d'un User-Agent. Volontairement grossier : on veut « Chrome », pas
 * « Chrome/126.0.6478.127 Safari/537.36 » — cette précision-là identifie.
 *
 * L'ordre compte : Edge et Opera se déclarent aussi « Chrome », Chrome se déclare
 * « Safari ». On teste donc du plus spécifique au plus générique.
 */
function userAgentFamily(ua) {
  const s = String(ua || '');
  if (!s) return '';
  if (/Edg\//i.test(s)) return 'Edge';
  if (/OPR\/|Opera/i.test(s)) return 'Opera';
  if (/SamsungBrowser/i.test(s)) return 'Samsung';
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/Chrome\//i.test(s)) return 'Chrome';
  if (/Safari\//i.test(s)) return 'Safari';
  return 'Autre';
}

export default { submitContact };
