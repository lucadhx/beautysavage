/**
 * L10.6 FINAL — LA SUSPENSION MANUELLE EST UNE CAUSE, PAS UNE AUTORITÉ.
 *
 * ══ CE QUE CES CONTRÔLES VERROUILLENT ══════════════════════════════════════
 *
 *   · qu'une reprise manuelle RETIRE UNE CAUSE et ne rouvre jamais un site
 *     maintenu fermé par une autre — impayé, contrat, ou les deux ;
 *   · qu'aucun chemin n'écrive `status = ACTIVE` à la main ;
 *   · qu'un motif absent reste ABSENT en base et s'affiche « Aucun » ;
 *   · que la case « notifier » soit respectée dans les deux sens ;
 *   · qu'une panne de Brevo ne défasse JAMAIS une suspension ;
 *   · que huit clics ne produisent qu'UNE transition, donc UNE annonce ;
 *   · que l'acte laisse une preuve durable — qui, quand, motif, intention.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = process.env.DB_TEST || 'sbauto_manual_suspension';
process.env.DB_PROD = process.env.DB_PROD || 'sbauto_manual_suspension';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-manual-suspension-0123456789abcdef';
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY
  || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0; let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { Contract } = await import('../models/Contract.model.js');
const { User } = await import('../models/User.model.js');
const { ContractAuditLog } = await import('../models/ContractAuditLog.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { CONTRACT_AUDIT_ACTION } = await import('../utils/contractConstants.js');
const {
  reconcileSiteStatus, setTechnicalSuspension, setContractProtection,
} = await import('../services/siteEnforcement.service.js');
const notice = await import('../services/siteSuspensionNotice.service.js');
const { applyPaymentDefaultCause } = await import(
  '../services/billing/paymentDefaultCause.applier.js'
);

const DEV = { _id: null, email: 'dev@test.local', role: 'DEV' };

/** Remet toutes les causes à zéro : site accessible, aucune cause. */
async function siteNeuf() {
  await Contract.deleteMany({});
  const site = await getSingleton(SiteStatus);
  site.technicalSuspension = {
    active: false, reason: '', suspendedAt: null, suspendedBy: '',
    notifyAdminsRequested: false, liftedAt: null, liftedBy: '',
  };
  site.contractProtectionEnabled = false;
  site.paymentDefault = {
    active: false, reason: '', since: null, paymentDefaultId: null, amountDueCents: 0,
  };
  await site.save();
  return reconcileSiteStatus({ actor: DEV });
}

