/**
 * PÉRIODE D'ABONNEMENT, NOUVELLE FORME DE L'API STRIPE (2026-11-12).
 *
 * Depuis 2025, Stripe ne met plus `current_period_start/end` à la racine de
 * l'abonnement mais sur chaque ligne (`items.data[]`). BeautySavage PROD
 * gardait « fin le 6 novembre » après le renouvellement du 6 novembre.
 * Pure : aucune base.
 */
process.env.ENV = 'TEST';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};
const { projectSubscription } = await import('../services/subscription.service.js');
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
const contract = () => ({ stripe: { customerId: '', subscription: { currentPeriodStart: new Date('2026-10-06T17:07:56Z'), currentPeriodEnd: new Date('2026-11-06T17:07:56Z') } } });

const nouvelle = contract();
projectSubscription(nouvelle, {
  id: 'sub_x', status: 'active', cancel_at_period_end: false,
  items: { data: [{ current_period_start: unix('2026-11-06T17:07:56Z'), current_period_end: unix('2026-12-06T17:07:56Z') }] },
});
check('période lue sur la ligne (API 2025+) : fin au 6 décembre', nouvelle.stripe.subscription.currentPeriodEnd.toISOString() === '2026-12-06T17:07:56.000Z', String(nouvelle.stripe.subscription.currentPeriodEnd));
check('début au 6 novembre', nouvelle.stripe.subscription.currentPeriodStart.toISOString() === '2026-11-06T17:07:56.000Z');

const ancienne = contract();
projectSubscription(ancienne, { id: 'sub_y', status: 'active', current_period_start: unix('2026-11-06T17:07:56Z'), current_period_end: unix('2026-12-06T17:07:56Z') });
check('ancienne forme (racine) toujours lue', ancienne.stripe.subscription.currentPeriodEnd.toISOString() === '2026-12-06T17:07:56.000Z');

const vide = contract();
projectSubscription(vide, { id: 'sub_z', status: 'active' });
check('aucune période transmise : la valeur connue est gardée', vide.stripe.subscription.currentPeriodEnd.toISOString() === '2026-11-06T17:07:56.000Z');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
