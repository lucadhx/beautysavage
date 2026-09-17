import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRouter from './routers/authRouter.js';
import modeRouter from './routers/modeRouter.js';
import vitrineRouter from './routers/vitrineRouter.js';
import vitrineGestionRouter from './routers/vitrineGestionRouter.js';
import clientRouter from './routers/clientRouter.js';
import businessGestionRouter from './routers/businessGestionRouter.js';
import devRouter from './routers/devRouter.js';
import gestionUsersRouter from './routers/gestionUsersRouter.js';
import adminsRouter from './routers/adminsRouter.js';
import themeRouter from './routers/themeRouter.js';
import themePublicRouter from './routers/themePublicRouter.js';
import uiConfigRouter from './routers/uiConfigRouter.js';
import formationRouter from './routers/formationRouter.js';
import formationModuleRouter from './routers/formationModuleRouter.js';
import formationSessionRouter from './routers/formationSessionRouter.js';
import planningRouter from './routers/planningRouter.js';
import salesRouter from './routers/salesRouter.js';
import commissionRouter from './routers/commissionRouter.js';
import commissionPaymentRouter from './routers/commissionPaymentRouter.js';
import vitrineFormationSessionRouter from './routers/vitrineFormationSessionRouter.js';
import giftCardRouter from './routers/giftCardRouter.js';
import giftCardGestionRouter from './routers/gestionGiftCardRouter.js';
import promotionRouter from './routers/promotionRouter.js';
import boostRouter from './routers/boostRouter.js';
import clientManagementRouter from './routers/clientManagementRouter.js';
import socialRouter from './routers/socialRouter.js';
import mailTemplateRouter from './routers/mailTemplateRouter.js';
import passwordResetRouter from './routers/passwordResetRouter.js';
import invoiceRouter from './routers/invoiceRouter.js';
import notificationRouter from './routers/notificationRouter.js';
import notificationDevRouter from './routers/notificationDevRouter.js';
import mailSupervisionDevRouter from './routers/mailSupervisionDevRouter.js';
import { mailDeliveriesAdminRouter, sendLogsAdminRouter } from './routers/mailSupervisionRouter.js';
import notificationCategoryRouter from './routers/notificationCategoryRouter.js';
import notificationTemplateStudioRouter from './routers/notificationTemplateStudioRouter.js';
import giftCardTemplateStudioRouter from './routers/giftCardTemplateStudioRouter.js';
import { runNotificationCategoryMigration } from './automatisme/notificationCategoryMigration.js';
import { startCommissionReminderJob } from './automatisme/commissionReminderJob.js';
import { runBookingRemindersJob } from './automatisme/bookingRemindersJob.js';
import { runFormationSessionRemindersJob } from './automatisme/formationSessionRemindersJob.js';
import { runEmailTemplateCategoryMigration } from './automatisme/emailTemplateCategoryMigration.js';
import { runServicePagesMigration } from './automatisme/servicePagesMigration.js';
import { migrateRefundRequestedTemplate } from './automatisme/refundRequestedTemplateMigration.js';
import { runNotificationConfigMigration } from './automatisme/notificationConfigMigration.js';
import { seedSystemConfigurationFromEnv } from './services/system/systemConfigurationService.js';
import { resolvePublicBaseUrl } from './services/system/domainResolver.js';
import { validateCredentialVaultKey } from './utils/credentialVault.js';
import { seedIntegratedApisFromEnv } from './seeders/seedIntegratedApisFromEnv.js';
import { seedDevCommunicationIdentity } from './seeders/seedDevCommunicationIdentity.js';
import { seedGiftCardTemplates } from './seeders/seedGiftCardTemplates.js';
import brevoWebhookRouter from './routers/brevoWebhookRouter.js';
import communicationIdentityDevRouter from './routers/communicationIdentityDevRouter.js';
import systemConfigurationDevRouter from './routers/systemConfigurationDevRouter.js';
import integratedApiDevRouter from './routers/integratedApiDevRouter.js';
import communicationIdentityRouter from './routers/communicationIdentityRouter.js';
import devDiagnosticRouter from './routers/devDiagnosticRouter.js';
import { registerNotificationSubscribers, getSubscriberMode } from './subscribers/notificationEventSubscriber.js';
import { registerMailEventSubscribers } from './subscribers/mailEventSubscriber.js';
import { migrateEmailTemplatesToVersioning } from './scripts/migrateEmailTemplatesToVersioning.js';
import siteIdentityRouter from './routers/siteIdentityRouter.js';
import contractRouter from './routers/contractRouter.js';
import serviceRouter from './routers/serviceRouter.js';
import learningManagerRouter from './routers/learningManagerRouter.js';
import learningClientRouter from './routers/learningClientRouter.js';
import evaluationManagerRouter from './routers/evaluationManagerRouter.js';
import evaluationClientRouter from './routers/evaluationClientRouter.js';
import practitionerRouter from './routers/practitionerRouter.js';
import availabilityRouter from './routers/availabilityRouter.js';
import gestionBookingRouter from './routers/gestionBookingRouter.js';
import customer360Router from './routers/customer360Router.js';
import managerUsersRouter from './routers/managerUsersRouter.js';
import { getManagerInvitation, acceptManagerInvitation } from './controllers/managerUsersController.js';
import financeRouter from './routers/financeRouter.js';
import calendarRouter from './routers/calendarRouter.js';
import serviceSettingsRouter from './routers/serviceSettingsRouter.js';
import vitrineServiceRouter, { vitrineAvailabilityRouter } from './routers/vitrineServiceRouter.js';
import { handleDevWebhook } from './controllers/devWebhookController.js';
import { contractGuard } from './middlewares/contractGuard.js';
import gestionPagesRouter from './routers/gestionPagesRouter.js';
import homeSettingsRouter from './routers/homeSettingsRouter.js';
import {
  siteStatusPublicRouter,
  siteStatusGestionRouter
} from './routers/siteStatusRouter.js';
import { ensurePurchaseIndexes } from './models/Purchase.js';
import Invoice from './models/Invoice.js';
import ContractCheckoutIntent from './models/ContractCheckoutIntent.js';
import Contract from './models/Contract.js';
import CommissionPayment from './models/CommissionPayment.js';
import Service from './models/Service.js';
import Review from './models/Review.js';
import ScheduleException from './models/ScheduleException.js';
import Sale from './models/Sale.js';
import RefundRequest from './models/RefundRequest.js';
import { REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME } from './constants/refundRequest.js';