/** Pose ou retire la cause « défaut de paiement », comme le Panel le ferait. */
const poserImpaye = (active) => applyPaymentDefaultCause({
  change: {
    entityType: 'PAYMENT_DEFAULT_CAUSE',
    entityId: 'pd-manual',
    deleted: false,
    payload: {
      paymentDefaultId: 'pd-manual', active, reason: 'Défaut de paiement',
      since: '2026-08-08T10:00:00.000Z', amountDueCents: 24_900,
    },
  },
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('R. Suspension manuelle simple — la cause est posée, le site ferme');
{
  await siteNeuf();
  const { site, transitioned } = await setTechnicalSuspension({
    active: true, reason: 'Maintenance planifiée', actorEmail: DEV.email, actor: DEV,
  });

  check('le site est suspendu', site.status === 'SUSPENDED');
  check('…par la cause manuelle', site.causes.technical === true);
  check('…qui prime à l’affichage', site.suspensionSource === 'TECHNICAL');
  check('la transition est signalée UNE fois', transitioned === true);
  check('aucune autre cause n’a été inventée',
    site.causes.contract === false && site.causes.paymentDefault === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('S. Motif renseigné — persisté tel quel, et affiché tel quel');
{
  const site = await getSingleton(SiteStatus);
  check('le motif est en base', site.technicalSuspension.reason === 'Maintenance planifiée');
  check('…l’auteur aussi', site.technicalSuspension.suspendedBy === DEV.email);
  check('…et la date', site.technicalSuspension.suspendedAt instanceof Date);
  check('le motif dérivé suit', site.reason === 'Maintenance planifiée');

  check('le rendu ne le remplace pas',
    notice.motifPourAffichage('Maintenance planifiée') === 'Maintenance planifiée');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('T. Motif absent — vide en base, « Aucun » à l’affichage');
{
  await siteNeuf();
  await setTechnicalSuspension({ active: true, reason: '', actorEmail: DEV.email, actor: DEV });

  const site = await getSingleton(SiteStatus);
  /**
   * ══ LA CHAÎNE « Aucun » N'EST JAMAIS PERSISTÉE ═══════════════════════════
   *
   * Ce serait inscrire une phrase d'affichage dans une donnée métier : la base
   * dirait qu'un motif « Aucun » a été saisi, ce qui est faux. Le jour où
   * l'écran se traduit, ou bien la base ment, ou bien il faut la migrer.
   */
  check('LA BASE NE CONTIENT PAS « Aucun »', site.technicalSuspension.reason === '');
  check('…ni le motif dérivé', site.reason !== 'Aucun');

  check('le RENDU, lui, affiche « Aucun »', notice.motifPourAffichage('') === 'Aucun');
  check('…y compris pour null', notice.motifPourAffichage(null) === 'Aucun');
  check('…et pour des espaces seuls', notice.motifPourAffichage('   ') === 'Aucun');
  check('la constante est exportée, pas recopiée', notice.AUCUN_MOTIF === 'Aucun');

  /** Un motif d'espaces n'est pas un motif : il est nettoyé à l'entrée. */
  await siteNeuf();
  await setTechnicalSuspension({ active: true, reason: '   ', actorEmail: DEV.email, actor: DEV });
  const espaces = await getSingleton(SiteStatus);
  check('un motif d’espaces est stocké VIDE', espaces.technicalSuspension.reason === '');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('U+V. La case « notifier » est respectée dans les DEUX sens');
{
  await siteNeuf();
  const decoche = await setTechnicalSuspension({
    active: true, reason: 'Sans annonce', actorEmail: DEV.email, actor: DEV,
  });
  check('U · case DÉCOCHÉE (défaut) → aucune annonce à faire', decoche.notice === null);
  check('…et l’intention est persistée à faux',
    (await getSingleton(SiteStatus)).technicalSuspension.notifyAdminsRequested === false);

  await siteNeuf();
  const cochee = await setTechnicalSuspension({
    active: true, reason: 'Avec annonce', actorEmail: DEV.email, actor: DEV, notifyAdmins: true,
  });
  check('V · case COCHÉE → une annonce est demandée', cochee.notice !== null);
  check('…elle porte le motif réel', cochee.notice.reason === 'Avec annonce');
  check('…et son auteur', cochee.notice.actorEmail === DEV.email);
  check('l’intention est persistée à vrai',
    (await getSingleton(SiteStatus)).technicalSuspension.notifyAdminsRequested === true);

  /** La REPRISE ne notifie jamais — le cahier des charges n'en demande pas. */
  const reprise = await setTechnicalSuspension({
    active: false, actorEmail: DEV.email, actor: DEV, notifyAdmins: true,
  });
  check('une REPRISE ne produit aucune annonce, même « notifyAdmins »',
    reprise.notice === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('V (suite). Une intention par destinataire, aucun doublon');
{
  await User.deleteMany({});
  await User.create([
    { name: 'Admin Un', email: 'a1@exemple.fr', password: 'x'.repeat(60), role: 'ADMIN' },
    { name: 'Admin Deux', email: 'a2@exemple.fr', password: 'x'.repeat(60), role: 'ADMIN' },
    /** Un DEV n'est PAS un administrateur client — deux publics distincts. */
    { name: 'Dev', email: 'dev@exemple.fr', password: 'x'.repeat(60), role: 'DEV' },
  ]);

  const resolvers = await import('../services/email/emailRecipientResolvers.js');
  const admins = await resolvers.resolveRecipients('ADMIN_EMAILS');

  check('les administrateurs sont résolus', admins.length === 2);
  /**
   * LE DEV N'EST PAS DESTINATAIRE. Le confondre enverrait au client un message
   * d'exploitation, ou priverait le client d'une information qui le concerne.
   */
  check('AUCUN compte DEV parmi les destinataires',
    !admins.some((a) => a.email === 'dev@exemple.fr'));
  check('chaque destinataire porte une clé stable, jamais l’adresse en clair',
    admins.every((a) => typeof a.key === 'string' && a.key.length > 0 && a.key !== a.email));

  /**
   * ══ LE DÉDOUBLONNAGE, ÉPROUVÉ SUR SON VRAI MÉCANISME ══════════════════════
   *
   * La base refuse déjà deux comptes de même adresse — l'index unique sur
   * `email` tranche avant nous, et c'est une garantie plus forte. Reste le cas
   * qu'il ne couvre pas : deux CANDIDATS de même adresse écrite différemment,
   * qui arrivent d'une liste configurée ou d'une casse différente. C'est
   * `normalizeRecipients` qui doit trancher, AVANT que les actes d'envoi ne
   * soient fabriqués — sinon la même personne reçoit deux fois le message,
   * sous deux identités d'acte que l'index d'unicité ne peut pas rapprocher.
   */
  const dedoublonnes = resolvers.normalizeRecipients([
    { email: 'a1@exemple.fr', name: 'Un' },
    { email: 'A1@Exemple.FR', name: 'Un (autre casse)' },
    { email: '  a1@exemple.fr  ', name: 'Un (espaces)' },
    { email: 'pas-une-adresse', name: 'Invalide' },
    { email: 'a2@exemple.fr', name: 'Deux' },
  ]);
  check('la même adresse en casses différentes ne produit QU’UN destinataire',
    dedoublonnes.length === 2);
  check('…et une adresse invalide est un NON-destinataire, pas une erreur',
    !dedoublonnes.some((d) => d.email === 'pas-une-adresse'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('W. Brevo en panne — la suspension reste EFFECTIVE');
{
  await siteNeuf();
  const { site, notice: intention } = await setTechnicalSuspension({
    active: true, reason: 'Panne mail', actorEmail: DEV.email, actor: DEV, notifyAdmins: true,
  });

  check('le site est suspendu AVANT toute tentative d’envoi', site.status === 'SUSPENDED');

  /**
   * ══ AUCUN PANEL APPAIRÉ ═══════════════════════════════════════════════════
   *
   * C'est la panne la plus totale : le plan de contrôle est injoignable, donc
   * `sendTemplate` échoue pour chaque destinataire. Rien de tout cela ne doit
   * revenir sur la suspension — et surtout, RIEN NE DOIT LEVER.
   */
  let leve = null;
  let rapport = null;
  try {
    rapport = await notice.announceManualSuspension(intention);
  } catch (err) {
    leve = err;
  }

  check('L’ANNONCE NE LÈVE JAMAIS', leve === null);
  check('…elle rend un rapport', rapport !== null);
  check('…qui dit que rien n’est parti', rapport.sent === 0);
  check('…et qui compte les échecs',
    rapport.failed > 0 || rapport.skipped !== null);

  const apres = await getSingleton(SiteStatus);
  check('LE SITE EST TOUJOURS SUSPENDU', apres.status === 'SUSPENDED');
  check('…la cause est intacte', apres.technicalSuspension.active === true);
  check('…le motif aussi', apres.technicalSuspension.reason === 'Panne mail');
  check('…et l’intention reste tracée',
    apres.technicalSuspension.notifyAdminsRequested === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('W (suite). Aucun destinataire — un cas NORMAL, pas une erreur');
{
  await User.deleteMany({ role: 'ADMIN' });
  const rapport = await notice.announceManualSuspension({
    reason: 'x', actorEmail: DEV.email, at: new Date('2026-08-13T12:00:00Z'),
  });
  check('aucun destinataire → SKIP explicite', rapport.skipped === 'NO_RECIPIENTS');
  check('…aucune tentative', rapport.attempted === 0);
  check('…et aucune levée', true);

  const site = await getSingleton(SiteStatus);
  check('le site reste suspendu', site.status === 'SUSPENDED');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('X. Double clic ×8 — UNE transition, donc UNE annonce');
{
  await siteNeuf();

  const resultats = [];
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    resultats.push(await setTechnicalSuspension({
      active: true, reason: 'Concurrence', actorEmail: DEV.email, actor: DEV, notifyAdmins: true,
    }));
  }

  const transitions = resultats.filter((r) => r.transitioned).length;
  const annonces = resultats.filter((r) => r.notice !== null).length;

  /**
   * L'écriture est un REMPLACEMENT, pas une bascule : huit appels posent huit
   * fois la même cause. Seul le premier franchit `wasActive !== next`, et c'est
   * lui seul qui journalise et qui déclenche l'annonce.
   */
  check('UNE SEULE transition sur huit appels', transitions === 1);
  check('…donc UNE seule annonce', annonces === 1);

  const site = await getSingleton(SiteStatus);
  check('l’état final est cohérent', site.status === 'SUSPENDED');
  check('…et le motif n’a pas été dupliqué',
    site.technicalSuspension.reason === 'Concurrence');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Y. Reprise manuelle SEULE — le site redevient accessible');
{
  await siteNeuf();
  await setTechnicalSuspension({ active: true, reason: 'M', actorEmail: DEV.email, actor: DEV });
  const { site } = await setTechnicalSuspension({
    active: false, actorEmail: DEV.email, actor: DEV,
  });

  check('le site est de nouveau accessible', site.status === 'ACTIVE');
  check('…aucune cause ne subsiste',
    site.causes.technical === false && site.causes.contract === false
    && site.causes.paymentDefault === false);
  check('…et la source est NONE', site.suspensionSource === 'NONE');

  const doc = await getSingleton(SiteStatus);
  check('LA LEVÉE EST DATÉE', doc.technicalSuspension.liftedAt instanceof Date);
  check('…et nominative', doc.technicalSuspension.liftedBy === DEV.email);
  /** L'état COURANT est nettoyé : un motif sur un site ouvert se lirait mal. */
  check('l’état courant est nettoyé', doc.technicalSuspension.reason === '');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Z. Reprise manuelle + IMPAYÉ — le site reste INACCESSIBLE');
{
  await siteNeuf();
  await setTechnicalSuspension({ active: true, reason: 'M', actorEmail: DEV.email, actor: DEV });
  await poserImpaye(true);

  const avant = await getSingleton(SiteStatus);
  check('les DEUX causes sont actives',
    avant.causes.technical === true && avant.causes.paymentDefault === true);

  const { site } = await setTechnicalSuspension({
    active: false, actorEmail: DEV.email, actor: DEV,
  });

  /**
   * ══ LE CAS QUI JUSTIFIE TOUT LE MOTEUR ═══════════════════════════════════
   *
   * Retirer la cause manuelle ne rouvre PAS un site dont l'abonnement n'est
   * pas payé. Un `status = ACTIVE` écrit à la main dans le chemin de reprise
   * aurait rouvert un site impayé — et personne ne l'aurait décidé.
   */
  check('LE SITE RESTE SUSPENDU', site.status === 'SUSPENDED');
  check('…la cause manuelle est bien retirée', site.causes.technical === false);
  check('…mais l’impayé, non', site.causes.paymentDefault === true);
  check('…et c’est lui qui prime désormais', site.suspensionSource === 'PAYMENT_DEFAULT');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AA. Reprise manuelle + une AUTRE maintenance — non applicable ici');
{
  /**
   * Le levier manuel est UNIQUE : il n'existe pas deux maintenances
   * simultanées, et il ne faut pas en inventer une seconde pour le prouver.
   * Le scénario équivalent — « une autre cause survit à la reprise » — est
   * couvert par Z (impayé) et AB (contrat), qui sont les deux seules autres
   * causes du moteur.
   */
  const site = await getSingleton(SiteStatus);
  check('le moteur ne connaît que TROIS causes',
    Object.keys(site.causes.toObject ? site.causes.toObject() : site.causes).sort().join(',')
    === 'contract,paymentDefault,technical');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AB. Reprise manuelle + CONTRAT non honoré — reste INACCESSIBLE');
{
  await siteNeuf();
  await poserImpaye(false);
  /** Protection active + aucun contrat vivant = cause contractuelle. */
  await setContractProtection({ enabled: true, actor: DEV });
  await setTechnicalSuspension({ active: true, reason: 'M', actorEmail: DEV.email, actor: DEV });

  const avant = await getSingleton(SiteStatus);
  check('les deux causes sont actives',
    avant.causes.technical === true && avant.causes.contract === true);

  const { site } = await setTechnicalSuspension({
    active: false, actorEmail: DEV.email, actor: DEV,
  });

  check('LE SITE RESTE SUSPENDU', site.status === 'SUSPENDED');
  check('…la cause manuelle est retirée', site.causes.technical === false);
  check('…la cause contractuelle subsiste', site.causes.contract === true);
  check('…et elle prime', site.suspensionSource === 'CONTRACT');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AC. Combinaison MAXIMALE — retirées une à une, la dernière rouvre');
{
  await siteNeuf();
  await setContractProtection({ enabled: true, actor: DEV });
  await poserImpaye(true);
  await setTechnicalSuspension({ active: true, reason: 'M', actorEmail: DEV.email, actor: DEV });

  let site = await getSingleton(SiteStatus);
  check('LES TROIS causes sont actives',
    site.causes.technical === true && site.causes.contract === true
    && site.causes.paymentDefault === true);
  check('…et le site est fermé', site.status === 'SUSPENDED');

  /** 1/3 — la manuelle part. Deux restent. */
  ({ site } = await setTechnicalSuspension({ active: false, actorEmail: DEV.email, actor: DEV }));
  check('après retrait de la MANUELLE : toujours fermé', site.status === 'SUSPENDED');
  check('…il reste deux causes',
    site.causes.contract === true && site.causes.paymentDefault === true);

  /** 2/3 — l'impayé part. Une reste. */
  await poserImpaye(false);
  site = await getSingleton(SiteStatus);
  check('après retrait de l’IMPAYÉ : toujours fermé', site.status === 'SUSPENDED');
  check('…il reste une cause', site.causes.contract === true);

  /** 3/3 — la dernière part. Le site rouvre, et seulement maintenant. */
  site = await setContractProtection({ enabled: false, actor: DEV });
  check('APRÈS LA DERNIÈRE CAUSE, le site rouvre', site.status === 'ACTIVE');
  check('…et plus aucune cause n’est active',
    site.causes.technical === false && site.causes.contract === false
    && site.causes.paymentDefault === false);
  check('…la source est NONE', site.suspensionSource === 'NONE');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AD. Ce que le Panel reçoit — la projection porte la cause manuelle');
{
  await siteNeuf();
  await setTechnicalSuspension({
    active: true, reason: 'Maintenance annoncée', actorEmail: DEV.email, actor: DEV,
  });

  const { buildSiteStatusProjection } = await import(
    '../services/projectBridge/projectSync.service.js'
  );
  const { payload } = await buildSiteStatusProjection();

  /**
   * ══ LA CONFIRMATION PASSE PAR L'ÉTAT, PAS PAR UN ÉVÉNEMENT ═══════════════
   *
   * Le Panel n'apprend pas « une suspension a été demandée » : il reçoit
   * l'état RÉEL du site, avec l'instantané explicite de ses causes. Un
   * événement dédié aurait créé une seconde vérité, qui divergerait au premier
   * désordre de livraison.
   */
  check('la projection dit le site fermé', payload.accessible === false);
  check('…nomme la cause manuelle', payload.causes.technical === true);
  check('…et porte le motif', payload.reason === 'Maintenance annoncée');
  check('…sans inventer les autres causes',
    payload.causes.contract === false && payload.causes.paymentDefault === false);

  /** Le désordre est déjà écarté par l'horloge de la source. */
  const projection = await buildSiteStatusProjection();
  check('la projection porte l’horloge du document', typeof projection.modifiedAt === 'string');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('G+X. TECHNICAL masque PAYMENT_DEFAULT, mais ne l’efface pas');
{
  await siteNeuf();
  await poserImpaye(true);
  await setTechnicalSuspension({ active: true, reason: 'M', actorEmail: DEV.email, actor: DEV });

  const { buildSiteStatusProjection } = await import(
    '../services/projectBridge/projectSync.service.js'
  );
  const { payload } = await buildSiteStatusProjection();

  /**
   * LA PREUVE EST L'INSTANTANÉ, JAMAIS LA DOMINANTE. Un Panel qui conclurait
   * de `suspensionSource !== 'PAYMENT_DEFAULT'` que sa cause n'a pas été
   * appliquée relancerait indéfiniment une demande déjà honorée.
   */
  check('la dominante affichée est TECHNICAL', payload.suspensionSource === 'TECHNICAL');
  check('…ET L’IMPAYÉ RESTE PROUVÉ', payload.causes.paymentDefault === true);
  check('…à côté de la manuelle', payload.causes.technical === true);
  check('les causes suffisent à expliquer le verdict',
    payload.accessible === !(payload.causes.technical || payload.causes.contract
      || payload.causes.paymentDefault));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L. PREUVE DURABLE — qui, quand, motif, intention, et la levée');
{
  await ContractAuditLog.deleteMany({});
  await siteNeuf();

  await setTechnicalSuspension({
    active: true, reason: 'Incident réseau', actorEmail: DEV.email, actor: DEV, notifyAdmins: true,
  });
  await setTechnicalSuspension({ active: false, actorEmail: DEV.email, actor: DEV });

  const applique = await ContractAuditLog.findOne({
    action: CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_APPLIED,
  }).lean();
  const leve = await ContractAuditLog.findOne({
    action: CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_LIFTED,
  }).lean();

  check('l’ACTE de suspension est journalisé', applique !== null);
  check('…avec son motif RÉEL', applique.metadataSafe.reason === 'Incident réseau');
  check('…son auteur', applique.metadataSafe.actorEmail === DEV.email);
  check('…l’intention de notifier', applique.metadataSafe.notifyAdminsRequested === true);
  check('…et sa date', applique.createdAt instanceof Date);

  check('la LEVÉE est journalisée séparément', leve !== null);
  check('…sans motif (il n’y en a pas à la levée)', leve.metadataSafe.reason === null);
  check('…avec son auteur', leve.metadataSafe.actorEmail === DEV.email);

  /** Le motif ABSENT est journalisé `null`, jamais la chaîne « Aucun ». */
  await ContractAuditLog.deleteMany({});
  await siteNeuf();
  await setTechnicalSuspension({ active: true, reason: '', actorEmail: DEV.email, actor: DEV });
  const sansMotif = await ContractAuditLog.findOne({
    action: CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_APPLIED,
  }).lean();
  check('un motif absent est journalisé NULL', sansMotif.metadataSafe.reason === null);
  check('…et surtout pas « Aucun »', sansMotif.metadataSafe.reason !== 'Aucun');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L (suite). L’acte est tracé MÊME sans bascule de statut');
{
  await siteNeuf();
  /** Le site est DÉJÀ fermé pour impayé : poser la manuelle ne bascule rien. */
  await poserImpaye(true);
  const avant = await getSingleton(SiteStatus);
  check('le site est déjà fermé', avant.status === 'SUSPENDED');

  /**
   * ON VIDE LE JOURNAL ICI, ET PAS AVANT.
   *
   * La fermeture pour impayé a, elle, bien fait basculer le statut : elle a
   * donc légitimement écrit un `SITE_SUSPENDED`. Le vider maintenant isole ce
   * qu'on veut mesurer — ce que l'acte MANUEL ajoute, alors qu'il ne bascule
   * plus rien.
   */
  await ContractAuditLog.deleteMany({});

  await setTechnicalSuspension({
    active: true, reason: 'Pose sur site déjà fermé', actorEmail: DEV.email, actor: DEV,
  });

  const acte = await ContractAuditLog.findOne({
    action: CONTRACT_AUDIT_ACTION.SITE_MANUAL_SUSPENSION_APPLIED,
  }).lean();
  /**
   * C'EST LE CAS QUE `SITE_SUSPENDED` NE COUVRE PAS. L'accessibilité n'a pas
   * bougé — le site était déjà fermé — donc aucun `SITE_SUSPENDED` n'est
   * écrit. Sans un journal de l'ACTE, poser puis retirer cette cause serait
   * resté totalement invisible.
   */
  check('L’ACTE EST TRACÉ malgré l’absence de bascule', acte !== null);
  check('…et le journal dit que le site était déjà fermé',
    acte.metadataSafe.siteStatus === 'SUSPENDED');
  check('…en nommant l’autre cause',
    acte.metadataSafe.otherCauses.paymentDefault === true);

  const bascule = await ContractAuditLog.findOne({
    action: CONTRACT_AUDIT_ACTION.SITE_SUSPENDED,
  }).lean();
  check('…alors qu’AUCUNE bascule de statut n’a été journalisée', bascule === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('GARDE-FOUS STATIQUES — aucune activation forcée, aucun Brevo local');
{
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const racine = path.resolve(ici, '../..');

  /**
   * LA GARDE LIT LE CODE, PAS LA PROSE. Ces fichiers expliquent longuement
   * pourquoi ils n'écrivent jamais `status = ACTIVE` ; une garde naïve
   * rougirait sur la documentation de l'interdit qu'elle défend, et quelqu'un
   * supprimerait le commentaire pour faire passer le test.
   */
  const codeSeul = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  const enforcement = codeSeul(fs.readFileSync(
    path.join(racine, 'src/services/siteEnforcement.service.js'), 'utf8',
  ));
  const controleur = codeSeul(fs.readFileSync(
    path.join(racine, 'src/controllers/siteStatus.controller.js'), 'utf8',
  ));
  const annonce = codeSeul(fs.readFileSync(
    path.join(racine, 'src/services/siteSuspensionNotice.service.js'), 'utf8',
  ));

  /**
   * ══ 1. AUCUNE ACTIVATION FORCÉE ═══════════════════════════════════════════
   *
   * `site.status` n'est écrit qu'à UN endroit : la ligne `site.status =
   * nextStatus` de la réconciliation, qui découle de la conjonction. Toute
   * autre écriture rouvrirait un site que ses causes maintiennent fermé.
   */
  const ecrituresStatut = enforcement.match(/\bsite\.status\s*=/g) ?? [];
  check('une SEULE écriture de site.status dans tout l’enforcement',
    ecrituresStatut.length === 1);
  check('…et c’est celle du verdict réconcilié',
    /site\.status\s*=\s*nextStatus/.test(enforcement));
  check('aucune activation en dur dans l’enforcement',
    !/status\s*=\s*['"]ACTIVE['"]|SITE_STATUS\.ACTIVE\s*;/.test(enforcement));
  check('…ni dans le contrôleur', !/\.status\s*=\s*['"]?(ACTIVE|SITE_STATUS)/.test(controleur));

  /** 2. La résolution d'un paiement ne force rien non plus. */
  const causeApplier = codeSeul(fs.readFileSync(
    path.join(racine, 'src/services/billing/paymentDefaultCause.applier.js'), 'utf8',
  ));
  check('l’applicateur de cause n’écrit aucun statut',
    !/\bsite\.status\s*=/.test(causeApplier));
  check('…il rend la main au moteur', /reconcileSiteStatus/.test(causeApplier));

  /** 3. `suspensionSource` n'est jamais une preuve dans le métier. */
  check('l’enforcement ne LIT jamais suspensionSource pour décider',
    !/suspensionSource\s*===/.test(enforcement));

  /**
   * ══ 4-5. AUCUN TRANSPORT NI CREDENTIAL LOCAL ══════════════════════════════
   *
   * Le module d'annonce ne connaît pas Brevo : il demande un verbe au Panel.
   * Un driver, une clé ou un repli local rouvriraient la porte que L8.4C a
   * fermée — et le contenu sortirait de nos versions.
   */
  for (const [nom, src] of [['annonce', annonce], ['enforcement', enforcement]]) {
    check(`${nom} : aucun driver Brevo`, !/BrevoEmailProvider|brevoProvider|api\.brevo\.com/i.test(src));
    check(`${nom} : aucune clé`, !/xkeysib-|apiKey|secretKey/i.test(src));
    check(`${nom} : aucun fetch`, !/\bfetch\s*\(/.test(src));
  }
  check('l’annonce passe par la façade d’envoi, jamais par le pont',
    /emailDelivery\.service/.test(annonce) && !/panelBridge\/(bridgeRuntime|PanelClient)/.test(annonce));

  /**
   * ══ 13. L'E-MAIL EST HORS DU CHEMIN CRITIQUE ══════════════════════════════
   *
   * L'enforcement ne connaît ni le module d'annonce, ni l'envoi. Il pose une
   * cause et réconcilie ; c'est tout. Un import ici suffirait à ce qu'un
   * `await` malheureux annule une suspension parce que Brevo est en panne.
   */
  check('L’ENFORCEMENT N’IMPORTE PAS L’ANNONCE',
    !/siteSuspensionNotice|sendTemplate/.test(enforcement));
  check('…et le contrôleur l’appelle APRÈS la suspension',
    controleur.indexOf('setTechnicalSuspension') < controleur.indexOf('announceManualSuspension'));

  /**
   * ══ 14. RETIRER UNE CAUSE ⇒ RÉCONCILIER ═══════════════════════════════════
   */
  check('poser/retirer la cause manuelle passe par la réconciliation',
    /setTechnicalSuspension[\s\S]*?reconcileSiteStatus/.test(enforcement));

  /** 12. « Aucun » ne se fabrique qu'au rendu, jamais en base. */
  check('l’enforcement n’écrit jamais « Aucun »', !/['"]Aucun['"]/.test(enforcement));
  check('…et le rendu, lui, le connaît', /Aucun/.test(annonce));

  /** L'écran non plus ne persiste pas la phrase d'affichage. */
  const ecran = codeSeul(fs.readFileSync(
    path.join(racine, '../manager/src/pages/StatusPage.tsx'), 'utf8',
  ));
  check('l’écran ne pose pas « Aucun » dans le motif envoyé',
    !/reason\s*[:=]\s*['"]Aucun['"]/.test(ecran));
  check('la case est décochée par défaut', /useState\(false\)/.test(ecran));
  check('…et son intention est transmise explicitement',
    /suspendSite\(reason,\s*notifyAdmins\)/.test(ecran));
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
