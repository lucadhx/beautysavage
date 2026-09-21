/**
 * API de gestion du PLAN DE CONTRÔLE (P2.9) — DEV uniquement.
 * Ne renvoie QUE des métadonnées sûres (aucun secret). Lit/écrit dans la base de
 * contrôle (indépendante de l'ENV local).
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import * as targetSvc from '../services/controlPlane/target.service.js';
import * as releaseSvc from '../services/controlPlane/release.service.js';
import { ControlPlaneError } from '../services/controlPlane/errors.js';

/** Convertit une ControlPlaneError en ApiError HTTP. */
function toApi(err) {
  if (err instanceof ControlPlaneError) return new ApiError(err.statusCode, `${err.code}: ${err.message}`, err.code);
  return err;
}

export const listTargets = asyncHandler(async (req, res) => {
  try { return ok(res, await targetSvc.listTargets()); } catch (e) { throw toApi(e); }
});

export const getTarget = asyncHandler(async (req, res) => {
  try {
    const target = await targetSvc.getTargetById(req.params.targetId);
    const [active, releases] = await Promise.all([
      releaseSvc.getActiveRelease(target.id),
      releaseSvc.listReleasesForTarget(target.id, { limit: 10 }),
    ]);
    return ok(res, { target, activeRelease: active, releases });
  } catch (e) { throw toApi(e); }
});

export const patchTarget = asyncHandler(async (req, res) => {
  try { return ok(res, await targetSvc.updateTargetMetadata(req.params.targetId, req.body || {})); } catch (e) { throw toApi(e); }
});

export const listReleases = asyncHandler(async (req, res) => {
  try {
    await targetSvc.getTargetById(req.params.targetId); // 404 si absent
    return ok(res, await releaseSvc.listReleasesForTarget(req.params.targetId, { limit: 50 }));
  } catch (e) { throw toApi(e); }
});

export const listRuns = asyncHandler(async (req, res) => {
  try {
    const target = await targetSvc.getTargetById(req.params.targetId);
    const releases = await releaseSvc.listReleasesForTarget(target.id, { limit: 50 });
    // Références vers les rapports de run (base métier, via /api/deployment/runs/:id).
    return ok(res, { lastDeploymentRunId: target.lastDeploymentRunId, runs: releases.filter((r) => r.deploymentRunId).map((r) => ({ releaseId: r.id, deploymentRunId: r.deploymentRunId, version: r.version, status: r.status, at: r.activatedAt || r.createdAt })) });
  } catch (e) { throw toApi(e); }
});

export const getHealth = asyncHandler(async (req, res) => {
  try {
    const t = await targetSvc.getTargetById(req.params.targetId);
    return ok(res, { healthStatus: t.healthStatus, status: t.status, lastHealthcheckAt: t.lastHealthcheckAt, siteUrl: t.siteUrl, managerUrl: t.managerUrl, apiUrl: t.apiUrl });
  } catch (e) { throw toApi(e); }
});

/** Sonde HTTP publique (côté serveur) : site / manager / api + un média. Met à jour healthStatus. */
export const checkHealth = asyncHandler(async (req, res) => {
  let t;
  try { t = await targetSvc.getTargetById(req.params.targetId); } catch (e) { throw toApi(e); }
  const probe = async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000), redirect: 'follow' });
      return { url, code: r.status, ok: r.ok, mime: r.headers.get('content-type') || null };
    } catch (err) { return { url, code: 0, ok: false, error: String(err.name || err.message) }; }
  };
  const [site, manager, api] = await Promise.all([
    probe(`${t.siteUrl}/health`),
    probe(`${t.managerUrl}/health`),
    probe(`${t.apiUrl}/health`),
  ]);
  const reachableCount = [site, manager, api].filter((p) => p.ok).length;
  const healthStatus = reachableCount === 3 ? 'HEALTHY' : reachableCount === 0 ? 'UNREACHABLE' : 'DEGRADED';
  try { await targetSvc.recordHealth(t.id, { healthStatus }); } catch (e) { throw toApi(e); }
  return ok(res, { healthStatus, checks: { site, manager, api } });
});

/** Update/rollback : le moteur atomique arrive en P3 — erreur métier explicite. */
export const updateTarget = asyncHandler(async (req, res) => {
  throw new ApiError(501, 'DEPLOYMENT_UPDATE_NOT_AVAILABLE: la mise à jour atomique arrive en P3.', 'DEPLOYMENT_UPDATE_NOT_AVAILABLE');
});
export const rollbackTarget = asyncHandler(async (req, res) => {
  throw new ApiError(501, 'DEPLOYMENT_ROLLBACK_NOT_AVAILABLE: le rollback piloté arrive en P3.', 'DEPLOYMENT_ROLLBACK_NOT_AVAILABLE');
});
