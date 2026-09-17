import mongoose from 'mongoose';

import User from '../models/user.js';
import Sale from '../models/Sale.js';
import GiftCard from '../models/GiftCard.js';
import Review from '../models/Review.js';
import Invoice from '../models/Invoice.js';
import ServiceBooking from '../models/ServiceBooking.js';
import NoShowRecord from '../models/NoShowRecord.js';
import RefundRequest from '../models/RefundRequest.js';

function mapClientBase(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    displayName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
    createdAt: user.createdAt,
    bookingSuspended: Boolean(user.bookingSuspended),
    noShowCount: 0
  };
}

async function aggregateSales(userIds = []) {
  if (!userIds.length) return {};
  const buckets = await Sale.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: '$userId',
        salesCount: { $sum: 1 },
        totalSpent: { $sum: '$totalAmount' }
      }
    }
  ]);
  return buckets.reduce((acc, entry) => {
    acc[entry._id.toString()] = {
      salesCount: entry.salesCount,
      totalSpent: entry.totalSpent
    };
    return acc;
  }, {});
}

async function aggregateGiftCards(userIds = []) {
  if (!userIds.length) return {};
  const buckets = await GiftCard.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: '$userId',
        giftCardCount: { $sum: 1 }
      }
    }
  ]);
  return buckets.reduce((acc, entry) => {
    acc[entry._id.toString()] = entry.giftCardCount;
    return acc;
  }, {});
}

async function aggregateReviews(userIds = []) {
  if (!userIds.length) return {};
  const buckets = await Review.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: '$userId',
        reviewCount: { $sum: 1 }
      }
    }
  ]);
  return buckets.reduce((acc, entry) => {
    acc[entry._id.toString()] = entry.reviewCount;
    return acc;
  }, {});
}

async function aggregateNoShows(userIds = []) {
  if (!userIds.length) return {};
  const buckets = await NoShowRecord.aggregate([
    { $match: { clientId: { $in: userIds } } },
    { $group: { _id: '$clientId', count: { $sum: 1 } } }
  ]);
  return buckets.reduce((acc, entry) => {
    acc[entry._id.toString()] = entry.count;
    return acc;
  }, {});
}

export async function listClients(req, res) {
  try {
    const search = String(req.query.search || '').trim();
    const query = search
      ? {
          role: 'client',
          $or: [
            { email: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } }
          ]
        }
      : { role: 'client' };
    const clients = await User.find(query).sort({ createdAt: -1 }).lean();
    const userIds = clients.map(client => client._id).filter(Boolean);
    const [salesMap, giftCardMap, reviewMap, noShowMap] = await Promise.all([
      aggregateSales(userIds),
      aggregateGiftCards(userIds),
      aggregateReviews(userIds),
      aggregateNoShows(userIds)
    ]);
    const payload = clients.map(client => {
      const key = client._id?.toString();
      return {
        ...mapClientBase(client),
        noShowCount: noShowMap[key] || 0,
        salesCount: salesMap[key]?.salesCount || 0,
        totalSpent: salesMap[key]?.totalSpent || 0,
        giftCardCount: giftCardMap[key] || 0,
        reviewCount: reviewMap[key] || 0
      };
    });
    return res.json({ ok: true, clients: payload });
  } catch (error) {
    console.error('Erreur listing clients', error);
    return res.status(500).json({ ok: false, error: 'Impossible de récupérer les clients.' });
  }
}

async function collectClientSales(userId) {
  return Sale.find({ userId }).sort({ createdAt: -1 }).lean();
}

async function collectClientGiftCards(userId) {
  return GiftCard.find({ userId }).sort({ purchasedAt: -1 }).lean();
}

async function collectClientReviews(userId) {
  return Review.find({ userId })
    .populate({ path: 'formationId', select: 'name coverImage' })
    .sort({ createdAt: -1 })
    .lean();
}

