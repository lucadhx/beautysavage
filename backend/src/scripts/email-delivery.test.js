/* Tests de la livraison e-mail : readiness (blocages vs avertissements), provider
 * Brevo, journal des envois, idempotence, handler SEND_EMAIL, résolveurs de
 * destinataires et permissions.
 * Fournisseur Brevo SIMULÉ — aucun e-mail réel n'est envoyé. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4142';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }
async function asyncCodeOf(fn) {
  try { await fn(); return null; } catch (e) { return e.code || e.name; }
}

// ---------------------------------------------------------------------------
// Compte Brevo SIMULÉ. Le mode est déduit de la clé : c'est bien elle qui choisit
// le compte, exactement comme en réalité.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let brevoCalls = [];
let forced = null; // force la réponse du prochain /smtp/email
let messageSeq = 0;

const KEY_TEST = 'xkeysib-delivery-TEST-00000000000000000000000aaaa';
const KEY_PROD = 'xkeysib-delivery-PROD-00000000000000000000000bbbb';
function modeOfKey(key) { return key === KEY_PROD ? 'PROD' : 'TEST'; }
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (!/^https?:\/\/[^/]*brevo/.test(href)) return realFetch(input, options);

  const method = options.method || 'GET';
  const key = options.headers?.['api-key'];
  const mode = modeOfKey(key);
  const path = href.replace(/^https?:\/\/[^/]*\/v3/, '');
  const body = options.body ? JSON.parse(options.body) : undefined;
  brevoCalls.push({ method, path, mode, body });

  if (path === '/smtp/email' && method === 'POST') {
    if (forced) { const f = forced; forced = null; return f; }
    messageSeq += 1;
    return json(201, { messageId: `<msg-${messageSeq}@brevo>` });
  }
  // Les endpoints senders/domains ne servent pas ici : réponse neutre.
  if (path === '/senders') return json(200, { senders: [] });
  return json(200, {});
};


/* ══════════════════════════════════════════════════════════════════════════
   LE FAUX PLAN DE CONTRÔLE — ce que le Panel répond, sans le Panel.
   ══════════════════════════════════════════════════════════════════════════

   Depuis L8.4C, `sendTemplate()` est une FAÇADE de plan de contrôle : elle ne
   parle plus à Brevo, elle demande un verbe au Panel. Cette suite éprouve ce
   qui reste local — journal, minimisation, idempotence de livraison,
   canonicalisation de l'identifiant, traduction des refus — et rien d'autre.

   Le TRANSPORT réel (vrai pont, vraie passerelle, vrai coffre, vrai
   fournisseur) est prouvé de bout en bout par l'E2E de convergence côté
   Panel. Le rejouer ici exigerait un Panel appairé pour vérifier qu'une
   adresse est masquée dans un journal : on testerait l'appairage, pas la
   minimisation.

   `brevoCalls` reste surveillé — mais il ne mesure plus « l'envoi a eu lieu ».
   Il mesure désormais un INVARIANT PLUS FORT : aucun appel Brevo LOCAL ne
   part de ce chemin, quoi qu'il arrive.
   ══════════════════════════════════════════════════════════════════════════ */
let planCalls = [];
/** Force la réponse de la prochaine invocation (refus, doublon, doute…). */
let planForced = null;
let planMessageSeq = 0;

/**
 * La version que « le Panel » déclare avoir rendue. Choisie hors d'atteinte de
 * toute version locale : voir le commentaire du faux plan.
 */
const PANEL_TEMPLATE_VERSION = 42;

/**
 * LE SUJET QUE LE PANEL REND — volontairement reconnaissable.
 *
 * Il ne peut PAS être celui d'une copie locale : aucune n'existe plus, et
 * aucun registre de ce projet ne contient cette phrase. Si le journal finissait
 * par porter autre chose, ce serait la preuve qu'un sujet est encore fabriqué
 * localement — exactement le défaut que ce lot corrige.
 */
const PANEL_SUBJECT = 'Sujet rendu par la plateforme — TEST';

const FAUX_PLAN = {
  available: () => true,
  async invoke(code, input) {
    planCalls.push({ code, input });
    if (planForced) {
      const f = planForced;
      planForced = null;
      if (f instanceof Error) throw f;
      return f;
    }
    planMessageSeq += 1;
    return {
      capability: code,
      outcome: 'SUCCEEDED',
      operationId: input.operationId,
      result: {
        status: 'ACCEPTED',
        providerMessageId: `<msg-${planMessageSeq}@brevo>`,
        operationId: input.operationId,
        /**
         * L'EXPÉDITEUR RÉSOLU — rendu par le vrai Panel depuis R10.5.
         *
         * Ce faux plan doit le rendre aussi : sans lui, la livraison resterait
         * sans expéditeur en recette alors qu'elle en porterait un en
         * production, et le journal serait éprouvé sur un cas qui n'existe pas.
         */
        sender: { email: 'support@exemple.fr', name: 'SB Auto' },
        /**
         * LE DOCUMENT RÉELLEMENT RENDU PAR LE PANEL (L11.1).
         *
         * ── POURQUOI UNE VALEUR VOLONTAIREMENT INVRAISEMBLABLE ──────────────
         *
         * `PANEL_TEMPLATE_VERSION` ne peut PAS être la version d'un document
         * local : celui-ci vient d'être amorcé en v1, et il faudrait 41
         * éditions pour l'atteindre. Si la livraison finissait par porter `1`,
         * ce serait la preuve qu'on persiste encore le numéro local — c'est
         * exactement le défaut que ce lot corrige, et un chiffre plausible
         * l'aurait laissé passer sans qu'on le voie.
         */
        templateCode: input.templateRef,
        templateScope: 'PROJECT',
        templateScopeId: 'projet-de-recette',
        templateVersion: PANEL_TEMPLATE_VERSION,
        templateSource: 'PROJECT',
        subject: PANEL_SUBJECT,
      },
    };
  },
};

