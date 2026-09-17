import express from 'express';

import {
  BRIDGE_CONTRACT_VERSION,
  assertBridgeToken,
  bridgeStatus,
  buildManifest,
  getBridgeState,
  projectKey,
  recordPanelChanges,
  webhookEndpoints
} from '../services/panelBridgeService.js';

const router = express.Router();

router.use((req, res, next) => {
  const version = String(req.get('x-bridge-contract-version') || '').trim();
  if (version && version.split('.')[0] !== BRIDGE_CONTRACT_VERSION.split('.')[0]) {
    return res.status(426).json({ ok: false, code: 'CONTRACT_VERSION_UNSUPPORTED' });
  }
  return next();
});

router.get('/ping', async (_req, res) => {
  const state = await bridgeStatus();
  return res.json({
    ok: true,
    data: {
      status: 'ok',
      service: 'project-bridge',
      paired: state.paired,
      projectKey: projectKey(),
      projectName: 'BeautySavage',
      time: new Date().toISOString()
    }
  });
});

router.use(async (req, res, next) => {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await assertBridgeToken(token))) {
    return res.status(401).json({ ok: false, code: 'BRIDGE_UNAUTHORIZED' });
  }
  return next();
});

router.get('/identity', async (_req, res) => {
  const state = await bridgeStatus();
  return res.json({ ok: true, data: { ...state, projectName: 'BeautySavage', environment: 'TEST' } });
});
router.get('/health', async (_req, res) =>
  res.json({ ok: true, data: { status: 'OK', checkedAt: new Date().toISOString() } })
);
router.get('/manifest', (_req, res) => res.json({ ok: true, data: buildManifest() }));
router.get('/webhooks', (_req, res) => res.json({ ok: true, data: { endpoints: webhookEndpoints() } }));
router.get('/sync/pull', (_req, res) =>
  res.json({ ok: true, data: { changes: [], nextCursor: null } })
);
router.post('/sync/push', express.json({ limit: '1mb' }), async (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  if (!changes.length) return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD' });
  return res.json({ ok: true, data: { acknowledgements: await recordPanelChanges(changes) } });
});
router.get('/status', async (_req, res) => res.json({ ok: true, data: await bridgeStatus() }));
router.get('/state', async (_req, res) => {
  const state = await getBridgeState();
  return res.json({ ok: true, data: { status: state.status, projectKey: state.projectKey } });
});

export default router;
