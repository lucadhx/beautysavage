import mongoose from 'mongoose';
import { ServiceCollection } from '../models/ServiceCollection.model.js';
import { CommerceProduct, PRODUCT_STATUS } from '../models/CommerceProduct.model.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * COLLECTIONS DE PRESTATIONS — gestion (Manager) et lecture publique (vitrine).
 *
 * Une collection ne contient que des PRESTATIONS (kind SERVICE). L'ordre des
 * collections et l'ordre des prestations dans chacune sont ceux de la vitrine.
 */

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 80) || 'collection';
}

async function uniqueSlug(title, excludeId = null) {
  const base = slugify(title);
  let candidate = base;
  for (let n = 2; await ServiceCollection.exists({ slug: candidate, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function toId(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

/** Ne garde que des prestations existantes, sans doublon, dans l'ordre reçu. */
async function sanitizeProductIds(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].map(toId).filter(Boolean);
  if (!wanted.length) return [];
  const found = await CommerceProduct.find({ _id: { $in: wanted }, kind: 'SERVICE' }).select('_id').lean();
  const ok = new Set(found.map((p) => String(p._id)));
  return wanted.filter((id) => ok.has(String(id)));
}

function serialize(doc) {
  const c = doc.toObject ? doc.toObject() : doc;
  return {
    _id: String(c._id),
    title: c.title,
    slug: c.slug,
    description: c.description || '',
    coverUrl: c.coverUrl || '',
    order: c.order ?? 0,
    productIds: (c.productIds || []).map(String),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function listCollections() {
  const docs = await ServiceCollection.find({}).sort({ order: 1, createdAt: 1 }).lean();
  return docs.map(serialize);
}

export async function getCollection(id) {
  const doc = toId(id) ? await ServiceCollection.findById(id).lean() : null;
  if (!doc) throw ApiError.notFound('Collection introuvable');
  return serialize(doc);
}

export async function saveCollection(payload, id = null) {
  const title = String(payload?.title || '').trim();
  if (!title) throw ApiError.badRequest('Le titre de la collection est requis');
  const data = {
    title: title.slice(0, 120),
    description: String(payload?.description || '').slice(0, 1000),
    coverUrl: String(payload?.coverUrl || ''),
    productIds: await sanitizeProductIds(payload?.productIds),
  };
  if (id) {
    const existing = toId(id) ? await ServiceCollection.findById(id) : null;
    if (!existing) throw ApiError.notFound('Collection introuvable');
    // L'adresse publique suit le titre tant qu'elle n'a pas été partagée… on la garde
    // stable : une collection renommée garde son lien, comme les fiches.
    Object.assign(existing, data);
    await existing.save();
    return serialize(existing);
  }
  const last = await ServiceCollection.findOne({}).sort({ order: -1 }).select('order').lean();
  const doc = await ServiceCollection.create({ ...data, slug: await uniqueSlug(title), order: (last?.order ?? -1) + 1 });
  return serialize(doc);
}

export async function deleteCollection(id) {
  const res = toId(id) ? await ServiceCollection.deleteOne({ _id: id }) : { deletedCount: 0 };
  if (!res.deletedCount) throw ApiError.notFound('Collection introuvable');
  return { deleted: true };
}

/** Nouvel ordre des collections : la liste complète des identifiants, dans l'ordre. */
export async function reorderCollections(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => toId(x));
  await Promise.all(list.map((id, index) => ServiceCollection.updateOne({ _id: id }, { $set: { order: index } })));
  return listCollections();
}

/**
 * Lecture PUBLIQUE : collections non vides, avec leurs prestations PUBLIÉES
 * dans l'ordre choisi. Une collection dont toutes les prestations sont masquées
 * n'apparaît pas — la vitrine ne propose jamais un rayon vide.
 */
export async function listPublicCollections() {
  const docs = await ServiceCollection.find({}).sort({ order: 1, createdAt: 1 }).lean();
  if (!docs.length) return [];
  const ids = [...new Set(docs.flatMap((d) => (d.productIds || []).map(String)))];
  const published = await CommerceProduct.find({ _id: { $in: ids }, kind: 'SERVICE', status: PRODUCT_STATUS.PUBLISHED }).select('_id').lean();
  const visible = new Set(published.map((p) => String(p._id)));
  return docs
    .map((d) => ({
      id: String(d._id),
      slug: d.slug,
      title: d.title,
      description: d.description || '',
      coverUrl: d.coverUrl || '',
      productIds: (d.productIds || []).map(String).filter((pid) => visible.has(pid)),
    }))
    .filter((c) => c.productIds.length > 0);
}
