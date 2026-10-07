import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Customer } from '../models/Customer.model.js';

export const authenticateCustomer = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Session client manquante');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      audience: 'beautysavage.customer',
    });
  } catch {
    throw ApiError.unauthorized('Session client invalide ou expiree');
  }

  const customer = await Customer.findById(payload.sub).select('-password');
  if (!customer) throw ApiError.unauthorized('Compte client introuvable');
  req.customer = customer;
  next();
});

/**
 * Identifie la cliente SI elle est connectée, sans jamais refuser.
 *
 * Pour les lectures publiques qui doivent la reconnaître (ses propres
 * retenues de créneau) mais rester ouvertes à tout visiteur. Un jeton absent,
 * invalide ou expiré laisse simplement `req.customer` vide.
 */
export const identifyCustomer = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'], audience: 'beautysavage.customer' });
      const customer = await Customer.findById(payload.sub).select('_id');
      if (customer) req.customer = customer;
    } catch { /* visiteur anonyme */ }
  }
  next();
});

export function signCustomerToken(customer) {
  return jwt.sign(
    { sub: String(customer._id), typ: 'CUSTOMER' },
    config.jwt.secret,
    { algorithm: 'HS256', audience: 'beautysavage.customer', expiresIn: '14d' }
  );
}
