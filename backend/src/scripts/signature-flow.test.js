/* Test END-TO-END du parcours de SIGNATURE — version PLAN DE CONTRÔLE (R10.5C).
 *
 * ══ CE QUE CE FICHIER ÉPROUVAIT AVANT, ET POURQUOI IL A CHANGÉ ═══════════════
 *
 * Il pilotait un client Yousign LOCAL (stub) et postait lui-même des webhooks
 * signés sur `/api/webhooks/yousign`. Ces deux surfaces n'existent plus : le
 * projet ne détient plus de clé Yousign, et Yousign ne l'appelle plus.
 *
 * Le parcours réel est maintenant :
 *
 *   projet ──capacité──▶ PANEL ──▶ Yousign
 *   Yousign ──webhook──▶ PANEL ──fait durable via le pont──▶ projet
 *
 * Le test suit exactement ce chemin. Le seul élément doublé est le PANEL
 * DISTANT : tout le reste — routes HTTP, service de signature, client de
 * capacités, runtime du pont, applicateur, stockage privé — est le vrai code.
 *
 * ══ POURQUOI LE FAIT EST APPLIQUÉ, ET NON POSTÉ ═════════════════════════════
 *
 * Un webhook local rejouerait une porte d'entrée SUPPRIMÉE : le test serait
 * vert pour un chemin que la production n'a plus. On applique donc le fait tel
 * que le pont le livre, c'est-à-dire par la fonction même qui est inscrite dans
 * les deux registres (`changeAppliers` pour la poussée, `applyHandlers` pour le
 * rattrapage).
 *
 * Couvre : ouverture par capacité, idempotence d'ouverture, attribution des
 * signatures, transitions métier, rejeu, désordre, rattrapage hors ligne,
 * appartenance, refus/relance, documents séparés + empreinte, absence de
 * surface locale, contrôle d'accès. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4138';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

/**
 * LE PANEL, DOUBLÉ — mais APPAIRÉ pour de vrai.
 *
 * L'appairage passe par le runtime réel : sans lui, chaque capacité échouerait
 * et le test ne prouverait que l'absence de Panel. On configure donc la
 * fabrique de client sur le stub, puis on appaire comme le ferait un opérateur.
 *
 * `configureBridgeRuntime` est appelé APRÈS `bootstrap()` : il complète la
 * configuration existante (les applicateurs restent branchés) et n'y substitue
 * que le client distant.
 */
