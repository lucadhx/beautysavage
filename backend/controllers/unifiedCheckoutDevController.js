// controllers/unifiedCheckoutDevController.js
// Sprint U1 — Endpoint dev/debug en LECTURE SEULE des UnifiedCheckout (vue safe, aucun secret).
// Monté sous /api/gestion/dev (périmètre gestion) + requireStrictDev.

import { listRecentCheckouts } from '../services/checkout/unified/unifiedCheckoutRepository.js';
import { toSafeList } from '../services/checkout/unified/unifiedCheckoutResponseMapper.js';

export async function getUnifiedCheckouts(req, res) {
  try {
    const limit = Number(req.query?.limit) || 50;
    const checkouts = await listRecentCheckouts(limit);
    return res.json({ ok: true, checkouts: toSafeList(checkouts) });
  } catch (error) {
    console.error('[UnifiedCheckoutDev] Erreur lecture unified-checkouts', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les unified-checkouts.' });
  }
}