import { startSessionCancellationAutoRefundScheduler } from './automatisme/sessionCancellationAutoRefundJob.js';
import { startRefundRecoveryScheduler } from './automatisme/refundRecoveryJob.js';
import { startContractPaymentSyncJob } from './automatisme/contractPaymentSyncJob.js';
import { startPendingPaymentCleanupJob } from './automatisme/pendingPaymentCleanupJob.js';
import { startGiftCardRecreditRecoveryScheduler } from './automatisme/giftCardRecreditRecoveryJob.js';
import {
  gestionRouter as editableContentGestionRouter,
  vitrineRouter as editableContentVitrineRouter
} from './routers/editableContentRouter.js';
import { requireAuth, getSessionSecret } from './utils/session.js';
import { requireMode } from './middlewares/modeGuard.js';
import { maintenanceGuard } from './middlewares/maintenanceGuard.js';
import { requireGestionRole } from './middlewares/gestionRoleGuard.js';
import { mountReactFrontend, redirectToReactWhenOfficial, isReactOfficialFrontend } from './services/system/reactFrontend.js';
import stripeRouter from './routers/stripeRouter.js';
import projectBridgeRouter from './routers/projectBridgeRouter.js';
import {
  countPendingStripeFeesSales,
  listPendingStripeFeesSales,
  recoverStripeFeesAndUpdateSale,
  registerPendingStripeFeeCreatedListener
} from './services/stripe/stripeFeeService.js';
import { cleanupExpiredGiftCardReservations } from './services/giftCardReservationService.js';
import { getRefundByTrackingToken } from './controllers/salesController.js';
import { assertBusinessTimezone } from './constants/timezone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sprint pré-React A2 — Garde fuseau métier. Logge le fuseau métier (Europe/Paris)
// vs le fuseau serveur détecté et avertit en cas de divergence. Hors test, force
// process.env.TZ=Europe/Paris dès le démarrage pour que les créneaux calendrier
// (construits en heure murale locale) soient toujours interprétés en Europe/Paris.
// En test, on NE force PAS (l'app est importée par supertest — voir constants/timezone.js).
assertBusinessTimezone({ force: process.env.NODE_ENV !== 'test' });