const { createPanelStub } = await import('../services/panelBridge/panelStub.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const panelStub = createPanelStub();
bridgeRuntime.configureBridgeRuntime({ clientFactory: () => panelStub });
await bridgeRuntime.pairWithPanel({
  panelUrl: 'https://panel-stub.test',
  pairingCode: 'PAIR-OK',
  publicBackendUrl: 'https://projet-stub.test',
});

const app = createApp();
const server = app.listen(4138);
const { INTEGRATED_API_CATALOG, fieldKeys, isPanelAuthority } = await import('../utils/integratedApiCatalog.js');
const base = 'http://localhost:4138';

const { applySignatureEvent } = await import('../services/signature/signatureEvent.applier.js');
/** Le lecteur neutre : le bloc `yousign` n'est plus écrit, seulement lisible. */
const { signatureOf } = await import('../services/signature/signatureRecord.js');

/**
 * LE FAIT DE SIGNATURE, TEL QUE LE PONT LE LIVRE.
 *
 * Charge utile identique à celle que compose `dispatchSignatureEvent` côté
 * Panel : verbe métier, référence CONTRAT (et non identifiant Yousign),
 * identifiant de demande, signataire opaque, libellé d'origine du fournisseur.
 * Aucun nom, aucune adresse — le projet les détient déjà.
 */
function fait(event, { contractRef, signatureRequestId, signerId = null, providerEvent = null }) {
  return {
    payload: {
      event,
      contractRef: String(contractRef),
      signatureRequestId,
      signerId,
      providerEvent: providerEvent ?? event,
      occurredAt: new Date().toISOString(),
    },
  };
}

/**
 * L'ENVELOPPE DU PONT — `({ change })`, et pas autrement.
 *
 * Les deux registres appellent les applicateurs avec cette forme. L'appeler
 * ici avec le fait nu passerait à côté du défaut le plus sournois possible :
 * un applicateur qui lit une charge utile absente ne LÈVE PAS, il répond
 * « verbe inconnu » et acquitte. Le pont serait vert, la signature perdue.
 */
function enveloppe(change) {
  return { change };
}

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json, text };
}
async function login(email, password) { return (await api('POST', '/api/auth/login', { body: { email, password } })).json?.data?.token; }
async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]); pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}
async function uploadPdf(token, id) {
  const form = new FormData();
  form.append('file', new Blob([await makePdf()], { type: 'application/pdf' }), 'contrat.pdf');
  return api('POST', `/api/contracts/${id}/document`, { token, form });
}
const ZONES = [
  { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
  { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 2, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
];

const { Contract } = await import('../models/Contract.model.js');
const { Company } = await import('../models/Company.model.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany } = await import('./helpers/clientCompany.helper.js');
const { getSingleton } = await import('../utils/singleton.js');

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

{
  // Signataires contractuels requis à la validation (voir docs/CONTRACT_SIGNERS.md).
  // Le signataire développeur est PUBLIÉ par le Panel : l'écrire dans une
  // fiche locale ne prouverait plus rien, puisque le code ne la lit plus.
  await publishDeveloperIdentity({ signer: { firstName: 'Luca', lastName: 'Duhoux', jobTitle: 'Gérant', email: 'dev@studio.fr' } });
  /**
   * L’ENTREPRISE CLIENTE — exigée depuis le chantier « facturation légale ».
   *
   * Ni paiement ni signature ne s’ouvrent pour un projet sans identité
   * juridique de client. La publier ici n’assouplit rien : elle donne au
   * parcours la donnée qu’il exige désormais, exactement comme le fait
   * L.Y Solution en remplissant la fiche « Clients » avant d’encaisser.
   */
  await publishClientCompany();
  const company = await getSingleton(Company);
  company.signer = { firstName: 'Marc', lastName: 'Sbaï', jobTitle: 'Directeur', email: 'client@sbauto.fr' };
  await company.save();
}

/** Prépare un contrat jusqu'à PENDING_DEV_SIGNATURE. */
async function prepareContract() {
  const created = (await api('POST', '/api/contracts', { token: devToken })).json.data;
  await uploadPdf(devToken, created._id);
  await api('PUT', `/api/contracts/${created._id}/signature-configuration`, { token: devToken, body: { zones: ZONES } });
  await api('POST', `/api/contracts/${created._id}/validate`, { token: devToken });
  return created._id;
}

// ---------------------------------------------------------------------------
section('Aucun credential de signature n’est configurable côté projet');
{
  /**
   * Le premier acte de l'ancien test était de POSER une clé de signature. C'est
   * précisément ce que le cutover interdit : on vérifie que la porte est
   * fermée, pas qu'on sait l'ouvrir.
   *
   * On frappe aux DEUX noms — celui d'hier et celui du domaine — parce que la
   * question n'est pas « ce fournisseur est-il fermé ? » mais « reste-t-il un
   * endroit où déposer une clé de signature ? »
   */
  for (const nom of ['YOUSIGN', 'OPENSIGN', 'SIGNATURE']) {
    // eslint-disable-next-line no-await-in-loop
    const pose = await api('PUT', `/api/integrated-apis/${nom}/modes/TEST`, {
      token: devToken,
      body: { credentials: { apiKey: 'test_apikey_123', webhookSecret: 'whsec' } },
    });
    check(`poser une clé sous ${nom} est refusé`, pose.status >= 400);
  }

  /**
   * R11 — LA LISTE HTTP A DISPARU, LE CATALOGUE RESTE.
   *
   * Ces trois contrôles lisaient `GET /api/integrated-apis`, la route qui
   * alimentait la page d'administration. Elle a été supprimée : Brevo passé
   * sous autorité plateforme, plus aucun des quatre fournisseurs n'était
   * administrable, et une surface d'écriture sans écran est une porte qu'on
   * oublie d'avoir laissée ouverte.
   *
   * Ce que ces contrôles défendaient reste vrai et se lit à la source : le
   * projet SAIT que la signature existe — il en a besoin pour classer
   * l'autorité et router ses capacités — mais il n'a rien à y saisir.
   *
   * L'entrée s'appelait `YOUSIGN`. Elle s'appelle `SIGNATURE` : c'est un
   * DOMAINE, et le fournisseur qui le sert a déjà changé une fois.
   */
  check('SIGNATURE reste au catalogue (le projet sait que ça existe)',
    Boolean(INTEGRATED_API_CATALOG.SIGNATURE));
  check('…sans aucun champ à saisir', fieldKeys('SIGNATURE').length === 0);
  check('…et sous l’autorité de la plateforme', isPanelAuthority('SIGNATURE'));

  const wh = await fetch(base + '/api/webhooks/signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name: 'signer.done' }),
  });
  check('aucun endpoint webhook de signature local (404)', wh.status === 404);
}

// ---------------------------------------------------------------------------
section('Parcours de signature — ouverture par capacité');
let contractId;
let srId;
let devSignerId;
let adminSignerId;
{
  contractId = await prepareContract();
  const c0 = (await api('GET', `/api/contracts/${contractId}`, { token: devToken })).json.data;
  check('validé -> PENDING_DEV_SIGNATURE', c0.status === 'PENDING_DEV_SIGNATURE');
  check('signatureState = NONE avant lancement', c0.signature.signatureState === 'NONE');
  check('PDF verrouillé après validation', c0.signatureConfiguration.locked === true);

  const start = await api('POST', `/api/contracts/${contractId}/start-dev-signature`, { token: devToken });
  if (start.status !== 200) console.error('DEBUG start:', start.status, start.text);
  check('start-dev-signature -> lien DEV', Boolean(start.json.data.signatureLink));
  check('signatureState = REQUESTED', start.json.data.contract.signature.signatureState === 'REQUESTED');
  check('signatureRequestId exposé au DEV', Boolean(start.json.data.contract.signature.signatureRequestId));

  const c = await Contract.findById(contractId);
  const sig = signatureOf(c);
  srId = sig.requestId;
  devSignerId = sig.devSignerId;
  adminSignerId = sig.clientSignerId;
  check('demande créée (documentId + signers)', Boolean(sig.documentId && devSignerId && adminSignerId));
  check('…et elle porte le fournisseur qui l’exécute', sig.provider === 'OPENSIGN');

  /**
   * LE DOCUMENT EST PARTI PAR LA CAPACITÉ, pas par un appel local. On le
   * constate sur ce que le Panel a REÇU : c'est la seule preuve qui ne peut
   * pas être satisfaite par un chemin résiduel.
   */
  const ouverture = panelStub.calls.find((k) => k.payload?.capability === 'signature.request.open')
    ?? panelStub.calls.find((k) => JSON.stringify(k).includes('signature.request.open'));
  check('le Panel a bien reçu une demande d’ouverture', Boolean(ouverture));

  const ouverte = panelStub.signatureRequests.find((r) => r.contractRef === String(contractId));
  check('le document a traversé le pont (octets non nuls)', Boolean(ouverte));
  check('deux signataires déclarés', ouverte?.signers.length === 2);
}

// ---------------------------------------------------------------------------
section('Idempotence de l’ouverture — deux clics, une seule demande');
{
  /**
   * `operationId` est DÉRIVÉ du contrat : deux ouvertures convergent au lieu de
   * solliciter deux fois de vraies personnes. C'est l'invariant le plus cher du
   * lot : un doublon ici, c'est un client qui reçoit deux contrats à signer.
   */
  const avant = panelStub.signatureRequests.length;
  const encore = await api('POST', `/api/contracts/${contractId}/start-dev-signature`, { token: devToken });
  check('un second lancement ne crée pas de seconde demande',
    panelStub.signatureRequests.length === avant);
  const c = await Contract.findById(contractId);
  check('…et le contrat pointe toujours la même demande', signatureOf(c).requestId === srId);
  check('…sans erreur inattendue pour l’appelant', encore.status < 500);
}

// ---------------------------------------------------------------------------
section('Faits projetés — attribution, transitions, documents');
{
  const r1 = await applySignatureEvent(enveloppe(fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: devSignerId, providerEvent: 'signer.done',
  })));
  check('fait DEV appliqué', r1.applied === true);
  check('…attribué au développeur', r1.attributed === 'DEV_SIGNED');

  const afterDev = (await api('GET', `/api/contracts/${contractId}`, { token: devToken })).json.data;
  check('devSignedAt renseigné', Boolean(afterDev.signature.devSignedAt));
  check('contrat -> INACTIVE (dispo ADMIN)', afterDev.status === 'INACTIVE');
  check('signatureState = DEV_SIGNED', afterDev.signature.signatureState === 'DEV_SIGNED');
  check('adminSignedAt encore vide', !afterDev.signature.clientSignedAt);

  // Rejeu du même fait : rien ne bouge, et surtout pas la date.
  const dateDev = afterDev.signature.devSignedAt;
  const rejeu = await applySignatureEvent(enveloppe(fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: devSignerId, providerEvent: 'signer.done',
  })));
  check('rejeu du fait DEV -> non appliqué', rejeu.applied === false);
  const apresRejeu = (await api('GET', `/api/contracts/${contractId}`, { token: devToken })).json.data;
  check('…et la date de signature n’a pas bougé', apresRejeu.signature.devSignedAt === dateDev);

  // ADMIN voit le contrat + obtient son lien par la capacité.
  const mine = await api('GET', '/api/my-contract', { token: adminToken });
  check('ADMIN voit son contrat', mine.json.data?._id === contractId);
  const adminLink = await api('POST', '/api/my-contract/start-signature', { token: adminToken });
  check('lien de signature ADMIN obtenu du Panel', Boolean(adminLink.json.data.signatureLink));

  const r2 = await applySignatureEvent(enveloppe(fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: adminSignerId, providerEvent: 'signer.done',
  })));
  check('fait ADMIN attribué au client', r2.attributed === 'ADMIN_SIGNED');

  /**
   * LE FOURNISSEUR ACHÈVE, PUIS LE FAIT ARRIVE — dans cet ordre.
   *
   * C'est l'ordre réel, et il compte pour une raison précise : la PREUVE
   * D'AUDIT n'est publiée qu'à l'achèvement. Projeter le fait sans que le stub
   * ait achevé la demande ferait demander un certificat qui n'existe pas
   * encore, et le test verrait passer un dossier sans preuve en croyant que
   * c'est normal.
   */
  panelStub.completeSignatureFor(contractId);

  const r3 = await applySignatureEvent(enveloppe(fait('SIGNATURE_COMPLETED', {
    contractRef: contractId, signatureRequestId: srId, providerEvent: 'signature_request.done',
  })));
  check('achèvement appliqué', r3.applied === true && r3.status === 'DONE');

  const signed = (await api('GET', `/api/contracts/${contractId}`, { token: devToken })).json.data;
  check('adminSignedAt renseigné', Boolean(signed.signature.clientSignedAt));
  check('statut de la demande DONE', signed.signature.status === 'DONE');
  check('signatureState = FULLY_SIGNED', signed.signature.signatureState === 'FULLY_SIGNED');
  check('PDF signé récupéré (signedUrl)', Boolean(signed.document.signedUrl) && Boolean(signed.document.signedFetchedAt));

  /* ── LA PREUVE D'AUDIT EST ARCHIVÉE, ET À CÔTÉ DU CONTRAT ───────────── */

  check('certificat d’audit archivé (certificateUrl)',
    Boolean(signed.document.certificateUrl) && Boolean(signed.document.certificateFetchedAt));
  /**
   * DEUX PIÈCES, DEUX ADRESSES. Si les deux pointaient le même fichier, on
   * archiverait deux fois l'engagement et jamais sa preuve — et personne ne le
   * verrait avant d'avoir à produire l'une des deux.
   */
  check('…À CÔTÉ du contrat signé, jamais à sa place',
    signed.document.certificateUrl !== signed.document.signedUrl
    && signed.document.hasSigned === true && signed.document.hasCertificate === true);

  const preuve = await fetch(`${base}/api/contracts/${contractId}/documents/certificate`, {
    headers: { authorization: `Bearer ${devToken}` },
  });
  const octetsPreuve = Buffer.from(await preuve.arrayBuffer());
  check('le certificat se télécharge', preuve.status === 200);
  check('…et c’est bien un document, pas une page vide',
    octetsPreuve.length > 0 && octetsPreuve.subarray(0, 5).toString('latin1') === '%PDF-');
  check('…dont le contenu DIFFÈRE du contrat signé',
    !octetsPreuve.equals(Buffer.from(
      (await (await fetch(`${base}/api/contracts/${contractId}/documents/signed`, {
        headers: { authorization: `Bearer ${devToken}` },
      })).arrayBuffer()),
    )));
  check('…et le nom du fichier ne le fait pas passer pour le contrat',
    /certificat/i.test(String(preuve.headers.get('content-disposition') ?? '')));

  // Rejeu de l'achèvement : déjà complet ET document présent -> rien à faire.
  const r3bis = await applySignatureEvent(enveloppe(fait('SIGNATURE_COMPLETED', {
    contractRef: contractId, signatureRequestId: srId, providerEvent: 'signature_request.done',
  })));
  check('rejeu de l’achèvement -> ALREADY_COMPLETE', r3bis.reason === 'ALREADY_COMPLETE');

  /**
   * DÉSORDRE : un `signer.done` retardé arrivant APRÈS l'achèvement ne doit pas
   * rouvrir le parcours. Sans cette garantie, le client verrait son contrat
   * repasser « en cours de signature » après avoir été informé du contraire.
   */
  const tardif = await applySignatureEvent(enveloppe(fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: srId, signerId: devSignerId, providerEvent: 'signer.done',
  })));
  check('fait retardé après achèvement -> ignoré', tardif.applied === false);
  const toujours = await Contract.findById(contractId);
  check('…l’état n’a pas reculé', signatureOf(toujours).status === 'DONE');
}

