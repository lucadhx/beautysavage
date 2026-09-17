import mongoose from 'mongoose';

import Theme, { THEME_SCOPES, DEFAULT_THEME_SCOPE } from '../models/Theme.js';

const COLOR_KEYS = ['primary', 'secondary', 'background', 'surface', 'text'];
const DERIVED_KEYS = ['surfaceHeader', 'accent', 'accentStrong'];

// Normalise un scope (défaut vitrine). Renvoie null si une valeur explicite est invalide.
function normalizeScope(value, { fallback = DEFAULT_THEME_SCOPE } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const candidate = String(value).trim().toLowerCase();
  return THEME_SCOPES.includes(candidate) ? candidate : null;
}

// Requête de l'actif d'un scope. Le scope vitrine inclut les documents legacy (sans scope).
function activeQueryForScope(scope) {
  if (scope === 'vitrine') {
    return { isActive: true, $or: [{ scope: 'vitrine' }, { scope: { $exists: false } }, { scope: null }] };
  }
  return { isActive: true, scope };
}

function formatColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function normalizeAllColors(source = {}) {
  const normalized = {};
  for (const key of COLOR_KEYS) {
    const value = formatColor(source[key]);
    if (!value) {
      return null;
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeDerivedTokens(source = {}, { allowPartial = false } = {}) {
  const normalized = {};
  let hasAny = false;
  for (const key of DERIVED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      hasAny = true;
      normalized[key] = formatColor(source[key]);
    } else if (!allowPartial) {
      normalized[key] = null;
    }
  }
  if (allowPartial && !hasAny) {
    return null;
  }
  return normalized;
}

function buildDerivedTokensObject(source = {}) {
  const normalized = {};
  for (const key of DERIVED_KEYS) {
    normalized[key] = formatColor(source[key]) || null;
  }
  return normalized;
}

const SPACING_KEYS = ['x1', 'x2', 'x3', 'x4'];

// M5 — Tokens visuels optionnels (typo/radius/shadow/spacing). Additif : ne renvoie que les
// champs réellement fournis dans le body (les autres restent inchangés à l'update). Aucune
// donnée sensible ; validation légère (chaînes courtes), l'autorité reste le backend.
function extractVisualTokens(body = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'typography')) {
    const t = body.typography;
    if (t && typeof t === 'object' && typeof t.fontFamily === 'string') {
      patch.typography = { fontFamily: String(t.fontFamily).trim().slice(0, 300) };
    } else if (t === null || t === '') {
      patch.typography = undefined;
    }
  }
  if (typeof body.radius === 'string') patch.radius = body.radius.trim().slice(0, 60);
  if (typeof body.shadow === 'string') patch.shadow = body.shadow.trim().slice(0, 300);
  if (Object.prototype.hasOwnProperty.call(body, 'spacing')) {
    const s = body.spacing;
    if (s && typeof s === 'object') {
      const out = {};
      for (const key of SPACING_KEYS) {
        if (typeof s[key] === 'string' && s[key].trim()) out[key] = s[key].trim().slice(0, 40);
      }
      patch.spacing = Object.keys(out).length ? out : undefined;
    } else if (s === null) {
      patch.spacing = undefined;
    }
  }
  return patch;
}

function buildThemePayload(theme) {
  if (!theme) return null;
  const payload = {
    id: theme._id?.toString(),
    name: theme.name,
    scope: theme.scope || DEFAULT_THEME_SCOPE,
    colors: theme.colors,
    derivedTokens: buildDerivedTokensObject(theme.derivedTokens),
    logoUrl: theme.logoUrl || '',
    slogan: theme.slogan || '',
    isActive: Boolean(theme.isActive),
    createdAt: theme.createdAt
  };
  // Tokens optionnels additifs : exposés uniquement s'ils sont renseignés (rétro-compat).
  if (theme.typography) payload.typography = theme.typography;
  if (theme.radius) payload.radius = theme.radius;
  if (theme.shadow) payload.shadow = theme.shadow;
  if (theme.spacing !== undefined && theme.spacing !== null) payload.spacing = theme.spacing;
  if (theme.metadata !== undefined && theme.metadata !== null) payload.metadata = theme.metadata;
  return payload;
}

export async function listThemes(req, res) {
  try {
    const filter = {};
    if (req.query?.scope !== undefined) {
      const scope = normalizeScope(req.query.scope, { fallback: null });
      if (!scope) {
        return res.status(400).json({ ok: false, error: 'Scope invalide.' });
      }
      filter.scope = scope;
    }
    const themes = await Theme.find(filter).sort({ createdAt: -1 }).lean();
    const payload = themes.map(buildThemePayload);
    return res.json({ ok: true, themes: payload });
  } catch (error) {
    console.error('Impossible de lister les themes', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer les themes.' });
  }
}

export async function createTheme(req, res) {
  const { name, colors, logoUrl, slogan, derivedTokens, scope } = req.body || {};
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return res.status(400).json({ ok: false, error: 'Le nom du theme est requis.' });
  }
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    return res.status(400).json({ ok: false, error: 'Scope invalide.' });
  }
  const normalizedColors = normalizeAllColors(colors);
  if (!normalizedColors) {
    return res.status(400).json({ ok: false, error: 'Toutes les couleurs sont requises.' });
  }
  const normalizedDerivedTokens = normalizeDerivedTokens(derivedTokens || {});
  try {
    const existing = await Theme.findOne({ name: normalizedName }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Un theme porte deja ce nom.' });
    }
    const theme = await Theme.create({
      name: normalizedName,
      scope: normalizedScope,
      colors: normalizedColors,
      derivedTokens: normalizedDerivedTokens,
      logoUrl: String(logoUrl || '').trim(),
      slogan: String(slogan || '').trim(),
      // M5 — tokens visuels optionnels additifs.
      ...extractVisualTokens(req.body || {})
    });
    return res.status(201).json({ ok: true, theme: buildThemePayload(theme.toObject()) });
  } catch (error) {
    console.error('Impossible de creer le theme', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer le theme.' });
  }
}

