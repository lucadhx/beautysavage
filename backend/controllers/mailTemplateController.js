import mongoose from 'mongoose';
import { loadTemplate, saveTemplate, mailFunctions, simulateSaleEmail } from '../services/mailService.js';
import EmailTemplate from '../models/EmailTemplate.js';
import EmailTemplateCategory from '../models/EmailTemplateCategory.js';
import {
  listVersions,
  createDraftFromPublished,
  publishDraft,
  archiveTemplate,
  rollbackToVersion
} from '../services/emailTemplateVersioningService.js';
import { withMailThemeVars, replaceTemplateVariables, stripHtml } from '../services/mail/mailRenderer.js';
import { buildSender } from '../services/mail/mailSenderResolver.js';
import { postToBrevo } from '../services/mail/mailBrevoGateway.js';
import {
  getMailVariableCatalog,
  buildSampleTemplateData,
  validateTemplateContent
} from '../services/mail/mailTemplateVariableCatalog.js';
import { MAIL_DISPATCH_RULES, isMailRoleResolverEnabled } from '../constants/mailDispatchRules.js';
import SendLog from '../models/SendLog.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// LOT2 §3 — Catégorie d'un événement pour la matrice de déclencheurs (filtres UI).
function categoryForTriggerEvent(eventName) {
  const e = String(eventName || '');
  if (e.startsWith('booking.')) return 'réservation';
  if (e.startsWith('refund.')) return 'remboursement';
  if (e.startsWith('gift_card.')) return 'carte cadeau';
  if (e.startsWith('formation.') || e.startsWith('lesson.') || e.startsWith('presence.')) return 'formation';
  if (e.startsWith('commission.')) return 'système';
  if (e.startsWith('review.')) return 'avis';
  if (e.startsWith('sale.') || e.startsWith('payment')) return 'paiement';
  return 'système';
}

const ALLOWED_FUNCTIONS = new Set(mailFunctions.map(value => value.toLowerCase()));

function normalize(value) {
  if (!value) return null;
  return String(value || '').trim().toLowerCase() || null;
}

function validateFunction(functionName) {
  const normalized = normalize(functionName);
  if (!normalized || !ALLOWED_FUNCTIONS.has(normalized)) {
    return null;
  }
  return normalized;
}

export async function getTemplate(req, res) {
  try {
    const functionName = validateFunction(req.query.functionName);
    if (!functionName) {
      return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    }
    const template = await loadTemplate(functionName);
    if (!template) {
      return res.status(404).json({ ok: false, error: 'Template introuvable.' });
    }
    return res.json({
      ok: true,
      template: {
        functionName: template.functionName,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        fullHtml: template.fullHtml,
        mode: template.mode || 'text',
        updatedAt: template.updatedAt
      }
    });
  } catch (error) {
    console.error('Erreur lecture template mail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le template.' });
  }
}

export async function saveTemplateController(req, res) {
  try {
    const functionName = validateFunction(req.body?.functionName);
    if (!functionName) {
      return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    }
    const subject = String(req.body?.subject || '').trim();
    const bodyHtml = String(req.body?.bodyHtml || '');
    const fullHtml = String(req.body?.fullHtml || '');
    const mode = String(req.body?.mode || 'text').trim().toLowerCase();

    // P1-3 — validation NON bloquante : on prévient des variables inconnues / accolades mal
    // fermées sans refuser la sauvegarde (les variables inconnues sont laissées littérales au
    // rendu, jamais exécutées). Le front peut afficher ces avertissements.
    const combined = `${subject}\n${bodyHtml}\n${fullHtml}`;
    const validation = validateTemplateContent(combined);

    const template = await saveTemplate(functionName, subject, bodyHtml, fullHtml, mode);
    // If there was an isMetadataOnly doc, mark it as no longer metadata-only
    await EmailTemplate.updateOne(
      { functionName, isMetadataOnly: true },
      { $set: { isMetadataOnly: false } }
    );
    return res.json({
      ok: true,
      warnings: {
        unknownVariables: validation.unknownVariables,
        malformed: validation.malformed
      },
      template: {
        functionName: template.functionName,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        fullHtml: template.fullHtml,
        mode: template.mode || 'text',
        updatedAt: template.updatedAt
      }
    });
  } catch (error) {
    console.error('Erreur sauvegarde template mail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de sauvegarder le template.' });
  }
}