// ---------------------------------------------------------------------------
section('Documents — signé et original, séparés et vérifiés');
{
  const dl = await fetch(base + `/api/contracts/${contractId}/documents/signed`, { headers: { Authorization: `Bearer ${devToken}` } });
  const dlBuf = Buffer.from(await dl.arrayBuffer());
  check('download PDF signé -> 200 PDF', dl.status === 200 && dlBuf.subarray(0, 5).toString() === '%PDF-');
  const orig = await fetch(base + `/api/contracts/${contractId}/documents/original`, { headers: { Authorization: `Bearer ${devToken}` } });
  check('PDF original toujours disponible (non écrasé)', orig.status === 200);
  const adminDl = await fetch(base + `/api/contracts/${contractId}/documents/signed`, { headers: { Authorization: `Bearer ${adminToken}` } });
  check('ADMIN peut télécharger le PDF signé de son contrat', adminDl.status === 200);

  const c = await Contract.findById(contractId);
  check('empreinte du PDF signé enregistrée', Boolean(c.document.signedChecksum));

  /**
   * LES DEUX FICHIERS COEXISTENT — la preuve qui compte.
   *
   * L'original ne doit jamais être ÉCRASÉ par le signé : c'est lui qui
   * atteste de ce qui a été soumis à la signature. Comparer les octets ne
   * prouverait rien de stable (deux PDF peuvent coïncider) ; ce qui prouve la
   * séparation, ce sont deux emplacements de stockage distincts.
   */
  check('le PDF signé est rangé À CÔTÉ de l’original, pas à sa place',
    Boolean(c.document.originalFilename) && Boolean(c.document.signedFilename)
    && c.document.originalFilename !== c.document.signedFilename);
}