export async function getClientDetails(req, res) {
  const { clientId } = req.params || {};
  if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
    return res.status(400).json({ ok: false, error: 'Client invalide.' });
  }
  try {
    const client = await User.findOne({ _id: clientId, role: 'client' }).lean();
    if (!client) {
      return res.status(404).json({ ok: false, error: 'Client introuvable.' });
    }
    const [sales, giftCards, reviews, serviceBookings, noShowRecords, refundRequests] = await Promise.all([
      collectClientSales(client._id),
      collectClientGiftCards(client._id),
      collectClientReviews(client._id),
      ServiceBooking.find({ clientId: client._id })
        .populate('serviceId', 'name')
        .sort({ startAt: -1 })
        .lean(),
      NoShowRecord.find({ clientId: client._id })
        .sort({ recordedAt: -1 })
        .lean(),
      RefundRequest.find({ userId: client._id })
        .sort({ requestedAt: -1 })
        .lean()
    ]);
    const saleIds = sales.map(entry => String(entry?.saleId || '').trim()).filter(Boolean);
    const invoices = saleIds.length
      ? await Invoice.find({ saleId: { $in: saleIds } }).select('saleId invoiceId').lean()
      : [];
    const invoiceMap = new Map(invoices.map(entry => [String(entry?.saleId || '').trim(), entry]));
    const formattedSales = sales.map(entry => ({
      id: entry.saleId,
      saleId: entry.saleId,
      createdAt: entry.createdAt,
      amount: entry.totalAmount,
      itemCount: entry.itemCount,
      customer: entry.customer || {},
      totalAmount: entry.totalAmount,
      items: Array.isArray(entry.items)
        ? entry.items.map(item => ({
            type: item?.type || '',
            itemId: item?.itemId?.toString?.() || item?.itemId || '',
            name: item?.name || '',
            price: Number(item?.price || 0),
            basePrice: Number(item?.basePrice || 0),
            finalPrice: Number(item?.finalPrice || 0),
            promotionApplied: Boolean(item?.promotionApplied)
          }))
        : [],
      giftCardUsage: Array.isArray(entry.giftCardUsage)
        ? entry.giftCardUsage.map(usage => ({
            giftCardId: usage?.giftCardId?.toString?.() || usage?.giftCardId || '',
            code: usage?.code || '',
            amountUsed: Number(usage?.amountUsed || 0)
          }))
        : [],
      client_ip: entry.client_ip || '',
      accepted_cgv: Boolean(entry.accepted_cgv),
      renonciation_text: String(
        entry.renonciation_text || entry.consumerWaiverAcceptedText || ''
      ).trim(),
      date_formation: entry.date_formation || null,
      date_achat: entry.date_achat || entry.createdAt || null,
      consumerWaiverAcceptedText: entry.consumerWaiverAcceptedText || '',
      invoice: invoiceMap.get(String(entry?.saleId || '').trim())
        ? {
            invoiceId: String(invoiceMap.get(String(entry?.saleId || '').trim())?.invoiceId || ''),
            downloadUrl: `/api/gestion/sales/${encodeURIComponent(String(entry?.saleId || '').trim())}/invoice`
          }
        : null
    }));
    const formattedGiftCards = giftCards.map(entry => ({
      id: entry._id?.toString(),
      code: entry.code,
      amount: entry.amount,
      balance: entry.balance,
      status: entry.status,
      purchasedAt: entry.purchasedAt,
      createdAt: entry.createdAt
    }));
    const formattedReviews = reviews.map(entry => ({
      id: entry._id?.toString(),
      rating: entry.rating,
      comment: entry.comment,
      formation: entry.formationId?.name || 'Formation',
      formationId: entry.formationId?._id?.toString() || '',
      formationCover: entry.formationId?.coverImage || '',
      createdAt: entry.createdAt
    }));
    return res.json({
      ok: true,
      client: {
        ...mapClientBase(client),
        noShowCount: noShowRecords.length,
        bookingSuspended: Boolean(client.bookingSuspended)
      },
      sales: formattedSales,
      giftCards: formattedGiftCards,
      reviews: formattedReviews,
      serviceBookings: serviceBookings.map(bk => ({
        id: bk._id.toString(),
        bookingId: bk.bookingId || '',
        serviceName: bk.serviceId?.name || 'Prestation',
        startAt: bk.startAt || null,
        endAt: bk.endAt || null,
        status: bk.status || '',
        depositAmount: Number(bk.depositAmount) || 0,
        totalPrice: Number(bk.totalPrice) || 0,
        paymentType: bk.paymentType || '',
        cancelledAt: bk.cancelledAt || null,
        cancelledBy: bk.cancelledBy || null
      })),
      noShowCount: noShowRecords.length,
      noShowRecords: noShowRecords.map(ns => ({
        id: ns._id.toString(),
        bookingId: ns.bookingId ? ns.bookingId.toString() : '',
        serviceName: ns.serviceName || '',
        scheduledAt: ns.scheduledAt || null,
        recordedAt: ns.recordedAt || null
      })),
      refundRequests: refundRequests.map(rr => ({
        id: rr._id.toString(),
        refundId: rr.refundId || '',
        amount: Number(rr.amount) || 0,
        status: rr.status || '',
        itemType: rr.itemType || '',
        requestedAt: rr.requestedAt || null,
        refundedAt: rr.refundedAt || null,
        meta: rr.meta || {}
      }))
    });
  } catch (error) {
    console.error('Erreur détails client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de récupérer les détails client.' });
  }
}

export async function getClientStats(req, res) {
  try {
    const period = String(req.query.period || '7d').trim();

    const now = new Date();
    let startDate;
    let groupFormat;

    if (period === '7d') {
      startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      groupFormat = '%d/%m';
    } else if (period === '30d') {
      startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      groupFormat = '%d/%m';
    } else if (period === '3m') {
      startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
      groupFormat = '%d/%m';
    } else {
      // 12m
      startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
      groupFormat = '%m/%Y';
    }

    const buckets = await User.aggregate([
      { $match: { role: 'client', createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$createdAt', timezone: 'Europe/Paris' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const labels = [];
    const data = [];
    const bucketMap = new Map(buckets.map(b => [b._id, b.count]));

    const step = period === '12m' ? 30 : 1;
    let current = new Date(startDate);

    while (current <= now) {
      const label = current.toLocaleDateString('fr-FR',
        period === '12m'
          ? { month: '2-digit', year: 'numeric' }
          : { day: '2-digit', month: '2-digit' }
      );
      labels.push(label);
      data.push(bucketMap.get(label) || 0);
      current = new Date(current.getTime() + step * 24 * 60 * 60 * 1000);
    }

    return res.json({ ok: true, labels, data });
  } catch (error) {
    console.error('Erreur stats clients', error);
    return res.status(500).json({ ok: false, error: 'Impossible de récupérer les statistiques.' });
  }
}

export async function toggleClientSuspension(req, res) {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'ID client invalide.' });
    }
    const suspended = Boolean(req.body?.suspended);
    const user = await User.findOneAndUpdate(
      { _id: id, role: 'client' },
      { bookingSuspended: suspended },
      { new: true }
    ).select('bookingSuspended email firstName lastName').lean();
    if (!user) return res.status(404).json({ ok: false, error: 'Client introuvable.' });
    return res.json({ ok: true, bookingSuspended: user.bookingSuspended });
  } catch (error) {
    console.error('Erreur toggle suspension client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de modifier la suspension.' });
  }
}