// P1-3 — Catalogue canonique des variables (source d'autorité backend).
export async function getVariableCatalog(_req, res) {
  try {
    return res.json({ ok: true, variables: getMailVariableCatalog() });
  } catch (error) {
    console.error('Erreur lecture catalogue variables', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le catalogue de variables.' });
  }
}

// LOT2 §2 — Aperçu = PRODUCTION. Rend le template avec EXACTEMENT le renderer de production
// (`replaceTemplateVariables` + `withMailThemeVars`), avec les données d'exemple du catalogue (plus
// d'override optionnel `variables`). L'aperçu HTML est donc identique à ce qui part chez Brevo.
// Accepte un brouillon (subject/html/text) pour l'aperçu live avant sauvegarde.
function extractUsedVariables(...contents) {
  const seen = new Set();
  const re = /\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g;
  for (const c of contents) {
    let m;
    while ((m = re.exec(String(c || ''))) !== null) seen.add(m[1].toLowerCase());
  }
  return Array.from(seen);
}

export async function previewTemplate(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) {
      return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    }

    let subject = req.body?.subject;
    let html = req.body?.html;
    let text = req.body?.text;
    if (subject === undefined || html === undefined || text === undefined) {
      const tpl = await loadTemplate(functionName);
      if (!tpl) return res.status(404).json({ ok: false, error: 'Template introuvable.' });
      subject = subject ?? tpl.subject ?? '';
      html = html ?? tpl.fullHtml ?? tpl.bodyHtml ?? '';
      text = text ?? tpl.bodyHtml ?? '';
    }

    // Override optionnel des variables (sinon exemples du catalogue). Fusion avec le thème réel.
    const overrides = {};
    if (req.body?.variables && typeof req.body.variables === 'object') {
      for (const [k, v] of Object.entries(req.body.variables)) overrides[String(k).toLowerCase()] = String(v);
    }
    const data = await withMailThemeVars({ ...buildSampleTemplateData(), ...overrides });

    const used = extractUsedVariables(subject, html, text);
    const validation = validateTemplateContent(`${subject}\n${html}\n${text}`);

    return res.json({
      ok: true,
      subject: replaceTemplateVariables(subject, data) || subject,
      html: html ? (replaceTemplateVariables(html, data, { html: true }) || html) : '',
      text: text ? (replaceTemplateVariables(text, data) || text) : '',
      usedVariables: used.map((name) => ({ name, known: !validation.unknownVariables.map((u) => u.toLowerCase()).includes(name) })),
      unknownVariables: validation.unknownVariables,
      malformed: validation.malformed,
    });
  } catch (error) {
    console.error('Erreur aperçu template', error);
    return res.status(500).json({ ok: false, error: "Impossible de générer l'aperçu." });
  }
}