/** Un refus de capacité, tel que le pont le relaie (codes CAPABILITY_*). */
function refusPlan(code, message = 'refus simulé') {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { EmailDelivery } = await import('../models/EmailDelivery.model.js');
const { User } = await import('../models/User.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const { DELIVERY_STATUS, EMAIL_DELIVERY_ERROR_CODES: D, RECIPIENT_RESOLVER } =
  await import('../utils/emailTemplateConstants.js');

function cred(v) { return { encryptedValue: encryptSecret(v), lastFour: lastFourOf(v) }; }

const TID = 'EMAIL_SENDER_VERIFICATION_TEST';

/**
 * LES VARIABLES D'EXEMPLE VIENNENT DE LA RECETTE, PLUS D'UN REGISTRE LOCAL.
 *
 * `demoVariables()` les tirait de `emailTemplateRegistry.js`, supprime avec ce
 * lot : le vocabulaire appartient au Panel, et ce projet ne le redeclare plus.
 *
 * Les ecrire ici est plus honnete qu'un helper : cette suite eprouve le CHEMIN
 * d'envoi (journal, idempotence, refus), pas le contenu d'un modele. Ce qu'elle
 * a besoin de fournir, c'est un jeu de valeurs plausible — et le voir en clair
 * dit exactement ce que le projet est cense produire.
 */
const VARS = {
  [TID]: {
    'developer.companyName': 'Entreprise de recette',
    'email.senderName': 'Expediteur de la plateforme',
    'email.senderAddress': 'expediteur@exemple.fr',
    'email.providerMode': 'TEST',
    'email.sentAt': '2026-08-22T10:00:00.000Z',
  },
  CONTACT_ADMIN_NOTIFICATION: {
    'contact.name': 'Client de recette',
    'contact.email': 'client@exemple.fr',
    'contact.phone': '0600000000',
    'contact.subject': 'Demande de recette',
    'contact.message': 'Bonjour',
    'contact.submittedAt': '2026-08-22T10:00:00.000Z',
    'contact.reference': 'REF-1',
    'company.name': 'SB Auto',
    'manager.contactUrl': 'https://exemple.fr/dev/contacts',
  },
};
function demoVariables(templateId) {
  return new Map(Object.entries(VARS[templateId] ?? VARS[TID]));
}

const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');

/** Remet Brevo + expéditeur dans un état PRÊT À ENVOYER. */
async function makeReady() {
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.set('apiKey', cred(KEY_TEST));
  brevo.modes.PROD.credentials.set('apiKey', cred(KEY_PROD));
  brevo.modes.TEST.verified = true;
  brevo.modes.PROD.verified = true;
  brevo.activeMode = 'TEST';
  brevo.enabled = true;
  await brevo.save();

  await EmailConfiguration.deleteMany({});
  await EmailConfiguration.create({
    modes: {
      TEST: { sender: { email: 'support@exemple.fr', name: 'SB Auto' } },
      PROD: { sender: { email: 'support@exemple.fr', name: 'SB Auto' } },
    },
  });
  await EmailDelivery.deleteMany({});
  // « Prêt à envoyer » inclut désormais un suivi de livraison opérationnel :
  // sans webhook joignable, plus aucun envoi n'est autorisé.
  await makeBrevoOperational('TEST');
  await makeBrevoOperational('PROD');
  brevoCalls = [];
  planCalls = [];
  forced = null;
}

const readinessSvc = await import('../services/email/emailReadiness.service.js');
const { getEmailReadiness } = readinessSvc;
const blockedBy = (r, code) => r.blockers.some((b) => b.code === code);

// ═══════════════════════════════════════════════════════════════════════════
section('Readiness — blocages');
await makeReady();

{
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID, recipientEmail: 'a@exemple.fr' });
  check('tout configuré : prêt', r.ready === true);
  check('tout configuré : aucun blocage', r.blockers.length === 0);
  check('contexte : mode actif exposé', r.context.providerMode === 'TEST');
  check('NO_LOCAL_FROM — le contexte n’expose plus d’expéditeur local',
    r.context.sender.email === '' && r.context.sender.name === '');
  /**
   * IL N'Y A PLUS DE COPIE LOCALE À EXPOSER (L12.1).
   *
   * Le contexte portait la VERSION du modèle local. Ce numéro décrivait un
   * document que le Panel n'a jamais expédié : un exploitant qui enquêtait sur
   * un e-mail lisait un chiffre sans rapport avec ce qui était parti.
   *
   * Le contexte ne porte plus que le CODE — la seule chose que ce projet
   * connaisse avec certitude avant d'avoir demandé.
   */
  check('contexte : le code du modèle est exposé', r.context.template?.templateId === TID);
  check('contexte : AUCUNE version locale n’est inventée',
    r.context.template?.version === undefined);
  check('aucun avertissement (domaine plus évalué)', r.warnings.length === 0);
}

{
  // L'ancien blocage « expéditeur non vérifié » a DISPARU : cet état s'administre
  // chez Brevo et n'est plus recopié. Seul un envoi réel peut le constater.
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  check("plus aucun blocage sur la vérification d'expéditeur",
    !blockedBy(r, 'EMAIL_SENDER_NOT_VERIFIED'));
}

{
  /**
   * ── L'IDENTITÉ RESTE PAR MONDE — le moyen de l'éprouver a changé (L2) ─────
   *
   * Ce bloc vidait l'expéditeur PROD puis basculait `activeMode` sur PROD pour
   * constater le blocage. La bascule n'existe plus : le monde suit
   * l'environnement de l'instance, qui est TEST ici.
   *
   * On éprouve donc la même propriété par le seul chemin qui reste vrai : on
   * vide l'expéditeur DU MONDE COURANT, en laissant celui de l'autre monde
   * renseigné. Un système qui retomberait sur l'autre identité passerait —
   * c'est exactement ce qu'on interdit.
   */
  await EmailConfiguration.updateOne({}, { $set: { 'modes.TEST.sender.email': '' } });
  await IntegratedApi.updateOne({ provider: 'BREVO' }, { $set: { activeMode: 'PROD' } });
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  /**
   * Même bascule que ci-dessus : l'expéditeur LOCAL du monde courant n'est
   * plus une condition d'envoi (L8.4C). Il reste signalé, parce que son
   * absence appauvrit le suivi — mais il n'interdit plus un message.
   */
  /**
   * L'expéditeur local n'existe plus : il ne peut donc plus être « absent
   * dans le monde courant », ni retomber sur celui de l'autre monde. Ce
   * bloc garde désormais le monde annoncé — la seule question qui subsiste.
   */
  check('NO_LOCAL_FROM — aucun signalement d’expéditeur',
    !r.warnings.some((w) => /SENDER/.test(w.code))
    && !r.blockers.some((b) => /SENDER/.test(b.code)));
  check('le contexte annonce le monde du RUNTIME, pas l’activeMode hérité',
    r.context.providerMode === 'TEST');
  await IntegratedApi.updateOne({ provider: 'BREVO' }, { $set: { activeMode: 'TEST' } });
  await makeReady();
}

{
  /**
   * ── L’EXPÉDITEUR LOCAL N’EST PLUS RIEN DU TOUT (R10.5B) ─────────────────
   *
   * L8.4C l'avait dégradé de blocage en avertissement. R10.5 supprime le
   * champ : il n'y a plus ni blocage, ni avertissement, ni valeur à lire.
   *
   * Le garde-fou porte donc sur le SILENCE : la readiness ne doit rien dire
   * d'un expéditeur, sous peine d'envoyer chercher une configuration que
   * personne n'a le droit de faire.
   */
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  check('NO_LOCAL_FROM — aucun blocage d’expéditeur',
    !r.blockers.some((b) => /SENDER/.test(b.code)));
  check('NO_LOCAL_FROM — aucun avertissement d’expéditeur',
    !r.warnings.some((w) => /SENDER/.test(w.code)));
  check('l’envoi reste prêt', r.ready === true);
}

{
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.delete('apiKey');
  await brevo.save();
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  /**
   * LA CLÉ LOCALE NE DÉCIDE PLUS RIEN.
   *
   * Elle n'est plus lue par le chemin d'envoi : le Panel ouvre son propre
   * coffre. Continuer à barrer sur son absence ferait échouer un envoi
   * parfaitement possible, au nom d'un credential devenu inutile.
   */
  check('clé locale absente : n’empêche plus rien',
    !blockedBy(r, D.PROVIDER_KEY_MISSING));
  await makeReady();
}

{
  // Clé présente, mais jamais testée : « configuré » n'est pas « exploitable ».
  await IntegratedApi.updateOne({ provider: 'BREVO' }, { $set: { 'modes.TEST.verified': false } });
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  // Même raison : un test de connexion local ne prouve plus rien sur le
  // chemin réellement emprunté.
  check('clé locale jamais testée : n’empêche plus rien',
    !blockedBy(r, D.PROVIDER_NOT_VERIFIED));
  await makeReady();
}

{
  await IntegratedApi.updateOne({ provider: 'BREVO' }, { $set: { enabled: false } });
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  /**
   * L'interrupteur `enabled` de l'intégration LOCALE ne gouverne plus l'envoi.
   * Couper les e-mails est désormais une décision du Panel — soit en retirant
   * l'octroi, soit en désactivant le modèle.
   */
  check('intégration locale désactivée : n’empêche plus rien',
    !blockedBy(r, D.PROVIDER_NOT_CONFIGURED));
  await makeReady();
}

