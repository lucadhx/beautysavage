/* Tests du domaine Contrat : machine à états, montants, modèles, idempotence.
 * Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4132';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
function section(n) {
  console.log(`\n${n}`);
}

// --- Montants ---------------------------------------------------------------
section('Montants (centimes)');
const money = await import('../utils/money.js');
{
  check('eurosToCents(990) === 99000', money.eurosToCents(990) === 99000);
  check('eurosToCents(19.99) === 1999 (pas de dérive flottante)', money.eurosToCents(19.99) === 1999);
  check('centsToEuros(99000) === 990', money.centsToEuros(99000) === 990);
  let threw = false;
  try {
    money.eurosToCents(-5);
  } catch {
    threw = true;
  }
  check('eurosToCents rejette négatif', threw);

  const p = money.computePricing({ amountExcludingTax: 99000, taxRate: 20 });
  check('TVA 20% de 99000 = 19800', p.taxAmount === 19800);
  check('TTC = 118800', p.amountIncludingTax === 118800);
  const p0 = money.computePricing({ amountExcludingTax: 5000, taxRate: 0 });
  check('TVA 0% -> TTC == HT', p0.amountIncludingTax === 5000 && p0.taxAmount === 0);
  check('tout est entier', Number.isInteger(p.taxAmount) && Number.isInteger(p.amountIncludingTax));
}

// --- Machine à états --------------------------------------------------------
section('Machine à états du contrat');
const sm = await import('../services/contractStateMachine.js');
const { CONTRACT_STATUS: S, ACTIVATION_STEP, PAYMENT_STATUS, SUBSCRIPTION_STATUS, SIGNATURE_STATUS } =
  await import('../utils/contractConstants.js');
{
  check('DRAFT -> PENDING_DEV_SIGNATURE autorisé', sm.canTransition(S.DRAFT, S.PENDING_DEV_SIGNATURE));
  check('DRAFT -> ACTIVE interdit', !sm.canTransition(S.DRAFT, S.ACTIVE));
  check('ACTIVE -> CANCEL_AT_PERIOD_END autorisé', sm.canTransition(S.ACTIVE, S.CANCEL_AT_PERIOD_END));
  check('CANCEL_AT_PERIOD_END -> ENDED autorisé', sm.canTransition(S.CANCEL_AT_PERIOD_END, S.ENDED));
  check('ENDED terminal', !sm.canTransition(S.ENDED, S.ACTIVE));
  check('même statut = no-op autorisé', sm.canTransition(S.ACTIVE, S.ACTIVE));

  let threw = false;
  try {
    sm.assertTransition(S.DRAFT, S.ENDED);
  } catch (e) {
    threw = e.name === 'ContractTransitionError';
  }
  check('assertTransition lève sur transition interdite', threw);

  // deriveActivationStep — contrat non signé
  const c1 = { status: S.INACTIVE, yousign: {}, pricing: { launchFee: { enabled: true }, subscription: { enabled: true } }, stripe: { launchFee: {}, subscription: {} } };
  check('non signé -> étape SIGNATURE', sm.deriveActivationStep(c1) === ACTIVATION_STEP.SIGNATURE);

  // signé, frais requis non payés
  const c2 = { status: S.INACTIVE, yousign: { status: SIGNATURE_STATUS.DONE, devSignedAt: new Date(), adminSignedAt: new Date() }, pricing: { launchFee: { enabled: true }, subscription: { enabled: true } }, stripe: { launchFee: { status: PAYMENT_STATUS.PENDING }, subscription: {} } };
  check('signé, frais impayés -> étape LAUNCH_FEE', sm.deriveActivationStep(c2) === ACTIVATION_STEP.LAUNCH_FEE);

  // signé, frais payés, abo requis inactif
  const c3 = { status: S.INACTIVE, yousign: { status: SIGNATURE_STATUS.DONE, devSignedAt: new Date(), adminSignedAt: new Date() }, pricing: { launchFee: { enabled: true }, subscription: { enabled: true } }, stripe: { launchFee: { status: PAYMENT_STATUS.PAID }, subscription: { status: SUBSCRIPTION_STATUS.NONE } } };
  check('signé, frais payés, abo inactif -> SUBSCRIPTION', sm.deriveActivationStep(c3) === ACTIVATION_STEP.SUBSCRIPTION);

  // tout satisfait mais pas encore activé
  const c4 = { status: S.INACTIVE, yousign: { status: SIGNATURE_STATUS.DONE, devSignedAt: new Date(), adminSignedAt: new Date() }, pricing: { launchFee: { enabled: true }, subscription: { enabled: true } }, stripe: { launchFee: { status: PAYMENT_STATUS.PAID }, subscription: { status: SUBSCRIPTION_STATUS.ACTIVE } } };
  check('tout satisfait -> étape ACTIVATION', sm.deriveActivationStep(c4) === ACTIVATION_STEP.ACTIVATION);
  check('canActivate=true quand tout satisfait', sm.canActivate(c4) === true);

  // étapes non requises sautées : pas de frais ni d'abo
  const c5 = { status: S.INACTIVE, yousign: { status: SIGNATURE_STATUS.DONE, devSignedAt: new Date(), adminSignedAt: new Date() }, pricing: { launchFee: { enabled: false }, subscription: { enabled: false } }, stripe: { launchFee: {}, subscription: {} } };
  check('frais/abo non requis -> directement ACTIVATION', sm.deriveActivationStep(c5) === ACTIVATION_STEP.ACTIVATION);

  // activé -> DONE
  const c6 = { ...c4, status: S.ACTIVE };
  check('contrat ACTIVE -> étape DONE', sm.deriveActivationStep(c6) === ACTIVATION_STEP.DONE);
  check('canActivate=false si déjà ACTIVE', sm.canActivate(c6) === false);
}

// --- Modèles + idempotence --------------------------------------------------
section('Modèles + idempotence webhook');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { Invoice } = await import('../models/Invoice.model.js');
const { WebhookEvent } = await import('../models/WebhookEvent.model.js');
const { ContractAuditLog, logContractAudit } = await import('../models/ContractAuditLog.model.js');
{
  const contract = await Contract.create({ environment: 'TEST', status: S.DRAFT });
  check('Contract créé en DRAFT', contract.status === S.DRAFT);
  check('archived défaut false', contract.archived === false);
  check('nom vide par défaut (aucun pré-remplissage)', contract.name === '');

  await Payment.create({ contractId: contract._id, type: 'LAUNCH_FEE', providerMode: 'TEST', applicationEnvironment: 'TEST', amountExcludingTax: 99000, taxAmount: 19800, amountIncludingTax: 118800, environment: 'TEST' });
  check('Payment créé', (await Payment.countDocuments({ contractId: contract._id })) === 1);

  /**
   * ══ LES INDEX UNIQUES SONT ATTENDUS, PAS SUPPOSÉS ═══════════════════════
   *
   * Les deux contrôles qui suivent éprouvent une UNICITÉ, et une unicité en
   * Mongo n'est portée que par un index — que Mongoose construit en tâche de
   * fond, après la connexion. Tant qu'il n'est pas bâti, la seconde insertion
   * PASSE : le test lit alors « l'idempotence du webhook ne fonctionne pas »
   * sur un produit parfaitement correct.
   *
   * Sur une machine au repos, la construction gagne toujours la course, et le
   * défaut reste invisible. Il s'est manifesté la première fois qu'une
   * certification tournait en parallèle de la chaîne — c'est-à-dire le jour où
   * la machine a eu autre chose à faire. Une intégration continue chargée
   * l'aurait vu bien plus tôt, et personne n'aurait su pourquoi.
   *
   * On attend donc les index. `init()` rend la promesse que Mongoose tient
   * déjà : elle ne construit rien de plus, elle refuse seulement de mesurer
   * avant que la mesure ait un sens.
   */
  await Promise.all([WebhookEvent.init(), Invoice.init()]);

  // Idempotence webhook : deux insertions du même (provider, eventId) -> E11000
  await WebhookEvent.create({ provider: 'STRIPE', externalEventId: 'evt_123', eventType: 'checkout.session.completed' });
  let dupThrew = false;
  try {
    await WebhookEvent.create({ provider: 'STRIPE', externalEventId: 'evt_123', eventType: 'checkout.session.completed' });
  } catch (e) {
    dupThrew = e.code === 11000;
  }
  check('WebhookEvent dupliqué rejeté (E11000)', dupThrew);
  check('même eventId chez un autre provider autorisé', Boolean(await WebhookEvent.create({ provider: 'YOUSIGN', externalEventId: 'evt_123' })));

  // Invoice unique par externalInvoiceId
  await Invoice.create({ contractId: contract._id, externalInvoiceId: 'in_1', environment: 'TEST' });
  let invDup = false;
  try {
    await Invoice.create({ contractId: contract._id, externalInvoiceId: 'in_1', environment: 'TEST' });
  } catch (e) {
    invDup = e.code === 11000;
  }
  check('Invoice dupliquée rejetée (E11000)', invDup);

  await logContractAudit({ contractId: contract._id, action: 'CREATED', actorType: 'DEV' });
  check('audit log écrit', (await ContractAuditLog.countDocuments({ contractId: contract._id })) === 1);

  // --- Création via le service : AUCUN pré-remplissage ---
  // Le nom auto « Contrat <référence> » obligeait le DEV à effacer un texte
  // qu'il n'avait pas écrit, et couplait le front au backend sur cette chaîne.
  {
    const svc = await import('../services/contract.service.js');
    const fresh = await svc.createContract(null, {});
    check('service: contrat créé sans nom', fresh.name === '');
    check('service: référence tout de même attribuée', /^CTR-\d{4}-\d{4}$/.test(fresh.reference));
    check('service: statut DRAFT', fresh.status === S.DRAFT);

    // Le nom reste passable explicitement (et trimé).
    const named = await svc.createContract(null, { name: '  Contrat SB Auto  ' });
    check('service: nom explicite conservé et trimé', named.name === 'Contrat SB Auto');
    // Un nom blanc ne vaut pas un nom : il retombe sur vide, pas sur des espaces.
    const blank = await svc.createContract(null, { name: '   ' });
    check('service: nom blanc -> vide', blank.name === '');
  }

  // --- Pipeline PDF ---
  const { PDFDocument } = await import('pdf-lib');
  const doc = await import('../services/contractDocument.service.js');
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]); // A4 portrait (points)
  pdf.addPage([595, 842]);
  const pdfBytes = Buffer.from(await pdf.save());

  const meta = await doc.validatePdfBuffer(pdfBytes, { filename: 'contrat.pdf' });
  check('validatePdfBuffer -> 2 pages', meta.pageCount === 2);
  check('pageSizes A4 (595x842)', meta.pageSizes[0].width === 595 && meta.pageSizes[0].height === 842);
  check('checksum sha256 (64 hex)', /^[0-9a-f]{64}$/.test(meta.checksum));

  // Rejet d'un non-PDF
  let badMagic = false;
  try {
    await doc.validatePdfBuffer(Buffer.from('PK\x03\x04 not a pdf'), { filename: 'x.pdf' });
  } catch (e) {
    badMagic = e.statusCode === 400;
  }
  check('non-PDF (mauvais magic) rejeté', badMagic);

  // Rejet extension
  let badExt = false;
  try {
    await doc.validatePdfBuffer(pdfBytes, { filename: 'contrat.exe' });
  } catch (e) {
    badExt = e.statusCode === 400;
  }
  check('mauvaise extension rejetée', badExt);

  // Stockage original + signé (séparés)
  const stored = await doc.storeOriginalPdf(contract._id, pdfBytes, { filename: 'contrat.pdf' });
  check('original stocké (nom UUID non devinable)', /^original-[0-9a-f-]{36}\.pdf$/.test(stored.originalFilename));
  contract.document.originalFilename = stored.originalFilename;
  const signed = await doc.storeSignedPdf(contract._id, pdfBytes, { filename: 'signed.pdf' });
  check('signé stocké séparément', signed.signedFilename !== stored.originalFilename && /^signed-/.test(signed.signedFilename));
  contract.document.signedFilename = signed.signedFilename;

  // Résolution de chemin anti-traversal
  check('resolveDocumentPath original OK', doc.resolveDocumentPath(contract, 'original').includes(stored.originalFilename));

  await doc.deleteContractStorage(contract._id); // nettoyage
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
