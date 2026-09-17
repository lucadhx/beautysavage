import PractitionerProfile from '../models/PractitionerProfile.js';
import User from '../models/user.js';

const ALLOWED_SLOT_GRANULARITIES = [15, 30, 45, 60];

function isSessionAdmin(req) {
  return String(req?.sessionUser?.role || '') === 'admin';
}

function buildDisplayName(user = null) {
  const firstName = String(user?.firstName || '').trim();
  const lastName = String(user?.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (firstName) return firstName;
  const email = String(user?.email || '').trim();
  if (!email) return 'Praticienne';
  return email.split('@')[0] || 'Praticienne';
}

function normalizeServiceIds(serviceIds) {
  if (!Array.isArray(serviceIds)) return [];
  return serviceIds.map(id => String(id || '').trim()).filter(Boolean);
}

function buildPractitionerPayload(doc, user = null) {
  if (!doc) return null;
  const sourceUser = user || doc.userId || {};
  return {
    id: doc._id?.toString(),
    userId: doc.userId?.toString(),
    displayName: doc.displayName || '',
    bio: doc.bio || '',
    photo: doc.photo || null,
    color: doc.color || '#c5bb96',
    slotGranularity: doc.slotGranularity || 30,
    serviceIds: (doc.serviceIds || []).map(id => id?.toString()),
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    email: sourceUser?.email || null,
    firstName: sourceUser?.firstName || null,
    lastName: sourceUser?.lastName || null
  };
}

function buildAdminWithPractitionerPayload(user, profile) {
  const practitioner = buildPractitionerPayload(profile, user);
  const isUserActive =
    typeof user?.isActive === 'boolean'
      ? user.isActive
      : typeof user?.active === 'boolean'
        ? user.active
        : true;

  return {
    userId: user?._id?.toString(),
    email: user?.email || '',
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    fullName: buildDisplayName(user),
    role: user?.role || 'admin',
    isUserActive,
    practitioner,
    practitionerStatus: practitioner?.isActive ? 'active' : 'inactive'
  };
}

export async function listPractitioners(req, res) {
  try {
    const admins = await User.find({ role: 'admin' })
      .select('email firstName lastName role isActive active')
      .sort({ firstName: 1, lastName: 1, email: 1 })
      .lean();

    const adminIds = admins.map(admin => admin._id).filter(Boolean);
    const profiles = await PractitionerProfile.find({ userId: { $in: adminIds } }).lean();
    const profileMap = new Map(profiles.map(profile => [String(profile.userId), profile]));

    return res.json({
      ok: true,
      practitioners: admins.map(admin =>
        buildAdminWithPractitionerPayload(admin, profileMap.get(String(admin._id)) || null)
      )
    });
  } catch (err) {
    console.error('[practitionerController] listPractitioners', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getMyPractitionerProfile(req, res) {
  try {
    const doc = await PractitionerProfile.findOne({ userId: req.sessionUser._id }).lean();
    return res.json({
      ok: true,
      admin: {
        userId: req.sessionUser?._id?.toString(),
        email: req.sessionUser?.email || '',
        firstName: req.sessionUser?.firstName || '',
        lastName: req.sessionUser?.lastName || '',
        fullName: buildDisplayName(req.sessionUser)
      },
      practitioner: buildPractitionerPayload(doc, req.sessionUser)
    });
  } catch (err) {
    console.error('[practitionerController] getMyPractitionerProfile', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function activateMyPractitionerProfile(req, res) {
  if (!isSessionAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Seuls les admins peuvent activer ce statut.' });
  }

  try {
    const userId = req.sessionUser._id;
    let doc = await PractitionerProfile.findOne({ userId });
    let created = false;

    if (!doc) {
      doc = await PractitionerProfile.create({
        userId,
        displayName: buildDisplayName(req.sessionUser),
        bio: '',
        slotGranularity: 30,
        serviceIds: [],
        isActive: true
      });
      created = true;
    } else {
      doc.isActive = true;
      if (!String(doc.displayName || '').trim()) {
        doc.displayName = buildDisplayName(req.sessionUser);
      }
      await doc.save();
    }

    return res.status(created ? 201 : 200).json({
      ok: true,
      practitioner: buildPractitionerPayload(doc, req.sessionUser)
    });
  } catch (err) {
    if (err.code === 11000) {
      try {
        const existing = await PractitionerProfile.findOne({ userId: req.sessionUser._id }).lean();
        return res.json({
          ok: true,
          practitioner: buildPractitionerPayload(existing, req.sessionUser)
        });
      } catch (fallbackErr) {
        console.error('[practitionerController] activateMyPractitionerProfile fallback', fallbackErr);
      }
    }
    console.error('[practitionerController] activateMyPractitionerProfile', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deactivateMyPractitionerProfile(req, res) {
  if (!isSessionAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Seuls les admins peuvent desactiver ce statut.' });
  }

  try {
    const doc = await PractitionerProfile.findOne({ userId: req.sessionUser._id });
    if (!doc) {
      return res.status(404).json({ ok: false, error: 'Profil praticienne introuvable.' });
    }
    doc.isActive = false;
    await doc.save();
    return res.json({
      ok: true,
      practitioner: buildPractitionerPayload(doc, req.sessionUser)
    });
  } catch (err) {
    console.error('[practitionerController] deactivateMyPractitionerProfile', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateMyPractitionerProfile(req, res) {
  if (!isSessionAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Seuls les admins peuvent modifier ce profil.' });
  }

  try {
    const doc = await PractitionerProfile.findOne({ userId: req.sessionUser._id });
    if (!doc) {
      return res.status(404).json({ ok: false, error: 'Profil praticienne introuvable.' });
    }

    const { displayName, bio, slotGranularity, serviceIds } = req.body || {};

    if (slotGranularity !== undefined && !ALLOWED_SLOT_GRANULARITIES.includes(Number(slotGranularity))) {
      return res.status(400).json({ ok: false, error: 'Intervalle invalide.' });
    }
    if (serviceIds !== undefined && !Array.isArray(serviceIds)) {
      return res.status(400).json({ ok: false, error: 'serviceIds doit etre un tableau.' });
    }

    if (displayName !== undefined) doc.displayName = String(displayName || '').trim();
    if (bio !== undefined) doc.bio = String(bio || '').trim();
    if (slotGranularity !== undefined) doc.slotGranularity = Number(slotGranularity);
    if (serviceIds !== undefined) doc.serviceIds = normalizeServiceIds(serviceIds);

    await doc.save();

    return res.json({
      ok: true,
      practitioner: buildPractitionerPayload(doc, req.sessionUser)
    });
  } catch (err) {
    console.error('[practitionerController] updateMyPractitionerProfile', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
