import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { Customer } from '../models/Customer.model.js';
import { TrainingAccessGrant } from '../models/TrainingAccessGrant.model.js';
import { TrainingSubmission } from '../models/TrainingSubmission.model.js';
import { ApiError } from '../utils/ApiError.js';
import { maskEmail } from '../utils/eventPayloadSafety.js';
import { assertCustomerIdentity } from './customerIdentity.js';
import { isPendingInstituteAccount, sendCustomerAccessLink } from './commerceCustomer.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { PACK_KIND } from './trainingAccess.js';

/**
 * LES MEMBRES D'UNE FORMATION EN LIGNE — qui y a accès, et pourquoi.
 *
 * Trois origines, lues comme la règle d'accès (`trainingAccess.js`) :
 *   · ACHAT : une vente payée porte la formation ;
 *   · PACK : une vente payée porte un pack qui la contient (instantané) ;
 *   · OFFERT : l'institut l'a ajoutée à la main (TrainingAccessGrant).
 *
 * L'ajout manuel ne passe par aucune vente : ni chiffre d'affaires, ni
 * commission, ni facture. La cliente reçoit un e-mail dédié (« Vous avez
 * désormais accès à… ») ; si son compte vient d'être créé, elle reçoit aussi le
 * lien habituel pour choisir son mot de passe (qui vaut vérification de l'e-mail).
 */

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const asId = (value) => (mongoose.isValidObjectId(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null);

async function distanceTraining(productId) {
  const _id = asId(productId);
  const product = _id ? await CommerceProduct.findById(_id).select('title kind status modules').lean() : null;
  if (!product) throw ApiError.notFound('Formation introuvable');
  if (product.kind !== 'DISTANCE_TRAINING') {
    throw ApiError.badRequest('Seules les formations en ligne acceptent un ajout manuel.', { code: 'TRAINING_NOT_DISTANCE' });
  }
  return product;
}

/** Les accès d'une formation, une entrée par cliente (toutes ses origines). */
async function accessesOf(productId) {
  const id = String(productId);
  const oid = asId(id);
  const [sales, grants] = await Promise.all([
    CommerceSale.find({
      paymentStatus: 'PAID',
      $or: [
        { lines: { $elemMatch: { productId: oid, 'productSnapshot.kind': 'DISTANCE_TRAINING' } } },
        { lines: { $elemMatch: { 'productSnapshot.kind': PACK_KIND, 'productSnapshot.pack.productIds': { $in: [id, oid] } } } },
      ],
    }).select('customerId saleNumber finalizedAt createdAt lines').lean(),
    TrainingAccessGrant.find({ productId: oid, active: true }).lean(),
  ]);
  const byCustomer = new Map();
  const add = (customerId, origin) => {
    const key = String(customerId);
    const entry = byCustomer.get(key) || { customerId: key, origins: [] };
    entry.origins.push(origin);
    byCustomer.set(key, entry);
  };
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      if (line.cancellation?.at) continue;
      const kind = line.productSnapshot?.kind;
      const at = sale.finalizedAt || sale.createdAt;
      if (kind === 'DISTANCE_TRAINING' && String(line.productId) === id) {
        add(sale.customerId, { type: 'PURCHASE', at, saleId: String(sale._id), saleNumber: sale.saleNumber });
      } else if (kind === PACK_KIND && (line.productSnapshot?.pack?.productIds || []).map(String).includes(id)) {
        add(sale.customerId, { type: 'PACK', at, saleId: String(sale._id), saleNumber: sale.saleNumber, packTitle: String(line.productSnapshot?.title || 'Pack') });
      }
    }
  }
  for (const grant of grants) add(grant.customerId, { type: 'MANUAL', at: grant.grantedAt, grantId: String(grant._id) });
  return byCustomer;
}

/** Manager : les formations en ligne et leur nombre de membres. */
export async function listTrainingsWithMembers() {
  const products = await CommerceProduct.find({ kind: 'DISTANCE_TRAINING', status: { $ne: 'ARCHIVED' } })
    .select('title slug status coverUrl modules').sort({ title: 1 }).lean();
  return Promise.all(products.map(async (p) => ({
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    status: p.status,
    coverUrl: p.coverUrl || '',
    moduleCount: Array.isArray(p.modules) ? p.modules.length : 0,
    memberCount: (await accessesOf(p._id)).size,
  })));
}

/** Manager : les membres d'une formation en ligne, avec origine et avancement. */
export async function listTrainingMembers(productId) {
  const product = await distanceTraining(productId);
  const accesses = await accessesOf(product._id);
  const ids = [...accesses.keys()].map(asId).filter(Boolean);
  const [customers, submissions] = await Promise.all([
    Customer.find({ _id: { $in: ids } }).select('firstName lastName email phone emailVerified createdByInstitute emailVerification.requestedAt').lean(),
    TrainingSubmission.find({ productId: product._id, customerId: { $in: ids } }).sort({ createdAt: -1 }).select('customerId status progressSnapshot createdAt').lean(),
  ]);
  const customerById = new Map(customers.map((c) => [String(c._id), c]));
  const latestSubmission = new Map();
  for (const s of submissions) if (!latestSubmission.has(String(s.customerId))) latestSubmission.set(String(s.customerId), s);
  const totalModules = Array.isArray(product.modules) ? product.modules.length : 0;
  const members = [...accesses.values()].map(({ customerId, origins }) => {
    const c = customerById.get(customerId);
    const submission = latestSubmission.get(customerId);
    const sorted = origins.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
    const done = Number(submission?.progressSnapshot?.completedModules || 0);
    return {
      customerId,
      firstName: c?.firstName || '',
      lastName: c?.lastName || '',
      email: c?.email || '',
      phone: c?.phone || '',
      // Compte ouvert par l'institut et pas encore activé (mot de passe pas choisi).
      accessPending: c ? isPendingInstituteAccount(c) : false,
      since: sorted[0]?.at || null,
      origins: sorted,
      manualGrantId: sorted.find((o) => o.type === 'MANUAL')?.grantId || null,
      submissionStatus: submission?.status || null,
      progressPercent: submission?.status === 'VALIDATED' ? 100 : totalModules ? Math.min(100, Math.round((done / totalModules) * 100)) : 0,
    };
  }).sort((a, b) => new Date(b.since || 0) - new Date(a.since || 0));
  return { training: { id: String(product._id), title: product.title, status: product.status, moduleCount: totalModules }, members, refreshedAt: new Date().toISOString() };
}

