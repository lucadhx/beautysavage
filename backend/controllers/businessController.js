import Product from '../models/Product.js';
import Formation from '../models/Formation.js';
import { getActivePromotionsForTargets, buildPromotionSummary } from '../services/promotionService.js';

function mapEntity(item, promotion = null) {
  return {
    id: item._id?.toString(),
    name: item.name,
    description: item.description || '',
    price: Number(item.price || 0),
    coverImage: item.coverImage || '',
    trailerVideoUrl: item.trailerVideoUrl || '',
    photos: Array.isArray(item.photos) ? item.photos : [],
    active: Boolean(item.active),
    isBoosted: Boolean(item.isBoosted),
    boostOrder: Number.isFinite(Number(item.boostOrder)) ? Number(item.boostOrder) : null,
    createdAt: item.createdAt,
    activePromotion: buildPromotionSummary(promotion)
  };
}

function parseActive(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === 'false' || value === '0' || value === 0) return false;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

async function listEntities(Model) {
  const items = await Model.find().sort({ createdAt: -1 }).lean();
  if (!items.length) {
    return [];
  }
  const ids = items.map(entry => entry._id?.toString()).filter(Boolean);
  const targetType = Model === Product ? 'product' : 'formation';
  const promotions = await getActivePromotionsForTargets(targetType, ids);
  return items.map(item => mapEntity(item, promotions.get(item._id?.toString())));
}

function prepareName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parsePhotos(value) {
  if (!value) return [];
  return String(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

async function createEntity(Model, body) {
  const name = prepareName(body.name);
  if (!name) {
    throw new Error('missing-name');
  }
  const entity = new Model({
    name,
    description: String(body.description || '').trim(),
    price: Number(body.price) || 0,
    coverImage: String(body.coverImage || '').trim(),
    trailerVideoUrl: String(body.trailerVideoUrl || '').trim(),
    photos: parsePhotos(body.photos),
    active: parseActive(body.active, true)
  });
  await entity.save();
  return entity;
}

async function updateEntity(Model, id, body) {
  const entity = await Model.findById(id);
  if (!entity) {
    throw new Error('not-found');
  }
  const name = prepareName(body.name);
  if (name) {
    entity.name = name;
  } else if (body.name !== undefined && body.name !== null) {
    throw new Error('invalid-name');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    entity.description = String(body.description || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'price')) {
    entity.price = Number(body.price) || 0;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'coverImage')) {
    entity.coverImage = String(body.coverImage || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'trailerVideoUrl')) {
    entity.trailerVideoUrl = String(body.trailerVideoUrl || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, 'photos')) {
    entity.photos = parsePhotos(body.photos);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    entity.active = parseActive(body.active, entity.active);
  }
  await entity.save();
  return entity;
}

async function removeEntity(Model, id) {
  const deleted = await Model.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('not-found');
  }
}

export async function getProducts(_req, res) {
  try {
    const products = await listEntities(Product);
    return res.json({ ok: true, products });
  } catch (error) {
    console.error('Impossible de lister les produits', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les produits.' });
  }
}

export async function createProduct(req, res) {
  try {
    const product = await createEntity(Product, req.body || {});
    return res.status(201).json({ ok: true, product: mapEntity(product.toObject()) });
  } catch (error) {
    if (error.message === 'missing-name') {
      return res.status(400).json({ ok: false, error: 'Nom du produit requis.' });
    }
    console.error('Erreur création produit', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer le produit.' });
  }
}

export async function updateProduct(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  }
  try {
    const product = await updateEntity(Product, id, req.body || {});
    return res.json({ ok: true, product: mapEntity(product.toObject()) });
  } catch (error) {
    if (error.message === 'not-found') {
      return res.status(404).json({ ok: false, error: 'Produit introuvable.' });
    }
    if (error.message === 'invalid-name') {
      return res.status(400).json({ ok: false, error: 'Nom invalide.' });
    }
    console.error('Erreur mise à jour produit', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour le produit.' });
  }
}

export async function deleteProduct(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  }
  try {
    await removeEntity(Product, id);
    return res.json({ ok: true });
  } catch (error) {
    if (error.message === 'not-found') {
      return res.status(404).json({ ok: false, error: 'Produit introuvable.' });
    }
    console.error('Erreur suppression produit', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le produit.' });
  }
}

export async function getFormations(_req, res) {
  try {
    const formations = await listEntities(Formation);
    return res.json({ ok: true, formations });
  } catch (error) {
    console.error('Impossible de lister les formations', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les formations.' });
  }
}

export async function createFormation(req, res) {
  try {
    const formation = await createEntity(Formation, req.body || {});
    return res.status(201).json({ ok: true, formation: mapEntity(formation.toObject()) });
  } catch (error) {
    if (error.message === 'missing-name') {
      return res.status(400).json({ ok: false, error: 'Nom de la formation requis.' });
    }
    console.error('Erreur création formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer la formation.' });
  }
}

export async function updateFormation(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  }
  try {
    const formation = await updateEntity(Formation, id, req.body || {});
    return res.json({ ok: true, formation: mapEntity(formation.toObject()) });
  } catch (error) {
    if (error.message === 'not-found') {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (error.message === 'invalid-name') {
      return res.status(400).json({ ok: false, error: 'Nom invalide.' });
    }
    console.error('Erreur mise à jour formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour la formation.' });
  }
}

export async function deleteFormation(req, res) {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  }
  try {
    await removeEntity(Formation, id);
    return res.json({ ok: true });
  } catch (error) {
    if (error.message === 'not-found') {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    console.error('Erreur suppression formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la formation.' });
  }
}

export { mapEntity };