const app = express();
app.set('trust proxy', 1);
const STRIPE_FEES_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
const GIFT_CARD_RESERVATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const GIFT_CARD_RESERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
let stripeFeesRecoveryInterval = null;
let stripeFeesRecoveryRunning = false;
let giftCardReservationCleanupInterval = null;
let giftCardReservationCleanupRunning = false;

function stopStripeFeesRecoveryScheduler(logMessage = '') {
  if (!stripeFeesRecoveryInterval) return;
  clearInterval(stripeFeesRecoveryInterval);
  stripeFeesRecoveryInterval = null;
  if (logMessage) {
    console.log(logMessage);
  }
}

async function runStripeFeesRecoveryCycle(trigger = 'interval') {
  if (stripeFeesRecoveryRunning) return;
  stripeFeesRecoveryRunning = true;
  try {
    const pendingSales = await listPendingStripeFeesSales(500);
    if (!pendingSales.length) {
      stopStripeFeesRecoveryScheduler('[Stripe Fees Job] Aucune vente en attente. Arret automatique.');
      return;
    }

    console.log(
      `[Stripe Fees Job] (${trigger}) Traitement de ${pendingSales.length} vente(s) en attente de frais Stripe.`
    );
    for (const sale of pendingSales) {
      const saleId = String(sale?.saleId || '').trim() || 'N/A';
      const paymentIntentId = String(sale?.stripePaymentIntentId || '').trim();
      if (!paymentIntentId) {
        console.log(`[Stripe Fees Job] ${saleId}: PaymentIntent absent, skip.`);
        continue;
      }
      try {
        const result = await recoverStripeFeesAndUpdateSale({
          paymentIntentId,
          saleId,
          attempts: 1,
          retryDelayMs: 0
        });
        if (result.updated) {
          console.log(
            `[Stripe Fees Job] ${saleId}: frais recuperes (fee=${result.fee}, net=${result.net}, currency=${result.currency}).`
          );
        } else {
          console.log(`[Stripe Fees Job] ${saleId}: donnees Stripe encore indisponibles.`);
        }
      } catch (error) {
        console.error(`[Stripe Fees Job] ${saleId}: echec recuperation frais Stripe`, error);
      }
    }

    const remaining = await countPendingStripeFeesSales();
    if (!remaining) {
      stopStripeFeesRecoveryScheduler('[Stripe Fees Job] Toutes les ventes en attente ont ete traitees.');
      return;
    }
    console.log(`[Stripe Fees Job] ${remaining} vente(s) toujours en attente.`);
  } catch (error) {
    console.error('[Stripe Fees Job] Erreur cycle de recuperation', error);
  } finally {
    stripeFeesRecoveryRunning = false;
  }
}

function startStripeFeesRecoveryScheduler(trigger = 'startup') {
  if (stripeFeesRecoveryInterval) {
    void runStripeFeesRecoveryCycle(trigger);
    return;
  }
  console.log(`[Stripe Fees Job] Demarrage scheduler (intervalle 10 min, trigger=${trigger}).`);
  stripeFeesRecoveryInterval = setInterval(() => {
    void runStripeFeesRecoveryCycle('interval');
  }, STRIPE_FEES_RECOVERY_INTERVAL_MS);
  void runStripeFeesRecoveryCycle(trigger);
}

async function runGiftCardReservationCleanupCycle(trigger = 'interval') {
  if (giftCardReservationCleanupRunning) return;
  giftCardReservationCleanupRunning = true;
  try {
    const result = await cleanupExpiredGiftCardReservations({
      olderThanMs: GIFT_CARD_RESERVATION_MAX_AGE_MS
    });
    if (result.modifiedCards > 0) {
      console.log(
        `[GiftCard Reservations Job] (${trigger}) ${result.modifiedCards} carte(s) nettoyee(s), cutoff=${result.cutoff?.toISOString?.() || 'n/a'}.`
      );
      return;
    }
    if (result.matchedCards > 0) {
      console.log(
        `[GiftCard Reservations Job] (${trigger}) ${result.matchedCards} carte(s) ciblees, aucune modif appliquee.`
      );
      return;
    }
    console.log(`[GiftCard Reservations Job] (${trigger}) Aucune reservation expiree.`);
  } catch (error) {
    console.error('[GiftCard Reservations Job] Erreur nettoyage reservations expirees', error);
  } finally {
    giftCardReservationCleanupRunning = false;
  }
}

