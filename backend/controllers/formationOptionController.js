import fs from 'node:fs/promises';
import path from 'node:path';

import mongoose from 'mongoose';

import Formation from '../models/Formation.js';

function validateObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function buildOptionPayload(option) {
  if (!option) return null;
  return {
    id: option._id?.toString(),
    name: option.name || '',
    description: option.description || '',
    image: option.image || '',
    price: Number.isFinite(Number(option.price)) ? Number(option.price) : 0,
    deadlineDays: Number.isFinite(Number(option.deadlineDays)) ? Number(option.deadlineDays) : 0
  };
}

export async function listOptions(req, res) {
  const formationId = String(req.params.formationId || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const formation = await Formation.findById(formationId).lean();
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (formation.type !== 'presentiel') {
      return res.status(400).json({ ok: false, error: 'Les options ne sont disponibles que pour les formations présentielles.' });
    }
    const options = Array.isArray(formation.options) ? formation.options : [];
    return res.json({ ok: true, options: options.map(buildOptionPayload) });
  } catch (error) {
    console.error('Erreur liste options formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les options.' });
  }
}

export async function createOption(req, res) {
  const formationId = String(req.params.formationId || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Le nom de l\'option est requis.' });
  }
  const rawPrice = Number.parseFloat(req.body?.price);
  if (!Number.isFinite(rawPrice) || rawPrice < 0) {
    return res.status(400).json({ ok: false, error: 'Le prix de l\'option est invalide.' });
  }
  const rawDeadlineDays = Number.parseInt(req.body?.deadlineDays, 10);
  if (!Number.isFinite(rawDeadlineDays) || rawDeadlineDays < 0) {
    return res.status(400).json({ ok: false, error: 'Le délai est invalide.' });
  }
  const description = String(req.body?.description || '').trim();
  const imagePath = req.file ? `/uploads/formation-options/${req.file.filename}` : '';
  try {
    const formation = await Formation.findById(formationId);
    if (!formation) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (formation.type !== 'presentiel') {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(400).json({ ok: false, error: 'Les options ne sont disponibles que pour les formations présentielles.' });
    }
    if (!Array.isArray(formation.options)) {
      formation.options = [];
    }
    formation.options.push({
      name,
      description,
      image: imagePath,
      price: Math.round(rawPrice * 100) / 100,
      deadlineDays: rawDeadlineDays
    });
    await formation.save();
    const created = formation.options[formation.options.length - 1];
    return res.status(201).json({ ok: true, option: buildOptionPayload(created) });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Erreur création option formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de créer l\'option.' });
  }
}

export async function updateOption(req, res) {
  const formationId = String(req.params.formationId || '').trim();
  const optionId = String(req.params.optionId || '').trim();
  if (!validateObjectId(formationId) || !validateObjectId(optionId)) {
    return res.status(400).json({ ok: false, error: 'Formation ou option invalide.' });
  }
  try {
    const formation = await Formation.findById(formationId);
    if (!formation) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (formation.type !== 'presentiel') {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(400).json({ ok: false, error: 'Les options ne sont disponibles que pour les formations présentielles.' });
    }
    const option = formation.options?.id(optionId);
    if (!option) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(404).json({ ok: false, error: 'Option introuvable.' });
    }
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) {
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(400).json({ ok: false, error: 'Le nom de l\'option est requis.' });
      }
      option.name = name;
    }
    if (req.body?.description !== undefined) {
      option.description = String(req.body.description || '').trim();
    }
    if (req.body?.price !== undefined) {
      const rawPrice = Number.parseFloat(req.body.price);
      if (!Number.isFinite(rawPrice) || rawPrice < 0) {
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(400).json({ ok: false, error: 'Le prix de l\'option est invalide.' });
      }
      option.price = Math.round(rawPrice * 100) / 100;
    }
    if (req.body?.deadlineDays !== undefined) {
      const rawDeadlineDays = Number.parseInt(req.body.deadlineDays, 10);
      if (!Number.isFinite(rawDeadlineDays) || rawDeadlineDays < 0) {
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(400).json({ ok: false, error: 'Le délai est invalide.' });
      }
      option.deadlineDays = rawDeadlineDays;
    }
    if (req.file) {
      const oldImage = String(option.image || '').trim();
      if (oldImage && oldImage.startsWith('/uploads/')) {
        const oldPath = path.join(process.cwd(), oldImage);
        await fs.unlink(oldPath).catch(() => {});
      }
      option.image = `/uploads/formation-options/${req.file.filename}`;
    }
    await formation.save();
    return res.json({ ok: true, option: buildOptionPayload(option) });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Erreur modification option formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de modifier l\'option.' });
  }
}

export async function deleteOptionImage(req, res) {
  const formationId = String(req.params.formationId || '').trim();
  const optionId = String(req.params.optionId || '').trim();
  if (!validateObjectId(formationId) || !validateObjectId(optionId)) {
    return res.status(400).json({ ok: false, error: 'Formation ou option invalide.' });
  }
  try {
    const formation = await Formation.findById(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (formation.type !== 'presentiel') {
      return res.status(400).json({ ok: false, error: 'Les options ne sont disponibles que pour les formations presentielles.' });
    }
    const option = formation.options?.id(optionId);
    if (!option) {
      return res.status(404).json({ ok: false, error: 'Option introuvable.' });
    }
    const oldImage = String(option.image || '').trim();
    option.image = '';
    await formation.save();
    if (oldImage && oldImage.startsWith('/uploads/')) {
      const oldPath = path.join(process.cwd(), oldImage);
      await fs.unlink(oldPath).catch(() => {});
    }
    return res.json({ ok: true, option: buildOptionPayload(option) });
  } catch (error) {
    console.error('Erreur suppression image option formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer l\'image.' });
  }
}

export async function deleteOption(req, res) {
  const formationId = String(req.params.formationId || '').trim();
  const optionId = String(req.params.optionId || '').trim();
  if (!validateObjectId(formationId) || !validateObjectId(optionId)) {
    return res.status(400).json({ ok: false, error: 'Formation ou option invalide.' });
  }
  try {
    const formation = await Formation.findById(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (formation.type !== 'presentiel') {
      return res.status(400).json({ ok: false, error: 'Les options ne sont disponibles que pour les formations présentielles.' });
    }
    const option = formation.options?.id(optionId);
    if (!option) {
      return res.status(404).json({ ok: false, error: 'Option introuvable.' });
    }
    const oldImage = String(option.image || '').trim();
    formation.options.pull({ _id: optionId });
    await formation.save();
    if (oldImage && oldImage.startsWith('/uploads/')) {
      const oldPath = path.join(process.cwd(), oldImage);
      await fs.unlink(oldPath).catch(() => {});
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression option formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer l\'option.' });
  }
}