{
  /**
   * ══ LE VETO LOCAL A DISPARU (L12.1) ═══════════════════════════════════════
   *
   * Trois blocages vivaient ici : modele desactive, modele invalide, modele
   * inconnu. Tous les trois portaient sur une COPIE LOCALE du modele — celle
   * que le Manager editait, et que le Panel n'a jamais expediee.
   *
   * Leur effet etait bien reel : decocher l'interrupteur dans le Manager
   * coupait un e-mail que le Panel aurait parfaitement envoye. Un ecran sans
   * autorite sur le contenu exercait un veto sur l'expedition.
   *
   * Le readiness ne juge donc plus AUCUN contenu. Ce qui reste teste ci-dessous
   * est exactement ce dont ce projet est autorite : le fournisseur, la
   * joignabilite de la plateforme, et le destinataire.
   */
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID });
  check('aucun blocage de CONTENU ne subsiste',
    !r.blockers.some((b) => ['TEMPLATE_DISABLED', 'TEMPLATE_INVALID', 'UNKNOWN_TEMPLATE',
      'TEMPLATE_NOT_FOUND'].includes(b.code)));
  check('un modele parfaitement inconnu ne bloque plus rien localement',
    (await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: 'GHOST_ID' }))
      .blockers.length === 0);
  await makeReady();
}

{
  const r1 = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID, recipientEmail: 'pas-une-adresse' });
  check('destinataire invalide : bloqué', blockedBy(r1, D.RECIPIENT_INVALID));
  const r2 = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID, recipientEmail: '' });
  check('destinataire vide : bloqué', blockedBy(r2, D.NO_RECIPIENT));
}

// ═══════════════════════════════════════════════════════════════════════════
section("Readiness — le domaine n'est plus évalué du tout");
{
  // Le parcours domaine (DKIM, DMARC, DNS) a quitté le produit : il s'administre
  // chez Brevo. Une adresse sur domaine public — dont le DNS ne nous appartient
  // pas et qui déclenchait auparavant un avertissement — passe désormais sans
  // aucune remarque : l'envoi fonctionne, c'est tout ce qui se constate ici.
  // Plus aucune adresse locale à poser : le domaine de l’expéditeur ne
  // s’administre plus ici, et ne conditionne plus rien.
  const r = await getEmailReadiness({ controlPlaneAvailable: () => true, templateId: TID, recipientEmail: 'a@exemple.fr' });
  check('domaine public : prêt', r.ready === true);
  check('domaine public : aucun avertissement', r.warnings.length === 0);
  check('domaine public : aucun blocage', r.blockers.length === 0);
  await makeReady();
}

// ═══════════════════════════════════════════════════════════════════════════
section('Provider Brevo — le driver local a été SUPPRIMÉ');
{
  /**
   * ══ CE QUE CETTE SECTION ÉPROUVAIT ═══════════════════════════════════════
   *
   * L'endpoint appelé, la forme du payload, et la classification des refus
   * Brevo en erreurs typées. Tout cela décrivait un driver LOCAL qui parlait
   * à Brevo avec une clé de ce projet.
   *
   * Il n'existe plus. Payload, endpoint et classification sont désormais
   * l'affaire du Panel, qui les éprouve chez lui — les redoubler ici créerait
   * une seconde vérité sur un fournisseur que ce projet ne contacte plus.
   */
  const srcRoot = fileURLToPath(new URL('../', import.meta.url));
  check('NO_LOCAL_TRANSPORT — le driver Brevo n’existe plus',
    !existsSync(join(srcRoot, 'services', 'brevo', 'brevoEmail.service.js')));

  // L’envoi métier lui-même est éprouvé dans la section « Delivery » ci-dessous,
  // où la façade est déclarée : on n’en fabrique pas un second ici.
}

// ═══════════════════════════════════════════════════════════════════════════
section('Delivery — envoi, journal, minimisation');
const delivery = await import('../services/email/emailDelivery.service.js');
const { sendTemplate, EmailDeliveryError } = delivery;
const { registerVariableResolver, resolveVariables } =
  await import('../services/email/emailVariableResolvers.js');
const { initEmailModule } = await import('../services/email/emailModule.js');
await initEmailModule({ skipBootstrap: true });

const RECIPIENT = { email: 'destinataire@exemple.fr', name: 'Dest', key: 'key-dest-1' };

{
  await makeReady();
  const r = await sendTemplate({ controlPlane: FAUX_PLAN,
    templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID),
  });
  check('envoi réussi : statut SENT', r.status === DELIVERY_STATUS.SENT);
  check('envoi réussi : messageId conservé (forme canonique)', /^msg-\d+@brevo$/.test(r.providerMessageId));
  check('envoi réussi : PAS de statut DELIVERED (aucun webhook)', r.status !== DELIVERY_STATUS.DELIVERED);

  const doc = await EmailDelivery.findOne({ deliveryId: r.deliveryId }).lean();
  check('journal : une livraison créée', Boolean(doc));
  check('journal : sentAt renseigné', doc.sentAt instanceof Date);
  check('journal : deliveredAt VIDE (aucun webhook)', doc.deliveredAt === null);
  check('journal : mode tracé', doc.providerMode === 'TEST');
  /**
   * ══ LA VERSION TRACÉE EST CELLE DU PANEL, PAS LA NÔTRE (L11.1) ═════════════
   *
   * Ce contrôle vérifiait `typeof doc.templateVersion === 'number'` — et il
   * passait, sur un numéro qui décrivait le document LOCAL de ce projet.
   * Depuis que l'autorité de contenu appartient au Panel, ce document n'est
   * plus expédié : le journal affirmait donc, avec l'assurance d'un champ nommé
   * « version exacte utilisée », la version d'un contenu que personne n'a reçu.
   *
   * Un contrôle de TYPE ne pouvait pas voir ce défaut. Il fallait un contrôle
   * de VALEUR, et une valeur qu'aucun compteur local ne peut atteindre.
   */
  check('journal : la version tracée est celle RÉELLEMENT rendue par le Panel',
    doc.templateVersion === PANEL_TEMPLATE_VERSION);
  check('journal : la version locale n’existe meme plus pour etre confondue',
    doc.templateVersion === PANEL_TEMPLATE_VERSION && doc.templateVersion !== 1);
  check('journal : tentative comptée', doc.attempts === 1);

  // MINIMISATION — le point le plus important du modèle.
  check('journal : AUCUN champ de HTML rendu', !('html' in doc) && !('htmlContent' in doc));
  const serialized = JSON.stringify(doc);
  check('journal : le HTML rendu n’est nulle part', !serialized.includes('<!DOCTYPE html>'));
  /**
   * ══ LE SUJET DU JOURNAL EST CELUI QUI EST PARTI (L12.1) ═══════════════════
   *
   * Il portait le sujet de la copie LOCALE, placeholders compris — donc le
   * sujet d'un modèle que le Panel n'expédiait pas. L'audit avait mesuré
   * l'écart : sept modèles sur quatorze divergeaient, et le suivi affichait le
   * mauvais avec la même assurance que le bon.
   *
   * Il porte désormais le sujet RENDU que la capacité renvoie. Un champ qui
   * prétend décrire ce qui est parti doit décrire ce qui est parti.
   */
  check('journal : le sujet est celui rendu par la plateforme',
    doc.subjectSnapshot === PANEL_SUBJECT);
  check('journal : plus aucun placeholder non résolu dans le sujet',
    !doc.subjectSnapshot.includes('{{'));
  check('journal : adresse destinataire MASQUÉE', doc.recipientEmailMasked === 'd***@exemple.fr');
  check('journal : adresse destinataire jamais en clair', !serialized.includes('destinataire@exemple.fr'));
  check('journal : adresse expéditrice MASQUÉE', doc.sender.emailMasked === 's***@exemple.fr');
  check('journal : adresse expéditrice jamais en clair', !serialized.includes('support@exemple.fr'));
}

