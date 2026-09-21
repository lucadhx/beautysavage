import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { getSingleton } from '../utils/singleton.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { probeUrl } from '../utils/urlProbe.js';
import { refreshCorsOrigins } from '../config/corsOrigins.js';
import { config } from '../config/env.js';

async function serialize() {
  const doc = await SystemConfiguration.findOne().populate('updatedBy', 'email name');
  const cfg = doc || (await getSingleton(SystemConfiguration));
  return {
    network: cfg.network,
    updatedAt: cfg.updatedAt,
    updatedBy: cfg.updatedBy ? { email: cfg.updatedBy.email, name: cfg.updatedBy.name } : null,
  };
}

/** GET /system-configuration/network — DEV only. */
export const getNetwork = asyncHandler(async (req, res) => {
  await getSingleton(SystemConfiguration); // garantit l'existence
  return ok(res, await serialize());
});

/** PUT /system-configuration/network — DEV only. */
export const updateNetwork = asyncHandler(async (req, res) => {
  const doc = await getSingleton(SystemConfiguration);
  doc.network = {
    backendUrl: req.body.backendUrl,
    managerUrl: req.body.managerUrl,
    websiteUrl: req.body.websiteUrl,
  };
  doc.updatedBy = req.user._id;
  await doc.save();
  await refreshCorsOrigins(); // met à jour le cache CORS en mémoire
  return ok(res, await serialize());
});

/** POST /system-configuration/network/test — DEV only. Test SSRF-safe. */
export const testNetwork = asyncHandler(async (req, res) => {
  const allowPrivate = config.isTest; // localhost/loopback autorisés en TEST, refusés en PROD
  const targets = {
    backend: req.body.backendUrl,
    manager: req.body.managerUrl,
    website: req.body.websiteUrl,
  };
  const entries = await Promise.all(
    Object.entries(targets).map(async ([key, url]) => [key, await probeUrl(url, { allowPrivate })])
  );
  return ok(res, Object.fromEntries(entries));
});
