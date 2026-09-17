// controllers/customer360Controller.js
// M12 — Customer 360 (Client Hub). Endpoints admin/dev (lecture seule, agrégation).
// M13 — ajout des notes internes client (lecture + création).
import mongoose from 'mongoose';
import { buildCustomer360, searchCustomers } from '../services/customer360/customer360Service.js';
import CustomerNote from '../models/CustomerNote.js';
import User from '../models/user.js';
import { getSessionUserId } from '../utils/session.js';

function serializeNote(note) {
  return {
    id: note._id?.toString(),
    body: note.body || '',
    authorRole: note.authorRole || 'admin',
    authorLabel: note.authorLabel || '',
    createdAt: note.createdAt || null
  };
}

// ─── GET /api/gestion/customers?search= ───────────────────────────────────────
export async function listCustomers(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const customers = await searchCustomers({ search: req.query.search, limit: req.query.limit });
    return res.json({ ok: true, customers });
  } catch (error) {
    console.error('[customer360] listCustomers error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Impossible de rechercher les clients.' });
  }
}

// ─── GET /api/gestion/customers/:customerId/360 ───────────────────────────────
export async function getCustomer360(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const data = await buildCustomer360(req.params.customerId);
    return res.json({ ok: true, ...data });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, code: error.code || null, error: error.message });
    }
    console.error('[customer360] getCustomer360 error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la fiche client.' });
  }
}

// ─── GET /api/gestion/customers/:customerId/notes ─────────────────────────────
export async function listCustomerNotes(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const customerId = String(req.params.customerId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return res.status(400).json({ ok: false, error: 'Client invalide.' });
  }
  try {
    const notes = await CustomerNote.find({ customerId }).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ ok: true, notes: notes.map(serializeNote) });
  } catch (error) {
    console.error('[customer360] listCustomerNotes error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les notes.' });
  }
}

// ─── POST /api/gestion/customers/:customerId/notes ────────────────────────────
export async function createCustomerNote(req, res) {
  const customerId = String(req.params.customerId || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return res.status(400).json({ ok: false, error: 'Client invalide.' });
  }
  if (!body) {
    return res.status(400).json({ ok: false, error: 'La note ne peut pas être vide.', code: 'NOTE_BODY_REQUIRED' });
  }
  try {
    const customer = await User.findById(customerId).select('_id').lean();
    if (!customer) return res.status(404).json({ ok: false, error: 'Client introuvable.' });
    const authorId = getSessionUserId(req);
    const authorRole = String(req.sessionUser?.role || '').trim().toLowerCase() === 'dev' ? 'dev' : 'admin';
    const authorLabel = String(req.sessionUser?.email || '').trim();
    const note = await CustomerNote.create({ customerId, authorId, authorRole, authorLabel, body: body.slice(0, 2000) });
    return res.status(201).json({ ok: true, note: serializeNote(note.toObject()) });
  } catch (error) {
    console.error('[customer360] createCustomerNote error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Impossible d\'enregistrer la note.' });
  }
}

export default { listCustomers, getCustomer360, listCustomerNotes, createCustomerNote };