// LOT2 §3 — Matrice des déclencheurs (LECTURE SEULE). Le registre code-first `mailDispatchRules`
// reste la source d'autorité : cette vue le rend lisible (événement → template → expéditeur →
// destinataire → actif → envoi direct → moteur → dernier envoi → statut).
export async function getTriggerMatrix(_req, res) {
  try {
    const engineOn = isMailRoleResolverEnabled();
    const rows = await Promise.all(MAIL_DISPATCH_RULES.map(async (rule) => {
      const templateKey = rule.templateKey;
      const [tpl, lastLog] = await Promise.all([
        EmailTemplate.findOne({ functionName: templateKey, status: 'published' }).select('_id').lean().catch(() => null),
        SendLog.findOne({ templateKey }).sort({ queuedAt: -1 }).select('status sentAt queuedAt').lean().catch(() => null)
      ]);
      return {
        event: rule.eventName,
        category: categoryForTriggerEvent(rule.eventName),
        templateKey,
        templatePublished: Boolean(tpl),
        fromRole: rule.fromRole,
        toRole: rule.toRole,
        active: Boolean(rule.enabled),
        directSender: Boolean(rule.directSenderExists),
        engine: engineOn && !rule.directSenderExists,
        lastSentAt: lastLog?.sentAt || lastLog?.queuedAt || null,
        lastStatus: lastLog?.status || null
      };
    }));
    return res.json({ ok: true, engineEnabled: engineOn, rows });
  } catch (error) {
    console.error('Erreur matrice déclencheurs', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la matrice.' });
  }
}

// P1-2 — Envoi de TEST : rend le template avec des données d'EXEMPLE (jamais de vraie donnée
// client ni de vrai token), préfixe l'objet par [TEST], journalise comme test (contextType='test',
// tag 'test'), NE déclenche AUCUN événement métier et NE crée AUCUNE transaction.
export async function testSendTemplate(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) {
      return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    }
    const toEmail = String(req.body?.toEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(toEmail)) {
      return res.status(400).json({ ok: false, error: 'Adresse e-mail de test invalide.' });
    }

    const template = await loadTemplate(functionName);
    if (!template) {
      return res.status(404).json({ ok: false, error: 'Template introuvable.' });
    }

    const sender = await buildSender();
    if (!sender) {
      return res.status(409).json({ ok: false, error: "Aucune identité d'expédition configurée." });
    }

    const data = await withMailThemeVars(buildSampleTemplateData());
    const baseSubject = replaceTemplateVariables(template.subject, data) || template.subject || functionName;
    const subject = `[TEST] ${baseSubject}`;
    const htmlTemplate = template.fullHtml || template.bodyHtml || '';
    const htmlContent = htmlTemplate ? (replaceTemplateVariables(htmlTemplate, data, { html: true }) || htmlTemplate) : '';
    const textTemplate = template.bodyHtml || stripHtml(template.fullHtml || '');
    const textContent = textTemplate ? (replaceTemplateVariables(textTemplate, data) || textTemplate) : '';

    const payload = {
      sender,
      to: [{ email: toEmail }],
      subject,
      tags: ['test', 'communication_test'],
      ...(htmlContent ? { htmlContent } : {}),
      ...(textContent ? { textContent } : {})
    };

    const success = await postToBrevo(payload, { contextType: 'test', contextId: functionName });
    if (!success) {
      return res.status(502).json({ ok: false, error: "Échec de l'envoi de test (fournisseur)." });
    }
    return res.json({ ok: true, functionName, sentTo: toEmail });
  } catch (error) {
    console.error('Erreur envoi de test template', error);
    return res.status(500).json({ ok: false, error: "Impossible d'envoyer l'e-mail de test." });
  }
}

export async function simulateSale(req, res) {
  try {
    const { sale, success } = await simulateSaleEmail();
    if (!sale) {
      return res.status(404).json({ ok: false, error: 'Aucune vente disponible pour la simulation.' });
    }
    if (!success) {
      return res.status(500).json({ ok: false, error: "Impossible d'envoyer le mail de simulation." });
    }
    return res.json({
      ok: true,
      saleId: sale.saleId,
      customer: {
        firstName: sale.customer?.firstName || '',
        lastName: sale.customer?.lastName || '',
        email: sale.customer?.email || ''
      }
    });
  } catch (error) {
    console.error('Erreur simulation vente mail', error);
    return res.status(500).json({ ok: false, error: 'Erreur lors de la simulation de vente.' });
  }
}