function startGiftCardReservationCleanupScheduler(trigger = 'startup') {
  if (giftCardReservationCleanupInterval) {
    void runGiftCardReservationCleanupCycle(trigger);
    return;
  }
  console.log(
    `[GiftCard Reservations Job] Demarrage scheduler (intervalle 60 min, trigger=${trigger}).`
  );
  giftCardReservationCleanupInterval = setInterval(() => {
    void runGiftCardReservationCleanupCycle('interval');
  }, GIFT_CARD_RESERVATION_CLEANUP_INTERVAL_MS);
  void runGiftCardReservationCleanupCycle(trigger);
}

registerPendingStripeFeeCreatedListener(() => {
  startStripeFeesRecoveryScheduler('new-pending-sale');
});

const cspOptions = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdn.tailwindcss.com', 'https://js.stripe.com', 'https://cdn.jsdelivr.net'],
    styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    fontSrc: ["'self'", 'https:', 'data:'],
    connectSrc: ["'self'", 'https:', 'https://api.stripe.com'],
    frameAncestors: ["'self'"],
    // youtube-nocookie = embed « privacy-enhanced » (souvent utilisé par défaut) → sinon iframe bloquée.
    frameSrc: ["'self'", 'https://www.youtube.com', 'https://youtube.com', 'https://www.youtube-nocookie.com', 'https://youtube-nocookie.com', 'https://youtu.be', 'https://player.vimeo.com', 'https://www.loom.com', 'https://fast.wistia.net', 'https://js.stripe.com']
  }
};

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: cspOptions
}));
// RX-BLOCKER-2-FINAL — silence le log HTTP par requête en test (bruit qui donne l'impression que « rien ne se
// passe » et masque les récapitulatifs vitest). Aucun impact fonctionnel : morgan est purement du logging.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Cookie parser must run before protected Stripe routes (requireAuth)
// and Stripe router must stay before express.json() for webhook raw body.
const sessionSecret = getSessionSecret();
app.use(cookieParser(sessionSecret));

// Developer webhook must be mounted before stripeRouter AND express.json() (raw body required for signature verification)
app.post(
  '/api/stripe/dev-webhook',
  express.raw({ type: 'application/json' }),
  handleDevWebhook
);

app.use('/api/stripe', stripeRouter);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
// Surface de pont dédiée au panel : authentification par bridge token, jamais
// par le cookie d'un client ou d'un manager.
app.use('/api/project-bridge/v1', projectBridgeRouter);

function isStaticNavigation(req) {
  const path = req.path || '';
  return (
    req.method === 'GET' &&
    (path === '/' ||
      path === '/vitrine.html' ||
      path.startsWith('/js/') ||
      path.startsWith('/css/') ||
      path.startsWith('/images/') ||
      path.startsWith('/fonts/'))
  );
}

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  skip: isStaticNavigation,
  handler(req, res) {
    const info = req.rateLimit || {};
    const sessionId = req.sessionUserId || (req.cookies?.beautysavage_session || 'anonymous');
    console.warn('[RATE LIMIT] 429', {
      route: `${req.method} ${req.originalUrl}`,
      limiter: 'global',
      ip: req.ip,
      session: sessionId,
      current: info.current,
      limit: info.limit,
      resetAt: info.resetTime
    });
    return res.status(429).json({ ok: false, error: 'Trop de requêtes. Merci de réessayer plus tard.' });
  }
});
app.use(limiter);
app.use(maintenanceGuard());
app.post('/admin-login', (_req, res) => res.redirect(303, '/admin-login'));
app.use(contractGuard());

