import { CommerceCommission } from '../../models/CommerceCommission.model.js';
import { Company } from '../../models/Company.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';
import { EmailVariableResolverError } from './emailVariableResolvers.js';
import { getPublishedDeveloperIdentity } from '../panelConfiguration/developerIdentity.service.js';
import { commissionPayLink } from '../commissionPayment.service.js';

/**
 * COMMISSION_PAYMENT_DUE_ADMIN — les commissions d'un mois terminé.
 *
 * Le lien du bouton est le lien STABLE du projet (`commissionPayLink`), qui
 * ouvre ou reprend la page Stripe du mois au moment du clic : une page Stripe
 * expire en 24 h, un e-mail se relit plus tard.
 */
export async function resolveCommissionPaymentDue({ event }) {
  const id = event?.payloadSafe?.commissionId || null;
  const commission = id ? await CommerceCommission.findById(id).lean() : null;
  if (!commission) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, `La commission ${id ?? '(non désignée)'} n'existe plus : notification sans objet.`);
  }
  const cfg = await getSingleton(SystemConfiguration);
  const manager = (cfg.network?.managerUrl || '').replace(/\/+$/, '');
  if (!manager) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, "L'URL du Manager n'est pas configurée (Configuration système → Réseau).");
  }
  const identite = await getPublishedDeveloperIdentity();
  if (!identite?.name || !identite?.supportEmail) {
    throw new EmailVariableResolverError(D.UNKNOWN_RESOLVER, "L'identité ou l'adresse de contact du prestataire n'est pas publiée par le Panel : ce message ne partira pas.");
  }
  const company = await getSingleton(Company);
  const start = commission.periodStart ? new Date(commission.periodStart) : new Date(`${commission.periodKey}-01T12:00:00Z`);
  const period = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  const sales = (commission.sourceSnapshot?.lines || []).length || (commission.saleIds || []).length;
  const rate = commission.ratePercent ?? (commission.rateBps ? commission.rateBps / 100 : null);
  return {
    'company.name': company?.name || 'Votre entreprise',
    'commission.period': period,
    'commission.amountExcludingTax': { amount: Number(commission.amountCents || 0), currency: commission.currency || 'EUR' },
    'commission.salesCount': `${sales} vente${sales > 1 ? 's' : ''}`,
    'commission.rule': rate === null ? 'selon votre contrat' : `${String(rate).replace('.', ',')} % ${commission.basis || 'TTC'}`,
    'commission.payUrl': await commissionPayLink(commission._id),
    'manager.commissionsUrl': `${manager}/commerce/commissions`,
    'developer.companyName': identite.name,
    'developer.supportEmail': identite.supportEmail,
  };
}
