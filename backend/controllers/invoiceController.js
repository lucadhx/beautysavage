import fs from 'node:fs';
import path from 'node:path';
import Invoice from '../models/Invoice.js';
import Sale from '../models/Sale.js';
import { getSessionUserId } from '../utils/session.js';
import { getStripeClient } from '../services/stripe/stripeConfigService.js';

// LOT1 — accès Stripe institut consolidé sur l'accesseur canonique `getStripeClient`.
const getStripe = getStripeClient;

function resolveSaleTitle(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const formationItem = items.find(item => String(item?.type || '').trim().toLowerCase() === 'formation');
  const firstItem = items[0] || null;
  return String(formationItem?.name || firstItem?.name || 'Formation').trim() || 'Formation';
}

function resolveSaleDate(sale) {
  return sale?.date_achat || sale?.createdAt || null;
}

async function resolveReadableInvoicePath(invoice) {
  const pdfPath = String(invoice?.pdfPath || '').trim();
  if (!pdfPath) return null;
  const resolvedPath = path.resolve(process.cwd(), pdfPath);
  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
    return resolvedPath;
  } catch (error) {
    console.error('Facture introuvable sur le disque', error);
    return null;
  }
}

async function resolveStripeInvoicePdfUrl(invoiceDoc) {
  if (!invoiceDoc) return null;

  const directUrl = String(invoiceDoc.stripeInvoicePdfUrl || '').trim();
  if (directUrl) {
    return directUrl;
  }

  const stripeInvoiceId = String(invoiceDoc.stripeInvoiceId || '').trim();
  if (!stripeInvoiceId) {
    return null;
  }

  try {
    const stripe = await getStripe();
    const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId);
    const stripePdfUrl = String(stripeInvoice?.invoice_pdf || '').trim();
    if (!stripePdfUrl) {
      return null;
    }
    invoiceDoc.stripeInvoicePdfUrl = stripePdfUrl;
    await invoiceDoc.save();
    return stripePdfUrl;
  } catch (error) {
    console.error('Erreur recuperation invoice_pdf Stripe', error);
    return null;
  }
}

export async function getInvoiceStatusByToken(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: 'Token facture invalide.' });
  }

  try {
    const sale = await Sale.findOne({ invoiceToken: token }).lean();
    if (!sale) {
      return res.status(404).json({ ok: false, error: 'Facture introuvable.' });
    }

    const invoice = await Invoice.findOne({ saleId: String(sale.saleId || '').trim() });

    let invoiceUrl = null;
    if (invoice) {
      const stripePdfUrl = await resolveStripeInvoicePdfUrl(invoice);
      if (stripePdfUrl) {
        invoiceUrl = stripePdfUrl;
      } else {
        const hasLegacyPdf = Boolean(await resolveReadableInvoicePath(invoice));
        if (hasLegacyPdf) {
          invoiceUrl = `/api/invoice/download/${encodeURIComponent(token)}`;
        }
      }
    }

    return res.json({
      ready: Boolean(invoiceUrl),
      invoiceUrl,
      formationTitle: resolveSaleTitle(sale),
      amount: Number.isFinite(Number(sale?.totalAmount)) ? Number(sale.totalAmount) : 0,
      date: resolveSaleDate(sale)
    });
  } catch (error) {
    console.error('Erreur statut facture publique', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer la facture.' });
  }
}

export async function downloadClientInvoice(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const saleId = String(req.params.saleId || '').trim();
  if (!saleId) {
    return res.status(400).json({ ok: false, error: 'Identifiant de vente invalide.' });
  }
  try {
    const invoice = await Invoice.findOne({ saleId, userId });
    if (!invoice) {
      return res.status(404).json({ ok: false, error: 'Facture introuvable.' });
    }

    const stripePdfUrl = await resolveStripeInvoicePdfUrl(invoice);
    if (stripePdfUrl) {
      return res.redirect(302, stripePdfUrl);
    }

    const resolvedPath = await resolveReadableInvoicePath(invoice);
    if (!resolvedPath) {
      return res.status(404).json({ ok: false, error: 'Facture indisponible.' });
    }
    const fileName = String(invoice.fileName || '').trim() || 'facture.pdf';
    return res.download(resolvedPath, fileName, downloadError => {
      if (downloadError && !res.headersSent) {
        console.error('Erreur telechargement facture', downloadError);
        res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
      }
    });
  } catch (error) {
    console.error('Erreur lecture facture client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
  }
}

export async function redirectInvoiceDownload(req, res) {
  const invoiceId = String(req.params.invoiceId || '').trim();
  if (!invoiceId) {
    return res.status(400).send('Identifiant de facture invalide.');
  }
  try {
    const invoice = await Invoice.findOne({ invoiceId }).lean();
    if (!invoice) {
      return res.status(404).send('Facture introuvable.');
    }
    const userId = getSessionUserId(req);
    if (!userId) {
      return res.redirect(`/login?context=invoice&invoiceId=${encodeURIComponent(invoiceId)}`);
    }
    if (String(invoice.userId) !== String(userId)) {
      return res.status(404).send('Facture introuvable.');
    }
    const downloadRoute = `/api/client/sales/${encodeURIComponent(invoice.saleId)}/invoice`;
    return res.redirect(downloadRoute);
  } catch (error) {
    console.error('Erreur redirection facture', error);
    return res.status(500).send('Impossible de rediriger vers la facture.');
  }
}

export async function downloadInvoiceByToken(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: 'Token facture invalide.' });
  }

  try {
    const sale = await Sale.findOne({ invoiceToken: token }).lean();
    if (!sale) {
      return res.status(404).json({ ok: false, error: 'Facture introuvable.' });
    }

    const invoice = await Invoice.findOne({ saleId: String(sale.saleId || '').trim() });
    if (!invoice) {
      return res.status(404).json({ ok: false, error: 'Facture indisponible.' });
    }

    const stripePdfUrl = await resolveStripeInvoicePdfUrl(invoice);
    if (stripePdfUrl) {
      return res.redirect(302, stripePdfUrl);
    }

    const resolvedPath = await resolveReadableInvoicePath(invoice);
    if (!resolvedPath) {
      return res.status(404).json({ ok: false, error: 'Facture indisponible.' });
    }

    const fileName = String(invoice.fileName || '').trim() || 'facture.pdf';
    return res.download(resolvedPath, fileName, downloadError => {
      if (downloadError && !res.headersSent) {
        console.error('Erreur telechargement facture publique', downloadError);
        res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
      }
    });
  } catch (error) {
    console.error('Erreur telechargement facture publique via token', error);
    return res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
  }
}