const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error('MONGODB_URI manquant dans .env');
  process.exit(1);
}
mongoose.set('strictQuery', true);
// Credential vault key check (blocks boot in production if absent/invalid).
validateCredentialVaultKey();
await mongoose.connect(mongoURI, {
  dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database'
});
await ensurePurchaseIndexes();
await runEmailTemplateCategoryMigration();
await runServicePagesMigration();
await migrateRefundRequestedTemplate();
await runNotificationConfigMigration();
await runNotificationCategoryMigration();
// S1 — SystemConfiguration : seed idempotent depuis le .env (parité) + chargement du
// cache mémoire lu synchronement par le DomainResolver. Non bloquant en cas d'échec.
try {
  await seedSystemConfigurationFromEnv();
} catch (systemConfigError) {
  console.warn('[systemConfiguration] seed/boot échoué — fallback env actif :', systemConfigError?.message || systemConfigError);
}
await Invoice.syncIndexes();
// Drop legacy non-sparse indexes on ContractCheckoutIntent before syncIndexes
for (const idx of ['stripePaymentIntentId_1', 'stripeSetupIntentId_1']) {
  try { await ContractCheckoutIntent.collection.dropIndex(idx); } catch (_) {}
}
await ContractCheckoutIntent.syncIndexes();
console.log('[DB] ContractCheckoutIntent indexes synchronized');
// Sync Contract indexes (drops any stale legacy indexes)
try { await Contract.collection.dropIndex('contractId_1'); } catch (_) {}
await Contract.syncIndexes();
console.log('[DB] Contract indexes synchronized');
await CommissionPayment.syncIndexes();
console.log('[DB] CommissionPayment indexes synchronized');
await Service.syncIndexes();
console.log('[DB] Service indexes synchronized');
await Review.syncIndexes();
console.log('[DB] Review indexes synchronized');
// Phase 1B-1: deterministically ensure the unique partial index on
// Sale.stripePaymentIntentId (one sale per Stripe PaymentIntent). Targeted
// createIndex (not syncIndexes) to avoid touching unrelated legacy index defs.
// Guarded: if legacy data already contains duplicate PaymentIntent ids, log a
// remediation message instead of crashing the boot (the runtime findOne guard +
// webhook E11000 handling still apply; the unique index activates once resolved).
try {
  await Sale.collection.createIndex(
    { stripePaymentIntentId: 1 },
    {
      unique: true,
      name: 'uniq_stripe_payment_intent',
      partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } }
    }
  );
  console.log('[DB] Sale.stripePaymentIntentId unique partial index ensured');
} catch (saleIndexError) {
  console.error(
    '[DB] Could not build the unique stripePaymentIntentId index — likely pre-existing ' +
      'duplicate PaymentIntent ids. Resolve duplicate sales then restart to enforce it.',
    saleIndexError?.message || saleIndexError
  );
}
try {
  await RefundRequest.collection.createIndex(
    { saleId: 1, itemId: 1, itemType: 1 },
    {
      unique: true,
      name: REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME,
      partialFilterExpression: {
        status: { $in: ['requested', 'pending', 'succeeded'] }
      }
    }
  );
  console.log('[DB] RefundRequest active sale+item unique partial index ensured');
} catch (refundIndexError) {
  console.error(
    '[DB] Could not build the unique active RefundRequest index - likely pre-existing ' +
      'duplicate active refunds. Resolve legacy duplicates then restart to enforce it.',
    refundIndexError?.message || refundIndexError
  );
}
// Drop non-unique legacy index on ScheduleException before adding unique one
try { await ScheduleException.collection.dropIndex('practitionerId_1_date_1'); } catch (_) {}
await ScheduleException.syncIndexes();
console.log('[DB] ScheduleException indexes synchronized');
console.log('MongoDB connectee');