export async function updateTheme(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  const { name, colors, logoUrl, slogan, derivedTokens } = req.body || {};
  try {
    const theme = await Theme.findById(id);
    if (!theme) {
      return res.status(404).json({ ok: false, error: 'Theme introuvable.' });
    }
    if (name) {
      const normalizedName = String(name).trim();
      if (normalizedName && normalizedName !== theme.name) {
        const taken = await Theme.findOne({ name: normalizedName, _id: { $ne: theme._id } }).lean();
        if (taken) {
          return res.status(409).json({ ok: false, error: 'Un theme porte deja ce nom.' });
        }
        theme.name = normalizedName;
      }
    }
    if (colors) {
      const normalizedColors = normalizeAllColors(colors);
      if (!normalizedColors) {
        return res.status(400).json({ ok: false, error: 'Toutes les couleurs sont requises.' });
      }
      theme.colors = normalizedColors;
    }
    if (derivedTokens) {
      const normalizedPatch = normalizeDerivedTokens(derivedTokens, { allowPartial: true });
      if (normalizedPatch) {
        theme.derivedTokens = {
          ...buildDerivedTokensObject(theme.derivedTokens),
          ...normalizedPatch
        };
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scope')) {
      const normalizedScope = normalizeScope(req.body.scope, { fallback: null });
      if (!normalizedScope) {
        return res.status(400).json({ ok: false, error: 'Scope invalide.' });
      }
      theme.scope = normalizedScope;
    }
    if (typeof logoUrl === 'string') {
      theme.logoUrl = logoUrl.trim();
    }
    if (typeof slogan === 'string') {
      theme.slogan = slogan.trim();
    }
    // M5 — tokens visuels optionnels (n'écrase que les champs fournis).
    const visualPatch = extractVisualTokens(req.body || {});
    if (Object.prototype.hasOwnProperty.call(visualPatch, 'typography')) theme.typography = visualPatch.typography;
    if (Object.prototype.hasOwnProperty.call(visualPatch, 'radius')) theme.radius = visualPatch.radius;
    if (Object.prototype.hasOwnProperty.call(visualPatch, 'shadow')) theme.shadow = visualPatch.shadow;
    if (Object.prototype.hasOwnProperty.call(visualPatch, 'spacing')) theme.spacing = visualPatch.spacing;
    await theme.save();
    return res.json({ ok: true, theme: buildThemePayload(theme.toObject()) });
  } catch (error) {
    console.error('Impossible de mettre a jour le theme', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre a jour le theme.' });
  }
}

export async function activateTheme(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const theme = await Theme.findById(id);
    if (!theme) {
      return res.status(404).json({ ok: false, error: 'Theme introuvable.' });
    }
    const scope = normalizeScope(theme.scope) || DEFAULT_THEME_SCOPE;
    // Désactive uniquement les actifs du MÊME scope (séquentiel : compatible standalone sans
    // transaction ; l'index unique partiel garantit au plus 1 actif/scope). Les autres scopes
    // restent intacts (activer manager ne touche pas vitrine, et inversement).
    await Theme.updateMany(
      { ...activeQueryForScope(scope), _id: { $ne: theme._id } },
      { isActive: false }
    );
    theme.scope = scope;
    theme.isActive = true;
    await theme.save();
    return res.json({ ok: true, theme: buildThemePayload(theme.toObject()) });
  } catch (error) {
    console.error('Impossible d activer le theme', error);
    return res.status(500).json({ ok: false, error: 'Impossible d activer le theme.' });
  }
}

// Charge l'actif d'un scope. `getActiveTheme` = endpoint vitrine public historique (rétro-compat).
async function loadActiveTheme(scope) {
  const found = await Theme.findOne(activeQueryForScope(scope)).lean();
  if (found) return found;
  // Ultra-legacy : si aucun actif "vitrine", retombe sur n'importe quel actif global.
  if (scope === 'vitrine') {
    return Theme.findOne({ isActive: true }).lean();
  }
  return null;
}

export async function getActiveTheme(_req, res) {
  try {
    const theme = await loadActiveTheme('vitrine');
    return res.json({ ok: true, theme: buildThemePayload(theme) });
  } catch (error) {
    console.error('Impossible de charger le theme actif', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le theme actif.' });
  }
}

// GET /api/theme/:scope — lecture publique (couleurs non secrètes). theme:null si aucun actif.
export async function getActiveThemeByScope(req, res) {
  const scope = normalizeScope(req.params?.scope, { fallback: null });
  if (!scope) {
    return res.status(400).json({ ok: false, error: 'Scope invalide.' });
  }
  try {
    const theme = await loadActiveTheme(scope);
    return res.json({ ok: true, scope, theme: buildThemePayload(theme) });
  } catch (error) {
    console.error('Impossible de charger le theme du scope', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le theme.' });
  }
}