// ---------------------------------------------------------------------------
section('Appartenance — une ressource étrangère reste invisible');
{
  const ys = await import('../services/signature/signature.service.js');
  /**
   * Le Panel refuse une demande qu'il n'a pas ouverte POUR CE PROJET. Le refus
   * est indistinguable d'un « ça n'existe pas » : dire « existe mais pas à
   * vous » confirmerait l'existence d'un contrat tiers.
   */
  for (const [nom, lecture] of [
    ['statut', () => ys.getSignatureRequestStatus('ys-req-etranger')],
    ['lien signataire', () => ys.getSignerLink('ys-req-etranger', 's-1')],
    ['document signé', () => ys.downloadSignedDocument('ys-req-etranger')],
    ['annulation', () => ys.cancelSignatureRequest('ys-req-etranger')],
  ]) {
    let leve = false;
    try { await lecture(); } catch { leve = true; }
    check(`ressource étrangère refusée (${nom})`, leve);
  }

  /**
   * DÉFENSE EN PROFONDEUR CÔTÉ PROJET : même venant du Panel, un fait qui
   * désigne une AUTRE demande que celle du contrat n'est pas appliqué —
   * l'appliquer écraserait un parcours en cours par celui d'un autre.
   */
  const croise = await applySignatureEvent(enveloppe(fait('SIGNATURE_SIGNER_SIGNED', {
    contractRef: contractId, signatureRequestId: 'ys-req-autre', signerId: devSignerId,
  })));
  check('fait pointant une autre demande -> REQUEST_MISMATCH', croise.reason === 'REQUEST_MISMATCH');

  const inconnu = await applySignatureEvent(enveloppe(fait('SIGNATURE_COMPLETED', {
    contractRef: '60f000000000000000000000', signatureRequestId: srId,
  })));
  check('fait pour un contrat inconnu -> acquitté sans erreur', inconnu.reason === 'CONTRACT_UNKNOWN');

  const horsVocab = await applySignatureEvent(enveloppe(fait('SIGNATURE_TOTALEMENT_INCONNU', {
    contractRef: contractId, signatureRequestId: srId,
  })));
  check('verbe hors vocabulaire -> acquitté, pas deviné', horsVocab.reason === 'EVENT_NOT_HANDLED');
}