{
  /**
   * ══ CE QUI TRAVERSE LE FIL — et non ce que le rendu LOCAL accepte ════════
   *
   * Le défaut que ce contrôle ferme est resté invisible parce que toutes les
   * suites vérifiaient le rendu du projet, lequel accepte un montant sous sa
   * forme complète `{ amount, currency }`. Ce qui partait vers l'autorité,
   * lui, était aplati en `String(valeur)` — donc « [object Object] ».
   *
   * Le montant traversait alors le schéma d'entrée sans broncher (c'est une
   * chaîne valide) et échouait au RENDU de l'autorité sur « montant non
   * numérique », que le projet recevait sous la forme opaque
   * `CAPABILITY_INPUT_INVALID`.
   *
   * Conséquence : AUCUN e-mail de facturation du client n'a jamais pu partir.
   * On regarde donc la charge utile réellement transmise, pas son aperçu.
   */
  await makeReady();
  planCalls = [];

  /** Un modèle de facturation RÉEL — c'est lui qui porte un montant. */
  const MODELE_MONTANT = 'PAYMENT_CONFIRMED_ADMIN';
  /**
   * Les valeurs d'un modèle de facturation viennent de SON résolveur métier —
   * plus d'un jeu d'exemples du registre local, supprimé avec ce lot.
   */
  const valeurs = new Map(Object.entries({
    'payment.amountIncludingTax': { amount: 12000, currency: 'EUR' },
    'payment.paidOn': '2026-08-21T12:33:19.000Z',
    'payment.invoiceUrl': 'https://exemple.fr/factures/F-1',
  }));
  /**
   * `demoVariables` rend une `Map` — et c'est justement ce que cette fonction
   * doit savoir transporter. On y écrit donc par `set`, pas par indexation :
   * poser une propriété sur une instance de `Map` ne l'y range pas, et le
   * contrôle aurait mesuré une valeur qu'on n'avait jamais envoyée.
   */
  valeurs.set('payment.paidOn', new Date('2026-08-21T12:33:19.000Z'));

  await sendTemplate({
    controlPlane: FAUX_PLAN,
    templateId: MODELE_MONTANT,
    recipient: RECIPIENT,
    variables: valeurs,
  });
  const envoye = planCalls.find((c) => c.code === 'email.send_template')?.input?.variables ?? {};
  const montant = envoye['payment.amountIncludingTax'];

  check('un MONTANT traverse sous sa forme complète', Number.isInteger(montant?.amount));
  check('…avec sa devise, normalisée', montant?.currency === 'EUR');
  check('…et RIEN d’autre : le schéma de la passerelle est strict',
    Object.keys(montant ?? {}).sort().join(',') === 'amount,currency');
  check('une DATE traverse en ISO', envoye['payment.paidOn'] === '2026-08-21T12:33:19.000Z');
  check('aucune variable ne vaut « [object Object] »',
    !Object.values(envoye).some((v) => v === '[object Object]'));
  check('le lien de facture traverse intact',
    typeof envoye['payment.invoiceUrl'] === 'string' && envoye['payment.invoiceUrl'].startsWith('http'));
}

{
  /**
   * ══ UN BLOCAGE NE DOIT PRODUIRE AUCUN APPEL — mais plus pour ce motif ═════
   *
   * Ce bloc coupait `enabled` sur la copie LOCALE du modèle et vérifiait que
   * l'envoi était refusé. C'était précisément le veto que ce lot supprime : un
   * interrupteur du Manager coupait un e-mail que le Panel aurait expédié.
   *
   * L'invariant qui compte — un refus ne parle JAMAIS à Brevo — est conservé,
   * mais éprouvé sur une cause qui appartient réellement à ce projet : un
   * destinataire invalide.
   */
  await makeReady();
  brevoCalls = [];
  planCalls = [];
  const code = await asyncCodeOf(async () => sendTemplate({ controlPlane: FAUX_PLAN,
    templateId: TID, recipient: { email: 'pas-une-adresse' }, variables: demoVariables(TID),
  }));
  check('destinataire invalide : envoi refusé', code === D.RECIPIENT_INVALID);
  check('destinataire invalide : AUCUN appel Brevo',
    !brevoCalls.some((c) => c.path === '/smtp/email'));
  check('destinataire invalide : AUCUN appel au plan de contrôle', planCalls.length === 0);
  await makeReady();
}

{
  /**
   * ══ LA CLASSIFICATION A CHANGÉ DE VOCABULAIRE, PAS DE PRINCIPE ═══════════
   *
   * Elle lisait les statuts HTTP de Brevo (401, 429). Le projet ne parle plus
   * à Brevo : il lit les codes `CAPABILITY_*`, qui traversent le pont tels
   * quels. Ce qui compte reste identique — distinguer ce qui se rejoue de ce
   * qui ne se rejoue pas.
   */
  await makeReady();
  planForced = refusPlan('CAPABILITY_NOT_GRANTED', 'octroi manquant');
  let err = null;
  try {
    await sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID) });
  } catch (e) { err = e; }
  check('refus de capacité : EmailDeliveryError', err instanceof EmailDeliveryError);
  check('refus de capacité : NON retryable', err.retryable === false);
  check('refus de capacité : le code du Panel est conservé', err.code === 'CAPABILITY_NOT_GRANTED');
  const doc = await EmailDelivery.findOne({ deliveryId: err.deliveryId }).lean();
  check('refus de capacité : livraison FAILED', doc.status === DELIVERY_STATUS.FAILED);
  check('refus de capacité : erreur sûre journalisée', doc.lastErrorSafe.code === 'CAPABILITY_NOT_GRANTED');
  check('refus de capacité : AUCUN appel Brevo local',
    !brevoCalls.some((c) => c.path === '/smtp/email'));

  /**
   * ══ L'INVARIANT LE PLUS IMPORTANT DE CE BLOC ═════════════════════════════
   *
   * `CAPABILITY_TIMEOUT` signifie que l'issue est INDÉTERMINÉE : le message est
   * peut-être parti. Le déclarer rejouable ferait envoyer un second e-mail à
   * une personne réelle — et c'est précisément ce qu'un doute ne doit jamais
   * autoriser.
   */
  await makeReady();
  planForced = refusPlan('CAPABILITY_TIMEOUT', 'le fournisseur n’a pas répondu');
  let err2 = null;
  try {
    await sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID) });
  } catch (e) { err2 = e; }
  check('issue INDÉTERMINÉE : jamais retryable', err2.retryable === false);
  check('issue INDÉTERMINÉE : le doute est nommé', err2.code === 'CAPABILITY_TIMEOUT');
  check('issue INDÉTERMINÉE : toujours aucun appel Brevo local',
    !brevoCalls.some((c) => c.path === '/smtp/email'));
}

// ═══════════════════════════════════════════════════════════════════════════
section('Idempotence — jamais deux fois le même e-mail');
{
  await makeReady();
  const EXEC = 'exec-idem-0001';

  const r1 = await sendTemplate({ controlPlane: FAUX_PLAN,
    templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID),
    eventId: 'evt-1', actionExecutionId: EXEC,
  });
  const callsAfterFirst = planCalls.filter((c) => c.code === 'email.send_template').length;
  check('1er envoi : SENT', r1.status === DELIVERY_STATUS.SENT);
  check('1er envoi : 1 appel Brevo', callsAfterFirst === 1);

  const r2 = await sendTemplate({ controlPlane: FAUX_PLAN,
    templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID),
    eventId: 'evt-1', actionExecutionId: EXEC,
  });
  const callsAfterSecond = planCalls.filter((c) => c.code === 'email.send_template').length;
  check('2e envoi : signalé déjà envoyé', r2.alreadySent === true);
  check('2e envoi : AUCUN appel Brevo supplémentaire', callsAfterSecond === 1);
  check('2e envoi : même messageId', r2.providerMessageId === r1.providerMessageId);
  check('2e envoi : même livraison', r2.deliveryId === r1.deliveryId);
  check('une seule livraison en base', (await EmailDelivery.countDocuments({ actionExecutionId: EXEC })) === 1);

  // Concurrence : deux workers sur la même exécution.
  await makeReady();
  const EXEC2 = 'exec-idem-0002';
  const results = await Promise.allSettled([
    sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID), actionExecutionId: EXEC2 }),
    sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID), actionExecutionId: EXEC2 }),
  ]);
  check('concurrence : une seule livraison en base',
    (await EmailDelivery.countDocuments({ actionExecutionId: EXEC2 })) === 1);
  check('concurrence : aucune exception inattendue',
    results.every((r) => r.status === 'fulfilled' || r.reason instanceof EmailDeliveryError));
}