app.use('/auth', authRouter);
app.use('/auth/password-reset', passwordResetRouter);
// RX-BLOCKER-2 — Acceptation d'invitation manager (public, token-based, sans auth).
app.get('/auth/manager-invitations/:token', getManagerInvitation);
app.post('/auth/manager-invitations/:token/accept', acceptManagerInvitation);
app.use('/api/mode', modeRouter);
app.use('/api/vitrine', vitrineRouter);
app.get('/api/refund-tracking/:token', getRefundByTrackingToken);
app.use('/api/webhooks/brevo', brevoWebhookRouter);
app.use('/api/gestion/pages-gestion', gestionPagesRouter);
app.use('/api/gestion', requireGestionRole());
// M1 — Identités de communication (mont AVANT le routeur /dev générique pour la spécificité du chemin).
app.use('/api/gestion/dev/communication-identities', communicationIdentityDevRouter);
app.use('/api/gestion/communication-identities', communicationIdentityRouter);
// M3A — Notifications dev (audience 'dev', strict dev) — AVANT le routeur /dev générique.
app.use('/api/gestion/dev/notifications', notificationDevRouter);
// M3A — Notifications manager (audience 'admin'). Monté ICI, AVANT les routeurs
// dev-only montés en masse sur '/api/gestion' (ex. commissionRouter avec
// requireStrictDev), qui sinon shadowent ce chemin et renvoient 403 aux admins.
app.use('/api/gestion/notifications', notificationRouter);
// M10 — Calendrier global institut (lecture seule, admin/dev). Monté ICI, AVANT les routeurs
// dev-only broad-mount sur '/api/gestion' (qui sinon shadowent ce chemin et renvoient 403).
app.use('/api/gestion/calendar', calendarRouter);
// M11B — Actions admin sur les réservations (detail/cancel/balance-paid/reschedule). Monté ICI,
// AVANT les routeurs dev-only broad-mount sur '/api/gestion' (ex. commissionRouter requireStrictDev)
// qui sinon shadowent '/api/gestion/bookings/*' et renvoient 403 aux admins (cf. M3A).
app.use('/api/gestion', gestionBookingRouter);
// M12 — Customer 360 (Client Hub, admin/dev). Monté ICI, AVANT les broad-mounts dev-only sur
// '/api/gestion' (sinon shadow 403 admins, cf. M3A/M11B).
app.use('/api/gestion/customers', customer360Router);
// RX2 — Espace Finance (Finance Dashboard, admin/dev). Monté ICI, AVANT les broad-mounts dev-only
// sur '/api/gestion' (commissionRouter requireStrictDev) qui sinon shadowent '/api/gestion/finance/*'
// et renvoient 403 aux admins (même raison que M12/M13/M3A).
app.use('/api/gestion/finance', financeRouter);
// M13 — Cartes cadeaux gestion (config, manuel, débit, lookup, librairie templates ADMIN/dev). Monté
// ICI, AVANT les broad-mounts dev-only sur '/api/gestion' (commissionRouter requireStrictDev, etc.)
// qui sinon shadowent '/api/gestion/gift-cards/*' et renvoient 403 aux admins (cf. M3A/M11B).
app.use('/api/gestion/gift-cards', giftCardGestionRouter);
// M3E — Supervision mail dev (mail-deliveries + send-logs stats), strict dev — AVANT /api/gestion/dev générique.
app.use('/api/gestion/dev', mailSupervisionDevRouter);
// M7 — Notification Studio dev (templates + catégories), strict dev — AVANT /api/gestion/dev générique.
app.use('/api/gestion/dev/notification-templates', notificationTemplateStudioRouter);
app.use('/api/gestion/dev/gift-card-templates', giftCardTemplateStudioRouter);
app.use('/api/gestion/dev/notification-categories', notificationCategoryRouter);
// S1 — Paramètres Système (config domaines/institut/localisation/fiscalité/maintenance), strict dev —
// chemin spécifique, monté AVANT le routeur /api/gestion/dev générique.
app.use('/api/gestion/dev/system-configuration', systemConfigurationDevRouter);
// LOT1 IntegratedAPI — Gestion des credentials chiffrés (Stripe institut/dev, Brevo), strict dev —
// chemin spécifique, monté AVANT le routeur /api/gestion/dev générique.
app.use('/api/gestion/dev/integrated-api', integratedApiDevRouter);
// RX-BLOCKER-2 — Gestion des comptes manager (dev-only) : chemin spécifique, AVANT les broad-mounts dev.
app.use('/api/gestion/manager-users', managerUsersRouter);
// M3E — Supervision mail admin (roleView=admin, institut/client). Monté AVANT les routeurs
// dev-only broad-mount sur '/api/gestion' (ex. commissionRouter requireStrictDev).
app.use('/api/gestion/mail-deliveries', mailDeliveriesAdminRouter);
app.use('/api/gestion/send-logs', sendLogsAdminRouter);
app.use('/api/gestion/dev', devDiagnosticRouter);
app.use('/api/gestion/vitrine', vitrineGestionRouter);
app.use('/api/gestion/business', businessGestionRouter);
// C2 — Expérience apprenant montée AVANT clientRouter (préfixe spécifique /api/client/learning).
app.use('/api/client/learning', learningClientRouter);
app.use('/api/client/evaluation', evaluationClientRouter);
app.use('/api/client', clientRouter);
app.use('/api/dev', devRouter);
app.use('/api/gestion/users', gestionUsersRouter);
app.use('/api/gestion/admins', adminsRouter);
app.use('/api/gestion/themes', themeRouter);
app.use('/api/gestion/ui-config', uiConfigRouter);
app.use('/api/gestion/formations', formationRouter);
// C1 — Catalogue : prestations + disponibilités + réglages montés AVANT les broad-mounts dev-only
// ('/api/gestion' commissionRouter = requireStrictDev) pour rester accessibles aux admins.
app.use('/api/gestion/services', serviceRouter);
app.use('/api/gestion/availability', availabilityRouter);
app.use('/api/gestion/service-settings', serviceSettingsRouter);
// C2 — Learning Studio + présence (admin/dev) monté AVANT les broad-mounts dev-only (même raison C1).
app.use('/api/gestion/learning', learningManagerRouter);
app.use('/api/gestion/evaluation', evaluationManagerRouter);
app.use('/api/gestion', formationModuleRouter);
app.use('/api/gestion', formationSessionRouter);
app.use('/api/gestion', planningRouter);
app.use('/api/gestion', salesRouter);
// RC1 — commissionRouter (broad-mount '/api/gestion' avec requireStrictDev) DÉPLACÉ après tous les
// routeurs admin spécifiques : son router.use(requireStrictDev) shadowait '/api/gestion/promotions',
// /boosts, /clients, /social-links, /site-identity, /home-settings, /editable-content, /practitioners
// (admins → 403, CONFIRMÉ empiriquement). Ses propres routes /commissions/* ne chevauchent rien.
app.use('/api/gestion/promotions', promotionRouter);
app.use('/api/vitrine/formations', vitrineFormationSessionRouter);
app.use('/api/client/gift-cards', giftCardRouter);
// (giftCardGestionRouter monté plus haut, AVANT les broad-mounts dev-only — voir M13/M3A.)
app.use('/api/gestion/boosts', boostRouter);
app.use('/api/gestion/clients', clientManagementRouter);
app.use('/api/gestion/social-links', socialRouter);
app.use('/api/gestion/mails', mailTemplateRouter);
app.use('/api/gestion/site-identity', siteIdentityRouter);
app.use('/api/gestion/home-settings', homeSettingsRouter);
app.use('/api/contract', contractRouter);
app.use('/api/commissions', commissionPaymentRouter);
app.use('/api/site-status', siteStatusPublicRouter);
app.use('/api/theme', themePublicRouter);
app.use('/api/gestion/site-status', siteStatusGestionRouter);
app.use('/api/gestion/editable-content', editableContentGestionRouter);
app.use('/api/vitrine/editable-content', editableContentVitrineRouter);
app.use('/api/gestion/practitioners', practitionerRouter);
// RC1 — commissionRouter monté ICI (en dernier des '/api/gestion'), APRÈS tous les routeurs admin
// spécifiques, pour que son requireStrictDev ne les shadow plus. Ses routes /commissions/* restent
// résolues (aucun routeur antérieur ne matche /commissions/*).
app.use('/api/gestion', commissionRouter);
// (serviceRouter / availabilityRouter / serviceSettingsRouter montés plus haut, AVANT les
//  broad-mounts dev-only — voir C1/M3A : commissionRouter (requireStrictDev) sur '/api/gestion'
//  shadowait ces routeurs spécifiques pour les admins.)
// (gestionBookingRouter monté plus haut, AVANT les broad-mounts dev-only — voir M11B/M3A.)
// (notificationRouter monté plus haut, AVANT les routeurs dev-only broad-mount — voir M3A.)
app.use('/api/vitrine/availability', vitrineAvailabilityRouter);
app.use('/api/vitrine/services', vitrineServiceRouter);