// ---------------------------------------------------------------------------
section('Timeline & synchronisation');
{
  const tl = await api('GET', `/api/contracts/${contractId}/timeline`, { token: devToken });
  const actions = (tl.json.data || []).map((e) => e.action);
  check('timeline contient CREATED', actions.includes('CREATED'));
  check('timeline contient VALIDATED_LOCKED', actions.includes('VALIDATED_LOCKED'));
  check('timeline contient DEV_SIGNED', actions.includes('DEV_SIGNED'));
  check('timeline contient ADMIN_SIGNED', actions.includes('ADMIN_SIGNED'));
  check('timeline contient FULLY_SIGNED', actions.includes('FULLY_SIGNED'));
  check('timeline contient SIGNED_PDF_FETCHED', actions.includes('SIGNED_PDF_FETCHED'));
  check('timeline ordonnée + libellée', tl.json.data[0].label === 'Contrat créé');
  const adminTl = await api('GET', '/api/my-contract/timeline', { token: adminToken });
  check('ADMIN accède à la timeline', adminTl.status === 200 && Array.isArray(adminTl.json.data));

  const sync = await api('POST', `/api/contracts/${contractId}/sync`, { token: devToken });
  check('POST /sync -> 200 (lecture par capacité)', sync.status === 200);
}

