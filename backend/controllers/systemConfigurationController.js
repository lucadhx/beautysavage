import {
  getSystemConfiguration,
  updateSystemConfiguration
} from '../services/system/systemConfigurationService.js';
import {
  resolveVitrineBaseUrl,
  resolvePanelBaseUrl
} from '../services/system/domainResolver.js';

// S1 — Endpoints dev de la configuration système (singleton). Dev uniquement.

function serialize(cfg = {}) {
  const domains = cfg.domains || {};
  const institute = cfg.institute || {};
  const address = institute.address || {};
  const localization = cfg.localization || {};
  const tax = cfg.tax || {};
  const system = cfg.system || {};
  const maintenance = cfg.maintenance || {};
  return {
    domains: {
      panelUrl: domains.panelUrl || '',
      vitrineUrl: domains.vitrineUrl || ''
    },
    institute: {
      name: institute.name || '',
      email: institute.email || '',
      phone: institute.phone || '',
      siret: institute.siret || '',
      address: {
        line1: address.line1 || '',
        line2: address.line2 || '',
        city: address.city || '',
        postalCode: address.postalCode || '',
        country: address.country || ''
      }
    },
    localization: {
      timezone: localization.timezone || '',
      language: localization.language || '',
      currency: localization.currency || ''
    },
    tax: {
      defaultVatRate: Number.isFinite(tax.defaultVatRate) ? tax.defaultVatRate : 0,
      vatMention: tax.vatMention || ''
    },
    system: {
      platformName: system.platformName || ''
    },
    maintenance: {
      enabled: Boolean(maintenance.enabled),
      message: maintenance.message || ''
    },
    // Bases effectivement résolues (config → fallback) — utile pour le diagnostic UI.
    resolved: {
      vitrineBaseUrl: resolveVitrineBaseUrl(),
      panelBaseUrl: resolvePanelBaseUrl()
    },
    updatedAt: cfg.updatedAt || null
  };
}

export async function getSystemConfigurationHandler(_req, res) {
  try {
    const cfg = await getSystemConfiguration({ force: true });
    return res.json({ ok: true, config: serialize(cfg) });
  } catch (error) {
    console.error('[systemConfiguration] lecture échouée', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateSystemConfigurationHandler(req, res) {
  try {
    const result = await updateSystemConfiguration(req.body || {}, {
      updatedBy: req.sessionUser?._id || null
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, config: serialize(result.config) });
  } catch (error) {
    console.error('[systemConfiguration] mise à jour échouée', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