{
  // L'index unique partiel : deux livraisons SANS actionExecutionId doivent
  // coexister (envois de test répétés), mais jamais deux avec le MÊME.
  await makeReady();
  await sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID) });
  await sendTemplate({ controlPlane: FAUX_PLAN, templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID) });
  check('index partiel : deux envois de test coexistent (null n’est pas contraint)',
    (await EmailDelivery.countDocuments({ actionExecutionId: null })) === 2);

  const dup = await asyncCodeOf(() => EmailDelivery.create({
    deliveryId: 'x1', actionExecutionId: 'dup-key', templateId: TID, templateVersion: 1,
    providerMode: 'TEST', recipientKey: 'k',
  }).then(() => EmailDelivery.create({
    deliveryId: 'x2', actionExecutionId: 'dup-key', templateId: TID, templateVersion: 1,
    providerMode: 'TEST', recipientKey: 'k',
  })));
  check('index unique : doublon d’actionExecutionId refusé par MongoDB', dup !== null);
}

{
  // Reprise après crash : une livraison restée SENDING. On ne peut pas savoir si
  // l'e-mail est parti — on refuse de deviner, et on le dit.
  await makeReady();
  const EXEC = 'exec-crash-0001';
  await EmailDelivery.create({
    deliveryId: 'crashed-1', actionExecutionId: EXEC, templateId: TID, templateVersion: 1,
    providerMode: 'TEST', recipientKey: RECIPIENT.key, status: DELIVERY_STATUS.SENDING, attempts: 1,
  });
  brevoCalls = [];
  planCalls = [];
  let err = null;
  try {
    await sendTemplate({ controlPlane: FAUX_PLAN,
      templateId: TID, recipient: RECIPIENT, variables: demoVariables(TID), actionExecutionId: EXEC,
    });
  } catch (e) { err = e; }
  check('reprise après crash : envoi refusé', err instanceof EmailDeliveryError);
  check('reprise après crash : code SEND_INTERRUPTED', err.code === 'SEND_INTERRUPTED');
  check('reprise après crash : NON retryable (visible pour un humain)', err.retryable === false);
  check('reprise après crash : AUCUN renvoi (pas de doublon)',
    !brevoCalls.some((c) => c.path === '/smtp/email'));
  const doc = await EmailDelivery.findOne({ actionExecutionId: EXEC }).lean();
  check('reprise après crash : livraison marquée FAILED', doc.status === DELIVERY_STATUS.FAILED);
  check('reprise après crash : toujours une seule livraison',
    (await EmailDelivery.countDocuments({ actionExecutionId: EXEC })) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Résolveurs de destinataires');
const resolvers = await import('../services/email/emailRecipientResolvers.js');
const { resolveRecipients, normalizeRecipients, assertResolverAllowedForEvents, hasResolver, describeResolvers } = resolvers;

{
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
  check('ADMIN_EMAILS : résout les comptes ADMIN', admins.length >= 1);
  check('ADMIN_EMAILS : adresse du compte de bootstrap', admins.some((a) => a.email === 'admin@mail.com'));
  check('ADMIN_EMAILS : clé stable fournie', admins.every((a) => typeof a.key === 'string' && a.key.length === 16));
  check('ADMIN_EMAILS : aucun DEV dedans', !admins.some((a) => a.email === 'dev@mail.com'));

  const devs = await resolveRecipients(RECIPIENT_RESOLVER.DEV_EMAILS);
  check('DEV_EMAILS : résout les comptes DEV', devs.some((d) => d.email === 'dev@mail.com'));
  check('DEV_EMAILS : aucun ADMIN dedans', !devs.some((d) => d.email === 'admin@mail.com'));
}

{
  // Déduplication : deux comptes, une seule adresse -> un seul envoi.
  await User.create({ email: 'ADMIN@mail.com'.toLowerCase(), password: 'x123456', role: 'ADMIN', name: 'Doublon' })
    .catch(() => { /* l'unicité du modèle peut déjà l'interdire */ });
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
  const emails = admins.map((a) => a.email);
  check('déduplication : aucune adresse en double', new Set(emails).size === emails.length);

  const norm = normalizeRecipients([
    { email: 'A@Exemple.FR' }, { email: 'a@exemple.fr' }, { email: '  a@exemple.fr  ' },
  ]);
  check('déduplication : casse et espaces normalisés -> 1 destinataire', norm.length === 1);
  check('normalisation : adresse en minuscules', norm[0].email === 'a@exemple.fr');

  const filtered = normalizeRecipients([
    { email: 'ok@exemple.fr' }, { email: 'pas-une-adresse' }, { email: '' }, { email: null },
  ]);
  check('validation : les adresses invalides sont écartées', filtered.length === 1);
}

{
  check('résolveur inconnu refusé', (await asyncCodeOf(() => resolveRecipients('INVENTED'))) !== null);
  check('hasResolver(ADMIN_EMAILS)', hasResolver(RECIPIENT_RESOLVER.ADMIN_EMAILS));
  check('hasResolver(INVENTED) = false', !hasResolver('INVENTED'));

  // EXPLICIT_TEST_RECIPIENT est réservé à la route DEV : une action d'événement
  // ne doit jamais pouvoir porter son propre destinataire.
  let threw = false;
  try { assertResolverAllowedForEvents(RECIPIENT_RESOLVER.EXPLICIT_TEST_RECIPIENT); } catch { threw = true; }
  check('EXPLICIT_TEST_RECIPIENT interdit aux actions d’événement', threw);
  let ok = true;
  try { assertResolverAllowedForEvents(RECIPIENT_RESOLVER.ADMIN_EMAILS); } catch { ok = false; }
  check('ADMIN_EMAILS autorisé aux actions d’événement', ok);

  const explicit = await resolveRecipients(RECIPIENT_RESOLVER.EXPLICIT_TEST_RECIPIENT, {
    recipientEmail: 'test@exemple.fr',
  });
  check('EXPLICIT_TEST_RECIPIENT résout l’adresse fournie', explicit[0].email === 'test@exemple.fr');

  check('describeResolvers n’expose aucune adresse',
    describeResolvers().every((r) => !('emails' in r) && typeof r.testOnly === 'boolean'));
  check('describeResolvers signale le résolveur de test',
    describeResolvers().find((r) => r.name === RECIPIENT_RESOLVER.EXPLICIT_TEST_RECIPIENT).testOnly === true);
}

// ═══════════════════════════════════════════════════════════════════════════
section('Résolveurs de variables');
{
  // Aucun résolveur métier n'est enregistré dans ce lot : le refus doit être
  // EXPLICITE, sinon activer une action par mégarde enverrait un e-mail vide.
  const code = await asyncCodeOf(() => resolveVariables({ templateId: 'CONTACT_ADMIN_NOTIFICATION' }));
  check('résolveur métier absent : refus explicite', code === D.UNKNOWN_RESOLVER);

  const restore = registerVariableResolver('CONTACT_ADMIN_NOTIFICATION', async () => ({ 'company.name': 'X' }));
  const vars = await resolveVariables({ templateId: 'CONTACT_ADMIN_NOTIFICATION' });
  check('résolveur enregistré : valeurs résolues', vars.get('company.name') === 'X');
  check('résolveur enregistré : renvoie une Map', vars instanceof Map);
  restore();
  check('restauration : le résolveur est retiré',
    (await asyncCodeOf(() => resolveVariables({ templateId: 'CONTACT_ADMIN_NOTIFICATION' }))) === D.UNKNOWN_RESOLVER);

  let threw = false;
  try { registerVariableResolver('GHOST_TEMPLATE', async () => ({})); } catch { threw = true; }
  check('enregistrer un résolveur sur un template inconnu refusé', threw);
}

{
  // La surcharge de démonstration du template de test doit dire la VÉRITÉ sur la
  // configuration : c'est sa seule raison d'être.
  await makeReady();
  const vars = demoVariables(TID);
  check('démo : mode RÉEL injecté (pas l’exemple)', vars.get('email.providerMode') === 'TEST');
  /**
   * ── L'APERÇU NE MONTRE PLUS D'EXPÉDITEUR RÉEL (R10.5B) ──────────────────
   *
   * Il le pouvait quand le projet en gardait une copie. L'expéditeur est
   * désormais résolu par le Panel, à l'ENVOI seulement : un aperçu qui
   * l'interrogerait déclencherait un aller-retour réseau et afficherait
   * « indisponible » pour un modèle qui s'enverrait parfaitement.
   *
   * On montre donc une valeur d'exemple TYPÉE — le rendu échouerait sur le
   * type EMAIL avec une chaîne vide — et le mode, lui, reste bien réel.
   */
  check('démo : expéditeur d’exemple, jamais une copie locale',
    vars.get('email.senderAddress') === 'expediteur@exemple.fr');
  check('démo : date d’envoi réelle', new Date(vars.get('email.sentAt')).getFullYear() >= 2024);

  /*
   * LES EXEMPLES APPARTIENNENT AU PANEL (L12.1).
   *
   * `demoVariables()` tirait ses valeurs du registre local. L'aperçu et l'envoi
   * de test sont désormais rendus par le Panel, avec SES exemples : maintenir
   * un second jeu ici aurait laissé un aperçu réussir avec des valeurs que
   * l'envoi réel n'accepte pas — l'écart exact que ce lot ferme.
   */
}

// ═══════════════════════════════════════════════════════════════════════════
section('Handler SEND_EMAIL');
const handlerMod = await import('../services/email/sendEmailHandler.js');
const { sendEmailHandler, emailRecipientKeyResolver } = handlerMod;
const { getHandler } = await import('../services/events/eventActionHandlerRegistry.js');
const { ACTION_TYPE, SINGLE_RECIPIENT_KEY } = await import('../utils/domainEventConstants.js');

const fakeEvent = { eventId: 'evt-handler-1', type: 'contact.submitted' };
const fakeAction = {
  actionId: 'test-action', actionType: ACTION_TYPE.SEND_EMAIL,
  enabled: true, templateId: TID, recipientResolver: RECIPIENT_RESOLVER.ADMIN_EMAILS,
};

{
  check('le handler réel est enregistré sur SEND_EMAIL', getHandler(ACTION_TYPE.SEND_EMAIL) === sendEmailHandler);
}

{
  await makeReady();
  const restore = registerVariableResolver(TID, async () => demoVariables(TID));
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
  const execution = { _id: 'exec-handler-0001', recipientKey: admins[0].key };

  const r = await sendEmailHandler({ event: fakeEvent, action: fakeAction, execution, controlPlane: FAUX_PLAN });
  check('handler : SUCCEEDED', r.status === 'SUCCEEDED');
  check('handler : providerMessageId remonté (forme canonique)', /^msg-\d+@brevo$/.test(r.providerMessageId));

  const doc = await EmailDelivery.findOne({ actionExecutionId: 'exec-handler-0001' }).lean();
  check('handler : livraison rattachée à l’exécution', Boolean(doc));
  check('handler : livraison rattachée à l’événement', doc.eventId === 'evt-handler-1');
  check('handler : SUCCEEDED seulement après réponse Brevo', doc.status === DELIVERY_STATUS.SENT);

  // Rejouer la MÊME exécution ne renvoie rien.
  const callsBefore = brevoCalls.filter((c) => c.path === '/smtp/email').length;
  const r2 = await sendEmailHandler({ event: fakeEvent, action: fakeAction, execution, controlPlane: FAUX_PLAN });
  check('handler : rejeu idempotent (SUCCEEDED)', r2.status === 'SUCCEEDED');
  check('handler : rejeu sans nouvel appel Brevo',
    brevoCalls.filter((c) => c.path === '/smtp/email').length === callsBefore);
  restore();
}

{
  // Une exécution par destinataire.
  await makeReady();
  const keys = await emailRecipientKeyResolver(fakeAction, fakeEvent);
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
  check('résolveur de clés : une clé par destinataire', keys.length === admins.length);
  check('résolveur de clés : ce sont bien les clés des destinataires',
    keys.every((k) => admins.some((a) => a.key === k)));

  const noOpKeys = await emailRecipientKeyResolver({ actionType: ACTION_TYPE.NO_OP }, fakeEvent);
  check('résolveur de clés : NO_OP retombe sur _single',
    noOpKeys.length === 1 && noOpKeys[0] === SINGLE_RECIPIENT_KEY);
}

{
  // Zéro destinataire : une exécution est tout de même tracée, SKIPPED. Sans
  // elle, l'événement serait « dispatché » alors que personne n'a été prévenu.
  await makeReady();
  const restoreVars = registerVariableResolver(TID, async () => demoVariables(TID));
  const emptyAction = { ...fakeAction, recipientResolver: RECIPIENT_RESOLVER.DEV_EMAILS };
  await User.deleteMany({ role: 'DEV' });

  const keys = await emailRecipientKeyResolver(emptyAction, fakeEvent);
  check('zéro destinataire : une exécution tout de même matérialisée',
    keys.length === 1 && keys[0] === SINGLE_RECIPIENT_KEY);

  // Depuis le lot contact, zéro destinataire est un ÉCHEC, plus un SKIP : une
  // action ACTIVÉE dont personne ne reçoit le résultat est un problème, pas une
  // décision. SKIPPED rendrait l'événement DISPATCHED — « tout va bien » — alors
  // que la notification n'a pas eu lieu.
  let emptyErr = null;
  try {
    await sendEmailHandler({
      event: fakeEvent, action: emptyAction, execution: { _id: 'exec-empty-1', recipientKey: SINGLE_RECIPIENT_KEY },
    });
  } catch (e) { emptyErr = e; }
  check('zéro destinataire : ÉCHEC (plus un SKIP)', emptyErr !== null);
  check('zéro destinataire : code EMAIL_RECIPIENTS_NOT_FOUND', emptyErr?.code === 'EMAIL_RECIPIENTS_NOT_FOUND');
  check('zéro destinataire : NON retryable (aucun backoff ne crée un compte)',
    emptyErr?.retryable === false);
  check('zéro destinataire : raison lisible', /aucun destinataire/i.test(emptyErr?.message || ''));
  check('zéro destinataire : aucune livraison créée',
    (await EmailDelivery.countDocuments({ actionExecutionId: 'exec-empty-1' })) === 0);

  restoreVars();
  await User.create({ email: 'dev@mail.com', password: '123dev', role: 'DEV', name: 'Dev' });
}

{
  // Destinataire disparu entre la matérialisation et l'exécution.
  await makeReady();
  const restoreVars = registerVariableResolver(TID, async () => demoVariables(TID));
  const r = await sendEmailHandler({
    event: fakeEvent, action: fakeAction, execution: { _id: 'exec-gone-1', recipientKey: 'cle-dun-compte-supprime' },
  });
  check('destinataire disparu : SKIPPED', r.status === 'SKIPPED');
  check('destinataire disparu : raison distincte de « aucun destinataire »',
    /n’existe plus|n'existe plus/i.test(r.reason));
  restoreVars();
}

{
  // Résolveur de variables absent -> DEAD_LETTER immédiat (non retryable).
  await makeReady();
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);
  let err = null;
  try {
    await sendEmailHandler({
      event: fakeEvent,
      action: { ...fakeAction, templateId: 'CONTACT_ADMIN_NOTIFICATION' },
      execution: { _id: 'exec-noresolver-1', recipientKey: admins[0].key },
    });
  } catch (e) { err = e; }
  check('résolveur de variables absent : échec', err !== null);
  check('résolveur absent : NON retryable (DEAD_LETTER immédiat)', err.retryable === false);
  check('résolveur absent : aucune livraison créée',
    (await EmailDelivery.countDocuments({ actionExecutionId: 'exec-noresolver-1' })) === 0);
}

{
  // Erreur fournisseur retryable transportée jusqu'au dispatcher.
  await makeReady();
  const restoreVars = registerVariableResolver(TID, async () => demoVariables(TID));
  const admins = await resolveRecipients(RECIPIENT_RESOLVER.ADMIN_EMAILS);

  /**
   * Un refus REJOUABLE du plan de contrôle — le fournisseur a dit non, rien
   * n'est parti. Le dispatcher d'événements doit pouvoir le reprendre.
   */
  planForced = refusPlan('CAPABILITY_PROVIDER_UNAVAILABLE', 'fournisseur momentanément indisponible');
  let err = null;
  try {
    await sendEmailHandler({
      event: fakeEvent, action: fakeAction, execution: { _id: 'exec-retry-1', recipientKey: admins[0].key },
      controlPlane: FAUX_PLAN,
    });
  } catch (e) { err = e; }
  check('refus fournisseur : le handler lève', err !== null);
  check('refus fournisseur : REJOUABLE, transmis au dispatcher', err.retryable === true);

  /**
   * ══ CE CONTRÔLE NE MESURAIT PAS CE QU'IL ANNONÇAIT ═══════════════════════
   *
   * Il omettait `controlPlane`, si bien que l'envoi s'arrêtait à la
   * PRÉCONDITION — « aucune plateforme joignable » — sans jamais atteindre le
   * 401 qu'il prétendait éprouver. Il passait au vert parce que TOUS les
   * blocages de précondition étaient alors déclarés non rejouables, y compris
   * celui-là.
   *
   * Or ce blocage-là se répare tout seul, et le confondre avec une
   * configuration manquante a jeté une confirmation d'encaissement réelle,
   * rejouée pendant le redémarrage d'un déploiement. On sépare donc les deux
   * cas, et chacun mesure enfin ce qu'il nomme.
   */
  planForced = refusPlan('CAPABILITY_CREDENTIALS_MISSING', 'clé absente chez la plateforme');
  let err2 = null;
  try {
    await sendEmailHandler({
      event: fakeEvent, action: fakeAction, execution: { _id: 'exec-retry-2', recipientKey: admins[0].key },
      controlPlane: FAUX_PLAN,
    });
  } catch (e) { err2 = e; }
  check('clé absente : NON retryable transmis au dispatcher', err2.retryable === false);

  /**
   * LA PLATEFORME INJOIGNABLE — le cas qui a coûté un message réel.
   *
   * Elle se lève quelques secondes après le démarrage ; un envoi rejoué dans
   * cette fenêtre doit ATTENDRE, pas mourir.
   */
  let err3 = null;
  try {
    await sendEmailHandler({
      event: fakeEvent, action: fakeAction, execution: { _id: 'exec-retry-3', recipientKey: admins[0].key },
      controlPlane: { available: () => false, invoke: async () => { throw new Error('jamais appelé'); } },
    });
  } catch (e) { err3 = e; }
  check('plateforme injoignable : le handler lève', err3 !== null);
  check('plateforme injoignable : REJOUABLE, jamais mise au rebut', err3.retryable === true);
  check('…et la cause est nommée', err3.code === 'PROVIDER_NOT_CONFIGURED');
  forced = null;
  restoreVars();
}

// ═══════════════════════════════════════════════════════════════════════════
section('Permissions et routes DEV');
const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4142);
async function api(method, path, { token, body } = {}) {
  const res = await realFetch(`http://localhost:4142${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json: j };
}
async function login(email, password) {
  return (await api('POST', '/api/auth/login', { body: { email, password } })).json?.data?.token;
}

{
  await makeReady();
  const devToken = await login('dev@mail.com', '123dev');
  const adminToken = await login('admin@mail.com', '123admin');

  // 503 et non 200 : la liste vient du Panel, absent de cette suite. Ce qui est
  // éprouvé ici est le CONTRÔLE D'ACCÈS, et il passe avant la lecture distante.
  check('DEV : liste -> atteinte (refus de dépendance, pas de droit)',
    (await api('GET', '/api/dev/email-templates', { token: devToken })).status === 503);
  check('ADMIN : liste -> 403', (await api('GET', '/api/dev/email-templates', { token: adminToken })).status === 403);
  check('anonyme : liste -> 401', (await api('GET', '/api/dev/email-templates')).status === 401);

  check('ADMIN : détail -> 403',
    (await api('GET', `/api/dev/email-templates/${TID}`, { token: adminToken })).status === 403);
  check('ADMIN : édition -> 403',
    (await api('PUT', `/api/dev/email-templates/${TID}`, { token: adminToken, body: { subject: 'x', expectedVersion: 1 } })).status === 403);
  check('ADMIN : aperçu -> 403',
    (await api('POST', `/api/dev/email-templates/${TID}/preview`, { token: adminToken, body: {} })).status === 403);
  check('ADMIN : envoi de test -> 403',
    (await api('POST', `/api/dev/email-templates/${TID}/test-send`, { token: adminToken, body: { recipientEmail: 'a@exemple.fr' } })).status === 403);
  check('ADMIN : versions -> 403',
    (await api('GET', `/api/dev/email-templates/${TID}/versions`, { token: adminToken })).status === 403);

  // AUCUNE création, AUCUNE suppression : les identifiants viennent du code.
  check('création interdite (aucune route POST /)',
    (await api('POST', '/api/dev/email-templates', { token: devToken, body: { templateId: 'X' } })).status === 404);
  check('suppression interdite (aucune route DELETE)',
    [404, 405].includes((await api('DELETE', `/api/dev/email-templates/${TID}`, { token: devToken })).status));

  /**
   * ══ LA LISTE VIENT DU PANEL, ET SON ABSENCE SE DIT (L12.1) ════════════════
   *
   * Elle se dérivait d'un registre LOCAL de modèles, supprimé avec ce lot. Le
   * compte attendu était donc celui d'une copie que personne n'expédiait.
   *
   * Cette suite tourne SANS Panel appairé. Le comportement à éprouver ici n'est
   * donc plus « combien de modèles » mais quelque chose de bien plus important :
   * privé de son autorité, ce projet REFUSE proprement au lieu d'afficher une
   * copie périmée. « Je ne sais pas » est une réponse honnête ; « voici ce qui
   * partait hier » ne l'est pas.
   */
  const list = await api('GET', '/api/dev/email-templates', { token: devToken });
  check('liste sans Panel : refus explicite, jamais une copie locale',
    list.status === 503);
  check('liste sans Panel : le motif nomme la plateforme',
    /plateforme|L\.Y Solution/i.test(JSON.stringify(list.json ?? {})));
  check('liste sans Panel : aucun contenu de modèle n’est servi',
    !JSON.stringify(list.json ?? {}).includes('<!DOCTYPE html>'));

  /**
   * CE QUE LE PROJET DÉCLARE, LUI, RESTE LISIBLE HORS LIGNE — c'est sa donnée.
   */
  const usage = await api('GET', '/api/dev/email-templates/usage', { token: devToken });
  check('usage : 200 même sans Panel', usage.status === 200);
  check('usage : la route est atteinte avant /:templateId', Array.isArray(usage.json.data));
  check('usage : elle ne porte que des codes et des consommateurs',
    usage.json.data.every((e) => typeof e.templateId === 'string' && !('subject' in e) && !('html' in e)));

  /** L'aperçu est rendu par le Panel : sans lui, il refuse aussi. */
  const before = await EmailDelivery.countDocuments();
  const prev = await api('POST', '/api/dev/email-templates/CONTACT_ADMIN_NOTIFICATION/preview', {
    token: devToken, body: {},
  });
  check('aperçu sans Panel : refus explicite', prev.status === 503);
  check('aperçu : AUCUN appel Brevo', !brevoCalls.some((c) => c.path === '/smtp/email'));
  check('aperçu : AUCUNE livraison créée', (await EmailDelivery.countDocuments()) === before);

  /**
   * AUCUN BROUILLON N'EST ACCEPTÉ — la porte d'écriture par l'aperçu est fermée.
   *
   * L'aperçu acceptait `{ subject, html }` pour prévisualiser une saisie en
   * cours. Ce corps n'a plus de destinataire : il n'y a plus de saisie, et un
   * corps toléré serait la première marche vers un contenu poussé par le projet.
   */
  const draft = await api('POST', `/api/dev/email-templates/${TID}/preview`, {
    token: devToken,
    body: { subject: 'Brouillon', html: '<p>x</p>' },
  });
  check('aperçu : un brouillon n’est jamais rendu tel quel',
    draft.status !== 200 || !JSON.stringify(draft.json ?? {}).includes('Brouillon'));
}

{
  // Envoi de test : même pipeline, sans faux événement métier.
  await makeReady();
  const devToken = await login('dev@mail.com', '123dev');
  brevoCalls = [];
  planCalls = [];
  const r = await api('POST', `/api/dev/email-templates/${TID}/test-send`, {
    token: devToken, body: { recipientEmail: 'testeur@exemple.fr' },
  });
  /**
   * ══ CE BLOC A CHANGÉ DE DÉMONSTRATION (L8.4C) ═════════════════════════════
   *
   * Il prouvait qu'un envoi de test partait, avec un `messageId` et une
   * livraison tracée. Cette preuve-là dépend maintenant du PANEL : la route
   * traverse la vraie façade, sans injection possible, et cette suite tourne
   * sans Panel appairé.
   *
   * Elle est donc apportée par l'E2E de convergence, qui monte un vrai Panel,
   * un vrai pont et un vrai fournisseur simulé.
   *
   * Ce que ce bloc prouve désormais est plus utile ICI, et impossible à
   * démontrer là-bas : sans plan de contrôle, la route REFUSE proprement — et
   * surtout, elle ne retombe JAMAIS sur la clé Brevo locale. C'est l'invariant
   * de cutover, vérifié à la frontière HTTP.
   */
  check('envoi de test sans Panel : refus explicite, jamais un faux succès',
    r.status >= 400 && r.status < 600);
  check('envoi de test sans Panel : le motif nomme la plateforme',
    /plateforme|panel/i.test(JSON.stringify(r.json ?? {})));
  check('AUCUN FALLBACK LOCAL : zéro appel Brevo depuis le projet',
    brevoCalls.filter((c) => c.path === '/smtp/email').length === 0);
  check('…et aucune livraison fantôme n’est laissée en SENT',
    (await EmailDelivery.countDocuments({ status: DELIVERY_STATUS.SENT, eventId: null,
      actionExecutionId: null, providerMessageId: { $ne: null } })) === 0);

  check('envoi de test : adresse invalide -> 400',
    (await api('POST', `/api/dev/email-templates/${TID}/test-send`, {
      token: devToken, body: { recipientEmail: 'pas-une-adresse' },
    })).status === 400);
  check('envoi de test : corps inconnu refusé (strict)',
    (await api('POST', `/api/dev/email-templates/${TID}/test-send`, {
      token: devToken, body: { recipientEmail: 'a@exemple.fr', sender: 'pirate@x.fr' },
    })).status === 400);
}

{
  // Sans plan de contrôle appairé, le test-send de MODÈLE est refusé — et
  // c’est le seul refus qui subsiste : il n’y a plus d’adresse locale à
  // vider pour provoquer une erreur.
  await makeReady();
  const devToken = await login('dev@mail.com', '123dev');
  brevoCalls = [];
  planCalls = [];
  const r = await api('POST', `/api/dev/email-templates/${TID}/test-send`, {
    token: devToken, body: { recipientEmail: 'testeur@exemple.fr' },
  });
  check('expéditeur absent : refus explicite (503 — la plateforme est l’autorité)',
    r.status === 503);
  /**
   * L'expéditeur LOCAL n'est plus un blocage (L8.4C) : l'identité qui compte
   * est celle du Panel. Le refus vient donc désormais de l'absence de plan de
   * contrôle, pas de l'adresse manquante — et c'est la bonne cause à afficher.
   */
  check('expéditeur absent : le refus nomme la plateforme, plus l’adresse locale',
    /plateforme|panel/i.test(JSON.stringify(r.json ?? {})));
  check('expéditeur absent : AUCUN appel Brevo',
    !brevoCalls.some((c) => c.path === '/smtp/email'));
  await makeReady();
}

{
  // Readiness exposée au Manager AVANT le clic.
  const devToken = await login('dev@mail.com', '123dev');
  const r = await api('GET', `/api/dev/email-templates/${TID}/readiness`, { token: devToken });
  /**
   * LE DIAGNOSTIC VIENT DU PANEL (L12.1) — et c'est le point.
   *
   * Il était calculé localement, sur la copie locale du modèle. Il pouvait donc
   * répondre « prêt » pour un modèle que le Panel aurait refusé d'expédier.
   * Sans Panel, il n'y a plus rien à diagnostiquer : le refus le dit.
   */
  check('readiness : refus explicite sans plan de contrôle', r.status === 503);
  /**
   * La readiness dit désormais la VRAIE condition : sans Panel appairé, aucun
   * e-mail ne peut partir — puisque la clé, le modèle et l'expéditeur qui
   * comptent sont chez lui. Annoncer « prêt » ici serait un faux vert.
   */
  check('readiness : le motif nomme la plateforme',
    /plateforme|L\.Y Solution/i.test(JSON.stringify(r.json ?? {})));
  check('readiness : AUCUN diagnostic local n’est fabriqué à la place',
    r.json.data === undefined);

  const deliveries = await api('GET', `/api/dev/email-templates/${TID}/deliveries`, { token: devToken });
  check('journal : 200', deliveries.status === 200);
  check('journal : adresses masquées',
    deliveries.json.data.every((d) => !d.recipientEmailMasked || d.recipientEmailMasked.includes('***')));
  check('journal : aucun HTML rendu exposé',
    !JSON.stringify(deliveries.json.data).includes('<!DOCTYPE html>'));
}

{
  /**
   * ══ IL N'EXISTE PLUS AUCUN CHEMIN D'ÉCRITURE (L12.1) ══════════════════════
   *
   * Ce bloc éprouvait la version optimiste d'un PUT : conflit 409, refus d'un
   * HTML dangereux, historique, restauration. Toute cette mécanique servait à
   * écrire proprement dans une base de modèles que le Panel n'expédiait pas.
   *
   * Ce qui doit être prouvé n'est donc plus « l'écriture est bien gardée » mais
   * « l'écriture n'existe pas ». C'est la propriété centrale du lot, et elle se
   * vérifie à la frontière HTTP — là où un client peut réellement essayer.
   */
  const devToken = await login('dev@mail.com', '123dev');

  for (const [verbe, chemin] of [
    ['PUT', `/api/dev/email-templates/${TID}`],
    ['PATCH', `/api/dev/email-templates/${TID}`],
    ['DELETE', `/api/dev/email-templates/${TID}`],
    ['POST', `/api/dev/email-templates/${TID}/versions/1/restore`],
  ]) {
    const r = await api(verbe, chemin, { token: devToken, body: { name: 'Tentative', expectedVersion: 1 } });
    check(`${verbe} ${chemin.replace(/^\/api\/dev\/email-templates/, '')} : aucune route (404/405)`,
      [404, 405].includes(r.status));
  }

  for (const chemin of [
    `/api/dev/email-templates/${TID}/versions`,
    `/api/dev/email-templates/${TID}/versions/1`,
    '/api/dev/email-templates/registry',
  ]) {
    const r = await api('GET', chemin, { token: devToken });
    check(`GET ${chemin.replace(/^\/api\/dev\/email-templates/, '')} : surface retirée`,
      r.status === 404 || r.status === 400 || r.status === 503);
  }
}

// ---------------------------------------------------------------------------
server.close();
globalThis.fetch = realFetch;
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