/**
 * La cliente à inscrire : un compte existant (`customerId`), ou un compte créé
 * ici (prénom, nom, e-mail, téléphone obligatoires). Une adresse déjà connue
 * reprend le compte existant, sans jamais le modifier.
 */
async function resolveCustomer(payload) {
  if (payload.customerId) {
    const _id = asId(payload.customerId);
    const customer = _id ? await Customer.findById(_id).lean() : null;
    if (!customer) throw ApiError.notFound('Cliente introuvable');
    return { customer, created: false };
  }
  const raw = payload.newCustomer || {};
  const identity = assertCustomerIdentity(raw);
  const email = String(raw.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw ApiError.badRequest('Adresse e-mail invalide.', { code: 'CUSTOMER_EMAIL_INVALID', fields: ['email'] });
  const existing = await Customer.findOne({ email }).lean();
  if (existing) return { customer: existing, created: false, existingByEmail: true };
  try {
    const customer = await Customer.create({
      email,
      // Aléatoire et jamais transmis : la cliente choisit le sien depuis le lien reçu.
      password: crypto.randomBytes(24).toString('base64url'),
      ...identity,
      emailVerified: false,
      createdByInstitute: true,
    });
    return { customer: customer.toObject(), created: true };
  } catch (err) {
    if (err?.code === 11000) return { customer: await Customer.findOne({ email }).lean(), created: false, existingByEmail: true };
    throw err;
  }
}

/**
 * Manager : donne l'accès à une formation en ligne, sans paiement. Appelé APRÈS
 * la validation de l'institut (étape de confirmation de l'écran).
 */
export async function grantTrainingAccess(productId, payload = {}, userId = null) {
  const product = await distanceTraining(productId);
  const { customer, created, existingByEmail } = await resolveCustomer(payload);
  const accesses = await accessesOf(product._id);
  if (accesses.has(String(customer._id))) {
    throw ApiError.conflict(`${customer.firstName || customer.email} a déjà accès à cette formation.`, { code: 'TRAINING_ALREADY_MEMBER' });
  }
  let grant;
  try {
    grant = await TrainingAccessGrant.create({
      customerId: customer._id, productId: product._id, productTitle: product.title,
      grantedBy: asId(userId), accountCreated: created,
    });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Cette cliente a déjà accès à cette formation.', { code: 'TRAINING_ALREADY_MEMBER' });
    throw err;
  }

  // D'abord le compte (choisir son mot de passe), puis l'accès à la formation : l'ordre de lecture de la cliente.
  let accountEmail = false;
  if (created) accountEmail = Boolean(await sendCustomerAccessLink(customer, { origin: 'MANUAL_TRAINING' }).catch(() => null));
  const event = await emitAndDispatch({
    type: 'training.access.granted',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      grantId: String(grant._id),
      customerId: String(customer._id),
      customerEmailMasked: maskEmail(customer.email),
      productId: String(product._id),
      trainingTitle: String(product.title || 'Formation').slice(0, 180),
      accountPending: isPendingInstituteAccount(customer),
      grantedAt: grant.grantedAt.toISOString(),
    },
    idempotencyKey: `training-access-granted:${grant._id}`,
  });
  return {
    grantId: String(grant._id),
    customerId: String(customer._id),
    accountCreated: created,
    existingByEmail: Boolean(existingByEmail),
    accountEmailSent: accountEmail,
    trainingEmailSent: Boolean(event),
  };
}

/** Manager : retire un accès OFFERT (un achat ne se retire pas d'ici : remboursement). */
export async function revokeTrainingAccess(productId, grantId, userId = null) {
  const _id = asId(grantId);
  const grant = _id ? await TrainingAccessGrant.findOne({ _id, productId: asId(productId), active: true }) : null;
  if (!grant) throw ApiError.notFound('Accès offert introuvable (déjà retiré ?)');
  grant.active = false;
  grant.revokedAt = new Date();
  grant.revokedBy = asId(userId);
  await grant.save();
  return { revoked: true };
}

/** E-mail encore pertinent ? Un accès retiré avant l'envoi annule l'e-mail. */
export async function trainingAccessGrantStillActive(event) {
  const _id = asId(event?.payloadSafe?.grantId);
  const active = Boolean(_id && await TrainingAccessGrant.exists({ _id, active: true }));
  return active ? { relevant: true } : { relevant: false, reason: 'Accès retiré avant l’envoi.' };
}
