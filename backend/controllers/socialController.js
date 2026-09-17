import mongoose from 'mongoose';

import SocialLink, { SOCIAL_TYPES, SOCIAL_ORDER } from '../models/SocialLink.js';

function normalizeType(value) {
  if (!value) return null;
  const candidate = String(value || '').trim().toLowerCase();
  return SOCIAL_TYPES.includes(candidate) ? candidate : null;
}

function mapLink(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString(),
    type: doc.type,
    url: doc.url,
    isActive: Boolean(doc.isActive),
    createdAt: doc.createdAt
  };
}

function sortByOrder(a, b) {
  const indexA = SOCIAL_ORDER.indexOf(a.type);
  const indexB = SOCIAL_ORDER.indexOf(b.type);
  return indexA - indexB;
}

async function loadLinkOrFail(id, res) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ ok: false, error: "Identifiant invalide." });
    return null;
  }
  const link = await SocialLink.findById(id);
  if (!link) {
    res.status(404).json({ ok: false, error: 'Réseau introuvable.' });
    return null;
  }
  return link;
}

function validateUrl(url) {
  if (!url) return false;
  return Boolean(String(url).trim());
}

export async function listSocialLinks(_req, res) {
  try {
    const items = await SocialLink.find().lean();
    const sorted = items.sort((a, b) => sortByOrder(a, b));
    return res.json({ ok: true, socialLinks: sorted.map(mapLink) });
  } catch (error) {
    console.error('Impossible de lister les réseaux sociaux', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les réseaux.' });
  }
}

export async function getActiveSocialLinks(_req, res) {
  try {
    const items = await SocialLink.find({ isActive: true }).lean();
    const ordered = items.sort((a, b) => sortByOrder(a, b));
    return res.json({ ok: true, socialLinks: ordered.map(mapLink) });
  } catch (error) {
    console.error('Erreur récupération réseaux actifs', error);
    return res.status(500).json({ ok: false, error: 'Impossible de récupérer les réseaux actifs.' });
  }
}

export async function createSocialLink(req, res) {
  const type = normalizeType(req.body?.type);
  const url = String(req.body?.url || '').trim();
  if (!type) {
    return res.status(400).json({ ok: false, error: 'Type de réseau invalide.' });
  }
  if (!validateUrl(url)) {
    return res.status(400).json({ ok: false, error: 'URL requise.' });
  }
  try {
    const existing = await SocialLink.findOne({ type });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Ce réseau existe déjà.' });
    }
    const link = new SocialLink({
      type,
      url,
      isActive: Boolean(req.body?.isActive)
    });
    await link.save();
    return res.status(201).json({ ok: true, socialLink: mapLink(link) });
  } catch (error) {
    console.error('Erreur création réseau social', error);
    if (error.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Ce réseau existe déjà.' });
    }
    return res.status(500).json({ ok: false, error: 'Impossible de créer le réseau social.' });
  }
}

export async function updateSocialLink(req, res) {
  const { id } = req.params || {};
  const link = await loadLinkOrFail(id, res);
  if (!link) return;
  const proposedType = normalizeType(req.body?.type) || link.type;
  const url = req.body?.url !== undefined ? String(req.body.url).trim() : link.url;
  if (!validateUrl(url)) {
    return res.status(400).json({ ok: false, error: 'URL requise.' });
  }
  try {
    if (proposedType !== link.type) {
      const conflict = await SocialLink.findOne({ type: proposedType });
      if (conflict) {
        return res.status(409).json({ ok: false, error: 'Ce type de réseau existe déjà.' });
      }
      link.type = proposedType;
    }
    link.url = url;
    if (req.body?.isActive !== undefined) {
      link.isActive = Boolean(req.body.isActive);
    }
    await link.save();
    return res.json({ ok: true, socialLink: mapLink(link) });
  } catch (error) {
    console.error('Erreur mise à jour réseau social', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour le réseau.' });
  }
}

export async function deleteSocialLink(req, res) {
  const { id } = req.params || {};
  try {
    const link = await SocialLink.findById(id);
    if (!link) {
      return res.status(404).json({ ok: false, error: 'Réseau introuvable.' });
    }
    await SocialLink.findByIdAndDelete(id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression réseau social', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le réseau.' });
  }
}