export async function listCategories(_req, res) {
  try {
    const categories = await EmailTemplateCategory.find().sort({ order: 1 }).lean();
    return res.json({ ok: true, categories });
  } catch (error) {
    console.error('Erreur lecture catégories templates', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les catégories.' });
  }
}

export async function listTemplates(_req, res) {
  try {
    const [categories, templates] = await Promise.all([
      EmailTemplateCategory.find().sort({ order: 1 }).lean(),
      EmailTemplate.find({ functionName: { $in: Array.from(ALLOWED_FUNCTIONS) } })
        .lean()
    ]);

    const categoryMap = new Map(categories.map(c => [String(c._id), c]));

    // Build result grouped by category
    const templatesByCategory = new Map();
    for (const cat of categories) {
      templatesByCategory.set(String(cat._id), { category: cat, templates: [] });
    }
    const uncategorized = [];

    for (const tpl of templates) {
      if (!ALLOWED_FUNCTIONS.has(tpl.functionName)) continue;
      const catId = tpl.categoryId ? String(tpl.categoryId) : null;
      if (catId && templatesByCategory.has(catId)) {
        templatesByCategory.get(catId).templates.push({
          functionName: tpl.functionName,
          recipient: tpl.recipient || 'client',
          isMetadataOnly: tpl.isMetadataOnly || false,
          updatedAt: tpl.updatedAt || null,
          categoryId: tpl.categoryId
        });
      } else {
        uncategorized.push({
          functionName: tpl.functionName,
          recipient: tpl.recipient || 'client',
          isMetadataOnly: tpl.isMetadataOnly || false,
          updatedAt: tpl.updatedAt || null,
          categoryId: null
        });
      }
    }

    // Add ALLOWED_FUNCTIONS that have no DB doc yet
    const dbFunctions = new Set(templates.map(t => t.functionName));
    for (const fn of ALLOWED_FUNCTIONS) {
      if (!dbFunctions.has(fn)) {
        uncategorized.push({
          functionName: fn,
          recipient: 'client',
          isMetadataOnly: true,
          updatedAt: null,
          categoryId: null
        });
      }
    }

    const groups = [];
    for (const [, group] of templatesByCategory) {
      if (group.templates.length) {
        groups.push(group);
      }
    }
    if (uncategorized.length) {
      groups.push({ category: null, templates: uncategorized });
    }

    return res.json({ ok: true, groups });
  } catch (error) {
    console.error('Erreur liste templates mail', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les templates.' });
  }
}

// --- Versioning endpoints (Phase 5A — backend only, no UI) -------------------

function actorOf(req) {
  return String(req.sessionUser?.email || req.sessionUser?._id || 'dev');
}

export async function listVersionsController(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    const versions = await listVersions(functionName);
    return res.json({ ok: true, functionName, versions });
  } catch (error) {
    console.error('Erreur liste versions template', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les versions.' });
  }
}

export async function createDraftController(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    const changes = {
      subject: req.body?.subject,
      bodyHtml: req.body?.bodyHtml,
      fullHtml: req.body?.fullHtml,
      mode: req.body?.mode
    };
    const draft = await createDraftFromPublished(functionName, changes, actorOf(req));
    return res.status(201).json({
      ok: true,
      draft: { _id: draft._id, functionName: draft.functionName, version: draft.version, status: draft.status }
    });
  } catch (error) {
    console.error('Erreur création draft template', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Impossible de créer le brouillon.' });
  }
}

export async function publishDraftController(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const published = await publishDraft(id, actorOf(req));
    return res.json({
      ok: true,
      published: { _id: published._id, functionName: published.functionName, version: published.version, status: published.status, publishedAt: published.publishedAt }
    });
  } catch (error) {
    console.error('Erreur publication draft template', error);
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de publier le brouillon.' });
  }
}

export async function archiveTemplateController(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const archived = await archiveTemplate(id, actorOf(req));
    return res.json({ ok: true, archived: { _id: archived._id, version: archived.version, status: archived.status } });
  } catch (error) {
    console.error('Erreur archivage template', error);
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible d\'archiver.' });
  }
}

export async function rollbackController(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return res.status(400).json({ ok: false, error: 'Version invalide.' });
    const published = await rollbackToVersion(functionName, version, actorOf(req));
    return res.json({
      ok: true,
      published: { _id: published._id, functionName: published.functionName, version: published.version, status: published.status }
    });
  } catch (error) {
    console.error('Erreur rollback template', error);
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de revenir à cette version.' });
  }
}

export async function updateTemplateCategory(req, res) {
  try {
    const functionName = validateFunction(req.params.functionName);
    if (!functionName) {
      return res.status(400).json({ ok: false, error: 'Fonction de template invalide.' });
    }
    const categoryId = req.body?.categoryId || null;
    const recipient = String(req.body?.recipient || 'client').toLowerCase();
    if (!['client', 'institute', 'both'].includes(recipient)) {
      return res.status(400).json({ ok: false, error: 'Destinataire invalide.' });
    }
    if (categoryId) {
      const cat = await EmailTemplateCategory.findById(categoryId).lean();
      if (!cat) {
        return res.status(404).json({ ok: false, error: 'Catégorie introuvable.' });
      }
    }
    await EmailTemplate.updateOne(
      { functionName },
      { $set: { categoryId: categoryId || null, recipient } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur mise à jour catégorie template', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre à jour la catégorie.' });
  }
}