app.get(
  '/gestion.html',
  // RX1 — flag ON → manager React officiel (/manager/) ; OFF → comportement Vanilla historique.
  redirectToReactWhenOfficial('/manager/'),
  requireAuth({ redirectToLogin: true }),
  requireMode('gestion'),
  (req, res, next) => {
    const role = String(req.sessionUser?.role || '').trim().toLowerCase();
    if (role !== 'admin' && role !== 'dev') {
      return res.redirect('/vitrine.html');
    }
    return next();
  },
  (_req, _res, next) => next()
);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/reset-password', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'))
);

app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin-login', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'))
);
app.get('/maintenance', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'))
);

app.use('/', invoiceRouter);

// RX1 — React frontend officiel (progressif, rollback). Sert /app (vitrine) + /manager (manager) en
// SPA, AVANT le static Vanilla (aucun chevauchement). Le flag REACT_OFFICIAL_FRONTEND (défaut OFF)
// bascule les points d'entrée Vanilla vers React ; rollback = flag OFF.
mountReactFrontend(app);
// Bascule conditionnelle des entrées Vanilla (flag ON → redirige ; OFF → Vanilla sert).
app.get('/vitrine.html', redirectToReactWhenOfficial('/app/'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) =>
  res.redirect(isReactOfficialFrontend() ? '/app/' : '/vitrine.html')
);

