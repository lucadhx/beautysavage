/**
 * PORTAIL CLIENT STRIPE — modifier sa carte sans qu'elle nous approche.
 *
 * ── LE PARCOURS RETENU, ET POURQUOI ─────────────────────────────────────────
 * Deux options permettaient de modifier un moyen de paiement : le portail
 * hébergé par Stripe, ou un SetupIntent avec Stripe Elements intégré au
 * Manager. Le second demanderait d'écrire et de maintenir la saisie,
 * l'authentification forte, la gestion des cartes expirées, des moyens locaux
 * et des traductions — pour le même résultat, avec une surface à sécuriser bien
 * plus large. Le portail a été retenu pour la V1.
 *
 * Ces contrôles verrouillent ce qui compte : aucune donnée bancaire chez nous,
 * aucun identifiant client exposé, et un retour navigateur qui ne vaut jamais
 * confirmation.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'portal_test';
process.env.DB_PROD = 'portal_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
// L6.3C — il n'y a PLUS de fournisseur simulé côté projet : le pilote Stripe
// local a été supprimé. Le portail passe par le Panel, dont le double sert la
// capacité `billing.portal.create`.
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { Contract } = await import('../models/Contract.model.js');
const { CONTRACT_STATUS } = await import('../utils/contractConstants.js');
const subscriptionSvc = await import('../services/subscription.service.js');
const { pairWithCheckoutPanel } = await import('./helpers/panelCheckoutDouble.helper.js');
const panel = await pairWithCheckoutPanel();

const nouveau = async (extra = {}) => Contract.create({
  reference: `CTR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  name: 'Contrat de test',
  status: CONTRACT_STATUS.ACTIVE,
  environment: 'TEST',
  pricing: { subscription: { enabled: true, amountExcludingTax: 4900, interval: 'MONTH' } },
  ...extra,
});

const aLeve = async (fn) => {
  try { await fn(); return null; } catch (err) { return err; }
};

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Sans client Stripe, il n’y a rien à modifier');
{
  const c = await nouveau({ stripe: { customerId: null } });
  const err = await aLeve(() => subscriptionSvc.openBillingPortal(c, 'https://manager.test/contrat'));
  check('la demande est refusée', err !== null);
  check('…avec un code explicite', err?.details?.code === 'BILLING_CUSTOMER_MISSING');
  check('…et un message qui ne parle pas de panne',
    /aucun moyen de paiement/i.test(err?.message || ''));

  const vue = subscriptionSvc.getPaymentMethodView(c);
  check('la vue le dit aussi', vue.hasCustomer === false && vue.canUpdate === false);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Avec un client Stripe : une session, et rien d’autre');
{
  const c = await nouveau({
    stripe: {
      customerId: 'cus_test_123',
      subscription: { subscriptionId: 'sub_1', currentPeriodEnd: new Date('2026-09-01'), cancelAtPeriodEnd: false },
    },
  });

  const res = await subscriptionSvc.openBillingPortal(c, 'https://manager.test/contrat');
  check('une URL de portail est rendue', typeof res.url === 'string' && res.url.startsWith('https://'));
  check('la réponse ne contient QUE l’URL', Object.keys(res).join(',') === 'url');
  check('…jamais l’identifiant client', !JSON.stringify(res).includes('cus_test_123'));

  /**
   * ── L6.3C — CE QUI EST ENVOYÉ A CHANGÉ, ET C'EST LE POINT ────────────────
   *
   * Le projet envoyait `customer: 'cus_test_123'` — l'identifiant de sa fiche
   * locale. Il envoie désormais la référence de son CONTRAT, et c'est le Panel
   * qui remonte au client par le lien d'appartenance.
   *
   * L'ancien contrôle vérifiait « le client est résolu côté serveur » ; il
   * vérifiait en réalité que le projet avait bien recopié son propre champ. Le
   * nouveau vérifie ce qui compte : le projet ne DÉSIGNE plus personne.
   */
  const appel = panel.portals.at(-1);
  check('le portail est demandé au Panel', Boolean(appel));
  check('…par référence de CONTRAT', appel?.contractRef === String(c._id));
  check('…et l’URL de retour est construite par le backend',
    appel?.returnUrl === 'https://manager.test/contrat');
  check('AUCUN identifiant client n’est transmis par le projet',
    !JSON.stringify(appel).includes('cus_test_123'));

  const vue = subscriptionSvc.getPaymentMethodView(c);
  check('la vue autorise la modification', vue.canUpdate === true);
  check('…annonce la prochaine échéance', vue.currentPeriodEnd !== null);
  check('…et n’invente AUCUNE donnée bancaire',
    !('last4' in vue) && !('brand' in vue) && !('cardNumber' in vue));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. La route est réservée à l’ADMIN, et le contrat vient de la session');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const routes = await lire('src/routes/myContract.routes.js');
  const ctrl = await lire('src/controllers/contract.admin.controller.js');

  check('la route existe', /router\.post\('\/billing-portal', ctrl\.createBillingPortal\)/.test(routes));
  check('…derrière authenticate + authorize(ADMIN)',
    /router\.use\(authenticate, authorize\(ROLES\.ADMIN\)\)/.test(routes));
  check('le contrat est résolu depuis la session, jamais par un id du client',
    /const contract = await adminContractOr404\(\);/.test(
      ctrl.slice(ctrl.indexOf('createBillingPortal')),
    ));
  check('Stripe est exigé au point d’usage',
    /createBillingPortal[\s\S]{0,300}assertProviderReady\('STRIPE'\)/.test(ctrl));
  check('l’URL de retour est construite côté serveur',
    /billingPortal: \{ returnUrl: `\$\{managerUrl\}\/contrat` \}/.test(ctrl));
  check('l’ouverture est auditée', /action: CONTRACT_AUDIT_ACTION\.BILLING_PORTAL_OPENED/.test(ctrl));
  /**
   * L'ACTION ÉTAIT UNE CHAÎNE LITTÉRALE, DONC ABSENTE DE LA TABLE DES LIBELLÉS.
   *
   * Mesuré sur la pile déployée : la timeline renvoyait
   * `label: "BILLING_PORTAL_OPENED"`, affiché tel quel au client. Passer par
   * l'énumération ne suffit pas à l'empêcher de se reproduire — on vérifie donc
   * que TOUTE action connue a un libellé, pas seulement celle-ci.
   */
  const constantes = await lire('src/utils/contractConstants.js');
  const service = await lire('src/services/contract.service.js');
  check('…via l’énumération', /BILLING_PORTAL_OPENED: 'BILLING_PORTAL_OPENED'/.test(constantes));
  const bloc = (source, ouverture) => {
    const debut = source.indexOf(ouverture);
    return source.slice(debut, source.indexOf('\n});', debut));
  };
  const actions = bloc(constantes, 'export const CONTRACT_AUDIT_ACTION = Object.freeze({');
  const table = bloc(service, 'const TIMELINE_LABELS = Object.freeze({');
  const sansLibelle = [...actions.matchAll(/^ {2}([A-Z][A-Z0-9_]*): '\1',$/gm)]
    .map(([, nom]) => nom)
    .filter((nom) => !new RegExp(`^ {2}${nom}: ["']`, 'm').test(table));
  check(`aucune action d’audit sans libellé (${sansLibelle.join(', ') || 'aucune'})`,
    sansLibelle.length === 0);
  check('…sans tracer de secret',
    !/customerId/.test(ctrl.slice(ctrl.indexOf('BILLING_PORTAL_OPENED'), ctrl.indexOf('BILLING_PORTAL_OPENED') + 400)));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. L’écran ne prétend rien savoir de la carte');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const page = await fs.readFile(path.join(racine, 'manager/src/pages/MyContractPage.tsx'), 'utf8');
  // Le code RENDU : le commentaire cite justement l'affichage qu'on s'interdit.
  const rendu = page
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  check('une section Paiement existe', /<CardTitle>Paiement<\/CardTitle>/.test(page));
  check('elle n’affiche AUCUN numéro masqué',
    !/••••|\*{4}|last4|Visa|Mastercard/.test(rendu));
  check('…mais dit ce qu’on sait', /Enregistré chez Stripe/.test(page));
  check('la prochaine échéance est affichée', /Prochaine échéance/.test(page));
  check('le bouton mène au portail', /Modifier le moyen de paiement/.test(page));
  check('…avec un état de chargement', /loading=\{pending\}/.test(page.slice(page.indexOf('function PaymentCard'))));
  check('redirection pleine page (le portail refuse les cadres)',
    /window\.location\.href = url/.test(page.slice(page.indexOf('function PaymentCard'))));
  check('la section disparaît sans client Stripe',
    /if \(!vue\?\.hasCustomer\) return null;/.test(page));
  check('la promesse au client est explicite',
    /ne transitent jamais par nos serveurs/.test(page));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. La vérité vient des webhooks, pas du retour navigateur');
{
  const { STRIPE_HANDLED_EVENTS } = await import('../utils/stripeEventRegistry.js');
  check('`customer.subscription.updated` est déjà traité',
    STRIPE_HANDLED_EVENTS.includes('customer.subscription.updated'));
  check('…ainsi que les échecs de facture',
    STRIPE_HANDLED_EVENTS.includes('invoice.payment_failed'));
  check('…et les paiements réussis', STRIPE_HANDLED_EVENTS.includes('invoice.paid'));
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
