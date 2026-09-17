import SiteUIConfig from '../models/SiteUIConfig.js';

const DEFAULT_UI_CONFIG = {
  key: 'global',
  patienceTitle: 'Patience, l’expérience arrive…',
  patienceDescription: 'Nous préparons actuellement une expérience premium pour vous.',
  showTimer: true
};

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function formatConfig(doc) {
  if (!doc) return { ...DEFAULT_UI_CONFIG };
  return {
    id: doc._id?.toString() || null,
    patienceTitle: doc.patienceTitle || DEFAULT_UI_CONFIG.patienceTitle,
    patienceDescription: doc.patienceDescription || DEFAULT_UI_CONFIG.patienceDescription,
    showTimer: typeof doc.showTimer === 'boolean' ? doc.showTimer : DEFAULT_UI_CONFIG.showTimer,
    updatedAt: doc.updatedAt || null
  };
}

async function ensureConfigDocument() {
  return SiteUIConfig.findOneAndUpdate(
    { key: DEFAULT_UI_CONFIG.key },
    { $setOnInsert: DEFAULT_UI_CONFIG },
    { new: true, upsert: true }
  ).lean();
}

export async function getUIConfig(_req, res) {
  try {
    const config = await ensureConfigDocument();
    return res.json({ ok: true, config: formatConfig(config) });
  } catch (error) {
    console.error('Impossible de récupérer la configuration UI', error);
    return res.status(500).json({ ok: false, error: 'Impossible de récupérer la configuration UI.' });
  }
}

export async function updateUIConfig(req, res) {
  const payload = req.body || {};
  const updates = {};
  if (typeof payload.patienceTitle === 'string') {
    updates.patienceTitle = payload.patienceTitle.trim();
  }
  if (typeof payload.patienceDescription === 'string') {
    updates.patienceDescription = payload.patienceDescription.trim();
  }
  const showTimer = parseBoolean(payload.showTimer);
  if (showTimer !== null) {
    updates.showTimer = showTimer;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ ok: false, error: 'Aucun champ valide fourni.' });
  }
  try {
    const updated = await SiteUIConfig.findOneAndUpdate(
      { key: DEFAULT_UI_CONFIG.key },
      { $set: updates },
      { new: true, upsert: true }
    ).lean();
    return res.json({ ok: true, config: formatConfig(updated) });
  } catch (error) {
    console.error('Impossible de mettre à jour la configuration UI', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour la configuration UI.' });
  }
}

export async function getUIConfigPublic(_req, res) {
  try {
    const config = await ensureConfigDocument();
    return res.json({ ok: true, config: formatConfig(config) });
  } catch (error) {
    console.error('Impossible de charger la configuration UI publique', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la configuration UI.' });
  }
}
