import GiftCardTemplate, { GIFT_CARD_TEMPLATE_VARIABLES } from '../models/GiftCardTemplate.js';
import {
  serializeGiftCardTemplate,
  getActiveGiftCardTemplate,
  getPublishedTemplateBySlug,
  listGiftCardTemplates,
  listGiftCardTemplateVersions,
  createGiftCardTemplate,
  createDraftFromPublished,
  updateDraft,
  publishDraft,
  archiveTemplate,
  rollbackToVersion,
  activateGiftCardTemplate
} from '../services/giftCard/giftCardTemplateService.js';
import { renderGiftCardPreview } from '../services/giftCard/giftCardRenderService.js';

function actorOf(req) {
  return String(req.sessionUser?.email || req.sessionUser?._id || '').trim();
}

function handleServiceError(res, error, fallback) {
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
  if (status >= 500) {
    console.error(fallback, error);
  }
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : error.message,
    code: error?.code || null
  });
}

/* ============================ DEV — Gift Card Template Studio ============================ */

export async function listTemplatesHandler(_req, res) {
  try {
    const templates = await listGiftCardTemplates({ visibleOnly: false });
    return res.json({ ok: true, templates, variables: [...GIFT_CARD_TEMPLATE_VARIABLES] });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de lister les templates.');
  }
}

export async function getTemplateHandler(req, res) {
  try {
    const template = await getPublishedTemplateBySlug(req.params.slug);
    if (!template) return res.status(404).json({ ok: false, error: 'Template introuvable.' });
    return res.json({ ok: true, template: serializeGiftCardTemplate(template) });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de lire le template.');
  }
}

export async function listVersionsHandler(req, res) {
  try {
    const versions = await listGiftCardTemplateVersions(req.params.slug);
    return res.json({ ok: true, versions });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de lister les versions.');
  }
}

export async function createTemplateHandler(req, res) {
  try {
    const template = await createGiftCardTemplate(req.body || {}, actorOf(req));
    return res.status(201).json({ ok: true, template });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de créer le template.');
  }
}

export async function createDraftHandler(req, res) {
  try {
    const draft = await createDraftFromPublished(req.params.slug, req.body || {}, actorOf(req));
    return res.status(201).json({ ok: true, template: draft });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de créer le brouillon.');
  }
}

export async function updateDraftHandler(req, res) {
  try {
    const draft = await updateDraft(req.params.id, req.body || {}, actorOf(req));
    return res.json({ ok: true, template: draft });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de mettre à jour le brouillon.');
  }
}

export async function publishDraftHandler(req, res) {
  try {
    const template = await publishDraft(req.params.id, actorOf(req));
    return res.json({ ok: true, template });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de publier le brouillon.');
  }
}

export async function archiveTemplateHandler(req, res) {
  try {
    const template = await archiveTemplate(req.params.id, actorOf(req));
    return res.json({ ok: true, template });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible d\'archiver le template.');
  }
}

export async function rollbackHandler(req, res) {
  try {
    const template = await rollbackToVersion(req.params.slug, req.params.version, actorOf(req));
    return res.json({ ok: true, template });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de restaurer la version.');
  }
}

/** Preview live (aucun envoi). Rend un template fourni inline OU par id, avec QR factice. */
export async function previewTemplateHandler(req, res) {
  try {
    let template;
    const id = String(req.body?.id || req.query?.id || '').trim();
    if (id) {
      const doc = await GiftCardTemplate.findById(id).lean();
      if (!doc) return res.status(404).json({ ok: false, error: 'Template introuvable.' });
      template = doc;
    } else {
      template = {
        html: String(req.body?.html || ''),
        css: String(req.body?.css || ''),
        previewData: req.body?.previewData || {}
      };
    }
    const { html } = await renderGiftCardPreview(template, req.body?.overrides || {});
    return res.json({ ok: true, html });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de générer la preview.');
  }
}

/* ============================ ADMIN — Librairie templates ============================ */

/** Librairie admin : templates publiés ET visibles. */
export async function listLibraryHandler(_req, res) {
  try {
    const templates = await listGiftCardTemplates({ visibleOnly: true });
    return res.json({ ok: true, templates });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de lister la librairie.');
  }
}

export async function getActiveTemplateHandler(_req, res) {
  try {
    const active = await getActiveGiftCardTemplate();
    return res.json({ ok: true, template: active ? serializeGiftCardTemplate(active) : null });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de lire le template actif.');
  }
}

/** Sélection du template actif (admin). Garantit "toujours exactement un actif". */
export async function activateTemplateHandler(req, res) {
  try {
    const template = await activateGiftCardTemplate(req.params.id, actorOf(req));
    return res.json({ ok: true, template });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible d\'activer le template.');
  }
}

/** Preview d'un template de la librairie (admin) par id, sans édition. */
export async function previewLibraryTemplateHandler(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const doc = await GiftCardTemplate.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Template introuvable.' });
    const { html } = await renderGiftCardPreview(doc, {});
    return res.json({ ok: true, html });
  } catch (error) {
    return handleServiceError(res, error, 'Impossible de générer la preview.');
  }
}
