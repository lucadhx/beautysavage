import express from 'express';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import ServiceSettings from '../models/ServiceSettings.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'));

// GET /api/gestion/service-settings
router.get('/', async (req, res) => {
  try {
    const settings = await ServiceSettings.findOne().lean();
    if (!settings) {
      return res.json({
        ok: true,
        settings: {
          noShowSystemEnabled: true,
          noShowSuspensionThreshold: 3,
          allowClientChoosePractitioner: true,
          reminders: [{ hoursBeforeAppointment: 24, isActive: true }]
        }
      });
    }
    return res.json({ ok: true, settings });
  } catch (error) {
    console.error('getServiceSettings error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

// PUT /api/gestion/service-settings
router.put('/', async (req, res) => {
  try {
    const {
      noShowSystemEnabled,
      noShowSuspensionThreshold,
      allowClientChoosePractitioner,
      reminders
    } = req.body;

    const update = { updatedAt: new Date() };
    if (typeof noShowSystemEnabled === 'boolean') update.noShowSystemEnabled = noShowSystemEnabled;
    if (typeof noShowSuspensionThreshold === 'number') update.noShowSuspensionThreshold = noShowSuspensionThreshold;
    if (typeof allowClientChoosePractitioner === 'boolean') update.allowClientChoosePractitioner = allowClientChoosePractitioner;
    if (Array.isArray(reminders)) update.reminders = reminders;

    const settings = await ServiceSettings.findOneAndUpdate({}, { $set: update }, { upsert: true, new: true }).lean();
    return res.json({ ok: true, settings });
  } catch (error) {
    console.error('putServiceSettings error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
});

export default router;