// ---------------------------------------------------------------------------
section('Rattrapage hors ligne — le fait n’est pas perdu');
{
  /**
   * ══ POURQUOI CE SCÉNARIO EXISTE ═══════════════════════════════════════════
   *
   * C'est la raison d'être de la bascule du webhook. Avant R10.5C, un projet
   * éteint au moment où Yousign appelait perdait le fait : le contrat restait
   * « en cours » pour toujours. Désormais le Panel garde le fait et le projet
   * le TIRE à son retour — à condition que `SIGNATURE_EVENT` soit inscrit dans
   * les DEUX registres, pas seulement celui de la poussée.
   */
  const id2 = await prepareContract();
  await api('POST', `/api/contracts/${id2}/start-dev-signature`, { token: devToken });
  const c = await Contract.findById(id2);

  /**
   * L'ÉCRITURE EST FORMÉE COMME LE CONTRAT L'EXIGE — `entityId` est un UUID.
   *
   * Ni la référence de contrat ni l'identifiant Yousign n'en sont ; les émettre
   * tels quels ferait rejeter la PAGE ENTIÈRE en `BRIDGE_INVALID_PAYLOAD`, et
   * pas seulement cette écriture. Le Panel dérive donc l'identité d'entité
   * (`toBridgeEntityId`), et la référence métier voyage dans la charge utile —
   * c'est elle que l'applicateur lit.
   */
  const { newBridgeId } = await import('../services/panelBridge/bridgeContract.js');
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(`signature:${id2}`).digest('hex');
  const entityId = [
    h.slice(0, 8), h.slice(8, 12), `5${h.slice(13, 16)}`,
    ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');

  // Le projet est « éteint » : le Panel met le fait en file au lieu de le pousser.
  panelStub.enqueuePanelChange({
    writeId: newBridgeId(),
    entityType: 'SIGNATURE_EVENT',
    entityId,
    deleted: false,
    payload: fait('SIGNATURE_SIGNER_SIGNED', {
      contractRef: id2, signatureRequestId: signatureOf(c).requestId,
      signerId: signatureOf(c).devSignerId, providerEvent: 'signer.done',
    }).payload,
    modifiedAt: new Date().toISOString(),
    emitter: 'PANEL',
  });
  check('le Panel a gardé le fait pour plus tard', panelStub.inspect().panelQueueSize > 0);

  const bridge = bridgeRuntime.getPanelBridge();
  const tire = await bridge.pullUpdates();
  check('le projet tire ce qu’il a manqué', tire.applied >= 1);

  const rattrape = await Contract.findById(id2);
  check('le fait manqué a bien été appliqué au retour',
    Boolean(signatureOf(rattrape).devSignedAt) && rattrape.status === 'INACTIVE');
}

// ---------------------------------------------------------------------------
section('Refus -> FAILED -> relance');
{
  const id3 = await prepareContract();
  await api('POST', `/api/contracts/${id3}/start-dev-signature`, { token: devToken });
  const c = await Contract.findById(id3);
  const sr3 = signatureOf(c).requestId;

  const decl = await applySignatureEvent(enveloppe(fait('SIGNATURE_FAILED', {
    contractRef: id3, signatureRequestId: sr3, providerEvent: 'signature_request.declined',
  })));
  check('refus appliqué', decl.applied === true);
  const failed = (await api('GET', `/api/contracts/${id3}`, { token: devToken })).json.data;
  check('contrat -> FAILED après refus', failed.status === 'FAILED');
  check('signatureState = DECLINED', failed.signature.signatureState === 'DECLINED');

  /**
   * LA NUANCE SURVIT AU PONT. Le Panel réduit refus/expiration/annulation à un
   * seul verbe parce que la conséquence est la même, mais le libellé d'origine
   * voyage : c'est lui qui distingue EXPIRED de DECLINED dans le dossier.
   */
  const id4 = await prepareContract();
  await api('POST', `/api/contracts/${id4}/start-dev-signature`, { token: devToken });
  const c4 = await Contract.findById(id4);
  await applySignatureEvent(enveloppe(fait('SIGNATURE_FAILED', {
    contractRef: id4, signatureRequestId: signatureOf(c4).requestId,
    providerEvent: 'signature_request.expired',
  })));
  const expire = await Contract.findById(id4);
  check('une expiration reste une EXPIRATION', signatureOf(expire).status === 'EXPIRED');

  // Rejeu du refus -> pas de seconde progression.
  const declDup = await applySignatureEvent(enveloppe(fait('SIGNATURE_FAILED', {
    contractRef: id3, signatureRequestId: sr3, providerEvent: 'signature_request.declined',
  })));
  check('rejeu du refus -> non appliqué', declDup.applied === false);

  // Le Panel ferme le lien sur un fait terminal : le contrat redevient ouvrable.
  panelStub.closeSignatureFor(id3);

  const restart = await api('POST', `/api/contracts/${id3}/restart-signature`, { token: devToken });
  check('restart-signature -> PENDING_DEV_SIGNATURE', restart.json.data.status === 'PENDING_DEV_SIGNATURE');
  check('bloc de signature réinitialisé', restart.json.data.signature.hasRequest === false && restart.json.data.signature.signatureState === 'NONE');

  const restart2 = await api('POST', `/api/contracts/${id3}/start-dev-signature`, { token: devToken });
  check('nouvelle demande de signature créée après relance', Boolean(restart2.json.data.signatureLink));
  const c3b = await Contract.findById(id3);
  check('…et c’est bien une AUTRE demande', signatureOf(c3b).requestId !== sr3);
}

// ---------------------------------------------------------------------------
section('L’applicateur est branché sur les DEUX registres');
{
  /**
   * Le rattrapage ci-dessus prouve le chemin du TIRAGE. Reste à garantir que la
   * POUSSÉE l'est aussi : un type inscrit dans un seul registre fonctionne tant
   * que le projet est en ligne, puis disparaît en silence — précisément le
   * défaut que la bascule du webhook existe pour éliminer. Une lecture de la
   * source est ici la garde la plus stable : elle survit à tout refactor des
   * accesseurs de registre.
   */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../config/bootstrap.js', import.meta.url)), 'utf8');

  /**
   * ══ LA GARDE A CHANGÉ DE FORME PARCE QUE LE CÂBLAGE A CHANGÉ ══════════════
   *
   * Elle exigeait DEUX inscriptions littérales de `SIGNATURE_EVENT:` — une par
   * registre. C'était la seule preuve possible tant que le bootstrap recopiait
   * la même table d'applicateurs à deux endroits.
   *
   * Il ne la recopie plus : une table UNIQUE alimente les deux registres.
   * Continuer à compter deux occurrences reviendrait à EXIGER le retour de la
   * duplication, c'est-à-dire à exiger le défaut même que cette garde existe
   * pour attraper — un type inscrit d'un seul côté.
   *
   * On vérifie donc la propriété, pas son ancienne empreinte : le type est
   * déclaré une fois, et les DEUX registres reçoivent LA MÊME table. Inscrire
   * un type dans un seul chemin en devient structurellement impossible.
   *
   * La reconnaissance de la table est faite SANS citer son nom : un renommage
   * ne doit pas casser une garde qui porte sur la structure.
   */
  check('SIGNATURE_EVENT déclaré une fois, dans la table d’applicateurs',
    src.split('SIGNATURE_EVENT:').length - 1 === 1);
  const pousse = src.match(/changeAppliers:\s*\{\s*\.\.\.\s*(\w+)/);
  const tirage = src.match(/applyHandlers:\s*\{\s*\.\.\.\s*(\w+)/);
  check('les DEUX registres sont alimentés par la MÊME table (poussée + rattrapage)',
    Boolean(pousse && tirage && pousse[1] === tirage[1]));
  check('changeAppliers présent', /changeAppliers:/.test(src));
  check('applyHandlers présent', /applyHandlers:/.test(src));
}

// ---------------------------------------------------------------------------
section('Contrôle d\'accès (401 / 403 / 404)');
{
  check('401 sans token', (await api('GET', `/api/contracts/${contractId}`)).status === 401);
  check('403 ADMIN sur route DEV', (await api('POST', `/api/contracts/${contractId}/sync`, { token: adminToken })).status === 403);
  check('404 contrat inconnu', (await api('GET', '/api/contracts/60f000000000000000000000', { token: devToken })).status === 404);
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