// Test harness: in NODE_ENV==='test' (vitest), skip background schedulers and the
// HTTP listener so the Express app can be imported by supertest with no open
// handles or side effects. Business logic is unchanged — only startup side
// effects are gated behind this flag. The app instance is exported below.
if (process.env.NODE_ENV !== 'test') {
  // Pre-seed the credential vault from .env (idempotent). On failure, the app
  // keeps working via the temporary .env fallback (ALLOW_ENV_CREDENTIAL_FALLBACK).
  try {
    await seedIntegratedApisFromEnv();
  } catch (seedError) {
    console.error('[seed] IntegratedApi vault seed failed (continuing with .env fallback):', seedError?.message || seedError);
  }
  // LOT1 — DEV uniquement : assure une identité expéditrice 'commerciale' vérifiée pour que les
  // envois locaux (code de vérification signup) fonctionnent sans MAIL_FROM. No-op en production.
  try {
    await seedDevCommunicationIdentity();
  } catch (devIdentityError) {
    console.error('[seed] dev communication identity seed failed:', devIdentityError?.message || devIdentityError);
  }
  // Phase 5A: normalise EmailTemplate docs to the versioned model (idempotent,
  // content untouched). loadTemplate also tolerates un-migrated docs.
  try {
    const tplMigration = await migrateEmailTemplatesToVersioning({ apply: true });
    console.log('[boot] EmailTemplate versioning migration:', JSON.stringify(tplMigration));
  } catch (tplError) {
    console.error('[boot] EmailTemplate versioning migration failed:', tplError?.message || tplError);
  }
  // M13 — Seed du template carte cadeau par défaut (idempotent). Garantit qu'il existe toujours
  // au moins un template actif (règle "jamais zéro template actif").
  try {
    const gcTplSeed = await seedGiftCardTemplates();
    console.log('[boot] GiftCardTemplate seed:', JSON.stringify(gcTplSeed));
  } catch (gcTplError) {
    console.error('[boot] GiftCardTemplate seed failed:', gcTplError?.message || gcTplError);
  }
  // Phase 4D/4E: EventBus -> Notification subscribers. Mode off|shadow|active via
  // EVENT_NOTIFICATION_SUBSCRIBER_MODE (default off; legacy alias
  // ENABLE_EVENT_NOTIFICATION_SUBSCRIBERS=true => active). In-app only; the direct
  // triggerNotification() calls remain during the transition.
  const subscriberMode = getSubscriberMode();
  if (subscriberMode !== 'off') {
    registerNotificationSubscribers();
    console.log(`[boot] Notification event subscribers registered (mode=${subscriberMode}).`);
  }
  // M2 — Mail event dispatch (no-op tant que MAIL_ROLE_RESOLVER_ENABLED=false ; shadow ensuite).
  registerMailEventSubscribers();
  await startSessionCancellationAutoRefundScheduler();
startCommissionReminderJob();
// Booking reminders — check every hour
setInterval(() => { void runBookingRemindersJob(); }, 3600000);
void runBookingRemindersJob();
// LOT2 §5 — Formation session reminders (scheduler dédié) — check every hour
setInterval(() => { void runFormationSessionRemindersJob(); }, 3600000);
void runFormationSessionRemindersJob();
startRefundRecoveryScheduler('startup');
startStripeFeesRecoveryScheduler('startup');
startGiftCardReservationCleanupScheduler('startup');
startContractPaymentSyncJob();
startPendingPaymentCleanupJob();
startGiftCardRecreditRecoveryScheduler();

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Serveur demarre http://localhost:${PORT}`);
  // S1C — base publique = SystemConfiguration (Paramètres Système) via le DomainResolver
  // (localhost au premier boot). Plus aucune dépendance au tunnel de dev.
  const publicBase = resolvePublicBaseUrl();
  console.log(`\u{1F517} Stripe Institut webhook : ${publicBase}/api/stripe/webhook`);
  console.log(`\u{1F517} Stripe Dev webhook     : ${publicBase}/api/stripe/dev-webhook`);
  console.log('\u{1F449} Configure ces URLs dans tes dashboards Stripe (Institut + Developer).');
  console.log('   Dev webhook events : payment_intent.succeeded, setup_intent.succeeded,');
  console.log('   invoice.payment_succeeded/failed, customer.subscription.updated/deleted.');
  });
}

export default app;
