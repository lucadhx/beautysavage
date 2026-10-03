import { SiteStatus } from '../models/SiteStatus.model.js';
import { getSingleton } from '../utils/singleton.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * LES ACHATS SUIVENT L'ÉTAT DU SITE.
 *
 * Quand la protection contractuelle (ou une suspension technique, ou un
 * défaut de paiement) met le site en suspension, la vitrine affiche la page
 * de suspension — mais l'API d'achat, elle, répondait toujours : un appel
 * direct pouvait encore remplir un panier, ouvrir un paiement Stripe ou
 * réserver un créneau sur un site censé être fermé.
 *
 * Ce garde ferme ces portes côté serveur. Il NE ferme PAS les webhooks
 * Stripe : un paiement déjà lancé avant la suspension doit être enregistré
 * jusqu'au bout — l'argent encaissé sans vente enregistrée serait pire.
 */
export async function requireSiteOpenForPurchase(_req, _res, next) {
  try {
    const status = await getSingleton(SiteStatus);
    if (status?.status === 'SUSPENDED') {
      return next(ApiError.forbidden('Les réservations et les achats sont momentanément indisponibles.', { code: 'SITE_SUSPENDED' }));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}
