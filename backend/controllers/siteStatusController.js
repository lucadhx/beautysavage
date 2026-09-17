import {
  getStatus,
  suspend,
  reactivate,
  startMaintenance,
  endMaintenance,
  listHistory
} from '../services/siteStatusService.js';

function getActorUserId(req) {
  return (
    req?.sessionUser?._id?.toString() ||
    req?.sessionUserId?.toString() ||
    null
  );
}

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'suspended') return 'suspended';
  if (candidate === 'maintenance') return 'maintenance';
  return 'active';
}

function buildGestionStatusPayload(status) {
  return {
    status: normalizeStatus(status?.status),
    updatedAt: status?.updatedAt || null,
    updatedById: status?.updatedById || null,
    updatedBy: status?.updatedBy || null,
    reason: String(status?.reason || '').trim(),
    eta: String(status?.eta || '').trim(),
    maintenanceStartedAt: status?.maintenanceStartedAt || null,
    maintenanceEndedAt: status?.maintenanceEndedAt || null
  };
}

export async function getPublicSiteStatus(_req, res) {
  try {
    const status = await getStatus();
    return res.json({
      ok: true,
      status: normalizeStatus(status?.status),
      reason: String(status?.reason || '').trim(),
      eta: String(status?.eta || '').trim(),
      startedAt: status?.maintenanceStartedAt || null,
      updatedAt: status?.updatedAt || null
    });
  } catch (error) {
    console.error('Erreur lecture statut site public', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de lire le statut du site.'
    });
  }
}

export async function getGestionSiteStatus(_req, res) {
  try {
    const status = await getStatus();
    return res.json({
      ok: true,
      siteStatus: buildGestionStatusPayload(status)
    });
  } catch (error) {
    console.error('Erreur lecture statut site gestion', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de lire le statut du site.'
    });
  }
}

export async function getSiteStatusHistory(_req, res) {
  try {
    const history = await listHistory();
    return res.json({
      ok: true,
      history
    });
  } catch (error) {
    console.error('Erreur lecture historique statut site', error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de lire l'historique du statut."
    });
  }
}

export async function suspendSite(req, res) {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) {
    return res.status(400).json({
      ok: false,
      error: 'Le motif est requis pour suspendre le site.'
    });
  }
  try {
    const status = await suspend({
      reason,
      byUserId: getActorUserId(req)
    });
    return res.json({
      ok: true,
      siteStatus: buildGestionStatusPayload(status)
    });
  } catch (error) {
    const statusCode = Number(error?.status || 500);
    if (statusCode < 500) {
      return res.status(statusCode).json({
        ok: false,
        error: error.message || 'Requete invalide.'
      });
    }
    console.error('Erreur suspension du site', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de suspendre le site.'
    });
  }
}

export async function startSiteMaintenance(req, res) {
  const reason = String(req.body?.reason || '').trim();
  const eta = String(req.body?.eta || '').trim();
  if (!reason) {
    return res.status(400).json({
      ok: false,
      error: 'Le motif est requis pour lancer la maintenance.'
    });
  }
  if (!eta) {
    return res.status(400).json({
      ok: false,
      error: 'La duree estimee est requise pour lancer la maintenance.'
    });
  }
  try {
    const status = await startMaintenance({
      reason,
      eta,
      byUserId: getActorUserId(req)
    });
    return res.json({
      ok: true,
      siteStatus: buildGestionStatusPayload(status)
    });
  } catch (error) {
    const statusCode = Number(error?.status || 500);
    if (statusCode < 500) {
      return res.status(statusCode).json({
        ok: false,
        error: error.message || 'Requete invalide.'
      });
    }
    console.error('Erreur lancement maintenance site', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de lancer la maintenance.'
    });
  }
}

export async function endSiteMaintenance(req, res) {
  try {
    const status = await endMaintenance({
      byUserId: getActorUserId(req)
    });
    return res.json({
      ok: true,
      siteStatus: buildGestionStatusPayload(status)
    });
  } catch (error) {
    console.error('Erreur fin maintenance site', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de terminer la maintenance.'
    });
  }
}

export async function reactivateSite(req, res) {
  try {
    const status = await reactivate({
      byUserId: getActorUserId(req)
    });
    return res.json({
      ok: true,
      siteStatus: buildGestionStatusPayload(status)
    });
  } catch (error) {
    console.error('Erreur reactivation du site', error);
    return res.status(500).json({
      ok: false,
      error: 'Impossible de reactiver le site.'
    });
  }
}
