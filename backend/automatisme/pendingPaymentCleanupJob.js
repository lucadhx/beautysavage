import ServiceBooking from '../models/ServiceBooking.js';
import { PENDING_PAYMENT_EXPIRATION_MINUTES } from '../constants/serviceBooking.js';
import { releaseServiceBookingSlotLocks } from '../services/serviceAvailabilityService.js';

const JOB_INTERVAL_MS = 60 * 60 * 1000;

let cleanupIntervalId = null;
let cleanupRunning = false;

function buildCutoff(now = new Date()) {
  const reference = now instanceof Date ? now : new Date(now);
  return new Date(reference.getTime() - PENDING_PAYMENT_EXPIRATION_MINUTES * 60 * 1000);
}

function buildPendingPaymentQuery(cutoff) {
  return {
    status: 'pending_payment',
    paymentStatus: 'pending',
    saleId: null,
    stripePaymentIntentId: null,
    createdAt: { $lt: cutoff }
  };
}

async function cancelExpiredBooking(booking, now) {
  const bookingId = String(booking?.bookingId || '').trim();
  if (!bookingId) {
    return { cancelled: false, locksReleased: 0 };
  }

  const stillPending = await ServiceBooking.findOne({
    _id: booking._id,
    status: 'pending_payment',
    paymentStatus: 'pending',
    saleId: null,
    stripePaymentIntentId: null
  })
    .select({ bookingId: 1 })
    .lean();

  if (!stillPending) {
    return { cancelled: false, locksReleased: 0 };
  }

  const releaseResult = await releaseServiceBookingSlotLocks({ bookingId });
  const locksReleased = Number(releaseResult?.deletedCount || 0);

  const updateResult = await ServiceBooking.updateOne(
    {
      _id: booking._id,
      status: 'pending_payment',
      paymentStatus: 'pending',
      saleId: null,
      stripePaymentIntentId: null
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: 'system',
        paymentStatus: 'cancelled',
        updatedAt: now
      }
    }
  );

  return {
    cancelled: Number(updateResult?.modifiedCount || 0) > 0,
    locksReleased
  };
}

export async function runPendingPaymentCleanup({ now = new Date() } = {}) {
  const reference = now instanceof Date ? now : new Date(now);
  const cutoff = buildCutoff(reference);
  const summary = {
    cutoff,
    inspectedCount: 0,
    cancelledCount: 0,
    locksReleasedCount: 0
  };

  try {
    const expiredBookings = await ServiceBooking.find(buildPendingPaymentQuery(cutoff))
      .select({ bookingId: 1 })
      .sort({ createdAt: 1 })
      .lean();

    summary.inspectedCount = expiredBookings.length;

    for (const booking of expiredBookings) {
      try {
        const outcome = await cancelExpiredBooking(booking, reference);
        if (outcome.cancelled) {
          summary.cancelledCount += 1;
          summary.locksReleasedCount += outcome.locksReleased;
        }
      } catch (error) {
        console.error('[PendingPaymentCleanup] booking cleanup failed', {
          bookingId: String(booking?.bookingId || '').trim() || 'n/a',
          message: error?.message || 'unknown error'
        });
      }
    }

    if (summary.inspectedCount > 0) {
      console.log(
        `[PendingPaymentCleanup] cutoff=${cutoff.toISOString()} inspected=${summary.inspectedCount} cancelled=${summary.cancelledCount} locksReleased=${summary.locksReleasedCount}`
      );
    }
  } catch (error) {
    console.error('[PendingPaymentCleanup] cleanup cycle failed', error);
  }

  return summary;
}

async function runCleanupCycle() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    await runPendingPaymentCleanup();
  } finally {
    cleanupRunning = false;
  }
}

export function startPendingPaymentCleanupJob() {
  if (cleanupIntervalId) return;
  void runCleanupCycle();
  cleanupIntervalId = setInterval(() => {
    void runCleanupCycle().catch(error => {
      console.error('[PendingPaymentCleanup] interval run failed', error);
    });
  }, JOB_INTERVAL_MS);
  console.log('[PendingPaymentCleanup] Job demarre (intervalle: 1h, expiration: 30 min).');
}
