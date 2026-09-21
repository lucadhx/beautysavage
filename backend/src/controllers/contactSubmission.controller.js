import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import {
  listSubmissions,
  getSubmission,
  unreadCount,
  markRead,
  resolve,
  reopen,
  serializeDetail,
  serializeSummary,
} from '../services/contact/contactSubmission.service.js';
import { notificationSummaries, notificationDetail } from '../services/contact/contactNotification.service.js';

/**
 * Demandes de contact — ADMIN et DEV.
 *
 * CYCLE DE VIE SIMPLE : non lue → lue → résolue. Aucune route de création (une
 * demande est un fait déposé par un visiteur), aucune suppression (une résolue
 * sort du flux sans être détruite), aucun statut arbitraire modifiable par le
 * client : seulement des actions serveur dédiées (`/read`, `/resolve`, `/reopen`).
 */

/** GET /api/admin/contact-submissions — non résolues par défaut, non lues d'abord. */
export const list = asyncHandler(async (req, res) => {
  const page = await listSubmissions(req.query);

  // État de notification en LOT (évite le N+1). Le DÉTAIL technique reste réservé
  // au DEV via la page « Événements système » — ici, seul un résumé sûr transite.
  const summaries = await notificationSummaries(page.items.map((i) => i.submissionId));

  ok(res, {
    items: page.items.map((item) => ({
      ...item,
      notification: summaries.get(item.submissionId) || null,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    unreadCount: await unreadCount(),
  });
});

/** GET /api/admin/contact-submissions/unread-count — badge sidebar (léger). */
export const getUnreadCount = asyncHandler(async (req, res) => {
  ok(res, { count: await unreadCount() });
});

/**
 * GET /api/admin/contact-submissions/:submissionId
 *
 * Ouvrir le détail = LIRE. Marquage automatique, conditionnel et idempotent : le
 * Manager n'a pas à penser à déclencher un « marquer comme lu ».
 */
export const getOne = asyncHandler(async (req, res) => {
  const doc = await getSubmission(req.params.submissionId, { markViewed: true });
  ok(res, {
    ...serializeDetail(doc),
    notification: await notificationDetail(req.params.submissionId),
  });
});

/** PATCH /api/admin/contact-submissions/:submissionId/read — idempotent. */
export const patchRead = asyncHandler(async (req, res) => {
  ok(res, serializeSummary(await markRead(req.params.submissionId)));
});

/** PATCH /api/admin/contact-submissions/:submissionId/resolve — idempotent. */
export const patchResolve = asyncHandler(async (req, res) => {
  ok(res, serializeSummary(await resolve(req.params.submissionId, { actor: req.user })));
});

/** PATCH /api/admin/contact-submissions/:submissionId/reopen — idempotent. */
export const patchReopen = asyncHandler(async (req, res) => {
  ok(res, serializeSummary(await reopen(req.params.submissionId, { actor: req.user })));
});
