import { Contract } from '../models/Contract.model.js';
import { getPublishedDeveloperIdentity } from './panelConfiguration/developerIdentity.service.js';
import {
  getClientCompany,
  getClientContractualSigner,
} from './panelConfiguration/clientCompany.service.js';
import { Company } from '../models/Company.model.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { getSingleton } from '../utils/singleton.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { getContractReadiness, getProviderReadiness } from './integratedApi.service.js';
import { logContractAudit, ContractAuditLog } from '../models/ContractAuditLog.model.js';
import * as docs from './contractDocument.service.js';
import { emitSafe } from './events/domainEvent.service.js';
import { EVENT_ACTOR_TYPE } from '../utils/domainEventConstants.js';
import {
  storeOriginalPdf,
  deleteContractStorage,
  resolveContractDocumentFile,
} from './contractDocument.service.js';
import { validateZones } from './signature/signatureCoordinates.js';
import { signatureOf } from './signature/signatureRecord.js';
import {
  createContractSignatureRequest,
  getSignerLink,
} from './signature/signature.service.js';
import { cancelSubscriptionViaPanel } from './stripe/checkoutCapability.js';
import { settleFromSubscription } from './subscription.service.js';
import * as sm from './contractStateMachine.js';
import { computePricing, eurosToCents } from '../utils/money.js';
import { normalizeSubscriptionRecurrence, recurrenceOf } from '../utils/subscriptionRecurrence.js';
import { getSignerGaps, formatSignerGaps, SIGNER_REQUIRED_FIELDS } from '../utils/signer.js';
import {
  CONTRACT_STATUS as S,
  LIVE_CONTRACT_STATUSES,
  SIGNER_ROLE,
  SIGNATURE_STATUS,
  AUDIT_ACTOR_TYPE,
  CONTRACT_AUDIT_ACTION,
  DEFAULT_TAX_RATE,
  MAX_PAYMENT_GRACE_DAYS,
} from '../utils/contractConstants.js';

/**
 * Logique métier du contrat (les contrôleurs restent fins). Applique les
 * invariants : prérequis d'intégrations, verrouillage à la validation, snapshot
 * des parties, revérification à l'activation, unicité du contrat vivant.
 */

/**
 * LES INTEGRATIONS REQUISES — nommees par leur ROLE, pas par leur fournisseur.
 *
 * `SIGNATURE` a remplace `YOUSIGN` : la question posee est « la signature
 * repond-elle ? », et c'est la plateforme qui sait qui l'execute. Nommer le
 * fournisseur ici aurait fait porter au contrat une connaissance qui change
 * sans lui.
 */
const REQUIRED_INTEGRATIONS = ['STRIPE', 'SIGNATURE'];
/** Integrations reellement requises par CE contrat : la signature seulement si elle est requise. */
export function requiredIntegrationsFor(contract) {
  return sm.signatureRequired(contract) ? REQUIRED_INTEGRATIONS : ['STRIPE'];
}

/**
 * Vérifie (backend) que Stripe ET Yousign sont, pour leur MODE ACTIF (jamais
 * l'ENV), configurés ET testés avec succès (verified). La création utilise donc
 * le mode actif de chaque fournisseur, indépendamment de config.env.
 */
export async function assertIntegrationsReady() {
  const { ready, providers } = await getContractReadiness(REQUIRED_INTEGRATIONS);
  if (!ready) {
    const missing = providers
      .filter((p) => !p.ok)
      .map((p) => ({ provider: p.provider, activeMode: p.activeMode, reason: p.reason }));
    throw new ApiError(400, 'Le paiement et la signature doivent être configurés et testés.', {
      code: 'INTEGRATIONS_NOT_READY',
      missing,
    });
  }
}

/**
 * LA SIGNATURE EST-ELLE DISPONIBLE ? -- la question ne nomme AUCUN fournisseur.
 *
 * == POURQUOI ELLE A CESSE D'EN NOMMER UN ==================================
 *
 * Elle demandait `assertProviderReady('YOUSIGN')`. Depuis la bascule, les
 * nouvelles demandes partent chez OpenSign : la question portait donc sur un
 * fournisseur qui n'allait pas servir, et son verdict n'avait plus de rapport
 * avec ce qui allait se passer.
 *
 * Ce qu'on veut savoir est plus simple, et plus stable : la CAPACITE de
 * signature repond-elle ? La sonde interroge la plateforme, qui sait, elle,
 * qui l'execute. Le jour d'une prochaine bascule, cette ligne ne bougera pas.
 */
export async function assertSignatureReady() {
  return assertProviderReady('SIGNATURE');
}

/**
 * Vérifie qu'UN fournisseur précis est prêt (mode actif configuré + vérifié)
 * AVANT de l'utiliser (paiement -> Stripe). Ne bloque pas la simple
 * construction d'un brouillon de contrat.
 */
export async function assertProviderReady(provider) {
  const r = await getProviderReadiness(provider);
  if (!r.ok) {
    throw new ApiError(400, `${provider} doit être configuré et testé (mode actif).`, {
      code: 'INTEGRATION_NOT_READY',
      missing: [{ provider: r.provider, activeMode: r.activeMode, reason: r.reason }],
    });
  }
}

async function nextReference() {
  const year = new Date().getFullYear();
  const count = await Contract.countDocuments();
  return `CTR-${year}-${String(count + 1).padStart(4, '0')}`;
}

/** Le contrat est-il encore modifiable (DRAFT non verrouillé) ? */
function assertMutable(contract) {
  if (contract.status !== S.DRAFT || contract.signatureConfiguration.locked) {
    throw ApiError.badRequest('Contrat verrouillé : configuration non modifiable.');
  }
}

// --- Création / brouillon ---------------------------------------------------

export async function createContract(actor, { name } = {}) {
  // La création d'un BROUILLON ne fait aucun appel externe : elle n'exige donc
  // PAS Stripe/Yousign. La disponibilité d'un fournisseur est vérifiée au point
  // d'usage (signature -> Yousign ; paiement -> Stripe) via assertProviderReady.
  const reference = await nextReference();
  const contract = await Contract.create({
    reference,
    // AUCUN pré-remplissage : un contrat naît sans nom. Le nom auto
    // (`Contrat ${reference}`) obligeait le DEV à effacer un texte qu'il
    // n'avait pas écrit, et forçait le front à deviner « pas encore nommé » en
    // comparant à cette chaîne — un couplage entre les deux couches.
    // Un nom vide est valide côté modèle (`default: ''`) ; c'est le parcours
    // guidé qui le réclame avant la validation.
    name: (name && String(name).trim()) || '',
    status: S.DRAFT,
    environment: config.env,
    taxRate: DEFAULT_TAX_RATE,
    createdBy: actor?._id || null,
    updatedBy: actor?._id || null,
  });
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CREATED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
  });
  return contract;
}

/** Met à jour le brouillon (tarification, notes) — DRAFT uniquement. */
export async function updateDraft(contract, payload, actor) {
  assertMutable(contract);
  const { launchFee, subscription, taxRate, name } = payload || {};
  const rate = Number.isFinite(taxRate) ? taxRate : contract.taxRate;
  if (typeof name === 'string' && name.trim()) contract.name = name.trim();

  if (launchFee) {
    if (launchFee.enabled) {
      // Le Manager saisit des EUROS ; on convertit et stocke en centimes.
      const htCents = eurosToCents(launchFee.amountExcludingTax || 0);
      const p = computePricing({ amountExcludingTax: htCents, taxRate: rate });
      contract.pricing.launchFee = { enabled: true, ...p };
    } else {
      contract.pricing.launchFee = { enabled: false, amountExcludingTax: 0, taxRate: rate, taxAmount: 0, amountIncludingTax: 0, currency: 'EUR' };
    }
  }
  if (subscription) {
    /**
     * LA RÉCURRENCE RETENUE — dans cet ordre, et l'ordre est la règle.
     *
     *   1. `recurrence` reçu       la saisie explicite du Manager à jour ;
     *   2. `interval` hérité reçu  un Manager non rechargé, lu « tous les 1 » ;
     *   3. celle déjà enregistrée  une mise à jour de MONTANT SEUL ne doit
     *                              jamais réinitialiser la périodicité — c'est
     *                              par là qu'un trimestriel redeviendrait
     *                              mensuel sans que personne ne l'ait demandé ;
     *   4. tous les mois           le défaut historique du parc.
     *
     * `normalizeSubscriptionRecurrence` relève toujours : le validateur a déjà
     * refusé les formes invalides, et une saisie licite qui échouerait ici
     * signalerait une divergence entre les deux — qu'on préfère bruyante.
     */
    let recurrence;
    if (subscription.recurrence) {
      recurrence = normalizeSubscriptionRecurrence(subscription.recurrence);
    } else if (subscription.interval) {
      recurrence = normalizeSubscriptionRecurrence({ unit: subscription.interval, interval: 1 });
    } else {
      recurrence = recurrenceOf(contract.pricing.subscription);
    }
    // Miroir d'héritage : DÉRIVÉ de l'unité, jamais une seconde décision.
    const interval = recurrence.unit;

    if (subscription.enabled) {
      const htCents = eurosToCents(subscription.amountExcludingTax || 0);
      const p = computePricing({ amountExcludingTax: htCents, taxRate: rate });
      contract.pricing.subscription = { enabled: true, ...p, recurrence, interval };
    } else {
      contract.pricing.subscription = { enabled: false, amountExcludingTax: 0, taxRate: rate, taxAmount: 0, amountIncludingTax: 0, currency: 'EUR', recurrence, interval };
    }
  }
  if (payload?.signatureRequirement) {
    const next = payload.signatureRequirement;
    const prev = contract.signatureRequirement || 'REQUIRED';
    if (next !== prev) {
      // JAMAIS de données orphelines : on refuse de désactiver la signature
      // tant qu'une procédure Yousign existe — l'annuler d'abord, explicitement.
      if (next === 'NOT_REQUIRED' && signatureOf(contract).requestId) {
        throw ApiError.badRequest(
          'Une procédure de signature existe déjà pour ce contrat. Annulez-la avant de déclarer la signature non requise.',
          { code: 'SIGNATURE_REQUEST_ACTIVE' }
        );
      }
      contract.signatureRequirement = next;
    }
  }
  contract.taxRate = rate;
  contract.updatedBy = actor?._id || null;
  await contract.save();
  return contract;
}

/**
 * LE DÉLAI DE GRÂCE EN CAS D'IMPAYÉ — la politique commerciale du contrat.
 *
 * ══ POURQUOI CE N'EST PAS DANS `updateDraft` ════════════════════════════════
 *
 * `updateDraft` exige un BROUILLON, et c'est juste : on ne retouche pas la
 * tarification d'un contrat signé. Mais un délai de grâce ne sert à rien tant
 * qu'il n'y a pas d'abonnement — c'est-à-dire précisément quand le contrat
 * n'est plus un brouillon. Le cas réel est celui d'une facture refusée sur un
 * contrat ACTIF, et d'un accord commercial pour laisser au client une semaine
 * de plus. Enfermer ce réglage derrière `assertMutable` l'aurait rendu
 * inutilisable au seul moment où il compte.
 *
 * Le délai n'est pas un terme du PDF signé : c'est la clémence que LYCARZ
 * s'accorde avant d'agir. Il se change donc à tout moment — mais jamais en
 * silence : chaque changement est journalisé, daté et nominatif.
 *
 * ══ POURQUOI `null` EST UNE VALEUR, PAS UN OUBLI ════════════════════════════
 *
 * `null` signifie « aucune politique configurée ». Le Panel ouvre alors bien
 * l'incident — la dette est réelle et se voit — mais ne fixe AUCUNE échéance,
 * donc ne ferme jamais le site de lui-même. C'est un refus de supposer, pas
 * une tolérance infinie : l'impayé reste visible et la fermeture reste
 * possible, à la main.
 *
 * Un `0` est une politique parfaitement valide, et très différente : aucune
 * clémence, l'échéance tombe au premier refus. Les deux devaient rester
 * distinguables, ce qu'un `graceDays || 0` aurait détruit.
 *
 * @param {object} contract
 * @param {{ paymentGraceDays: number|null }} payload jours entiers, ou `null`.
 */
export async function updatePaymentGracePolicy(contract, payload, actor) {
  const demande = payload?.paymentGraceDays;
  const suivant = demande === null || demande === undefined ? null : Number(demande);

  if (suivant !== null && (!Number.isInteger(suivant) || suivant < 0 || suivant > MAX_PAYMENT_GRACE_DAYS)) {
    throw ApiError.badRequest(
      `Délai de grâce invalide : un nombre entier de jours entre 0 et ${MAX_PAYMENT_GRACE_DAYS}, ou aucune politique.`,
      { code: 'PAYMENT_GRACE_DAYS_INVALID' },
    );
  }

  const precedent = Number.isInteger(contract.paymentGraceDays) ? contract.paymentGraceDays : null;
  if (precedent === suivant) return contract; // rien à écrire, rien à journaliser

  contract.paymentGraceDays = suivant;
  contract.updatedBy = actor?._id || null;
  await contract.save();

  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.PAYMENT_GRACE_POLICY_CHANGED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
    metadataSafe: { previous: precedent, next: suivant },
  });
  return contract;
}

/** Enregistre le document PDF (validé/stocké par le pipeline). DRAFT uniquement. */
export async function setDocument(contract, buffer, filename, actor) {
  assertMutable(contract);
  const meta = await storeOriginalPdf(contract._id, buffer, { filename });
  contract.document.originalFilename = meta.originalFilename;
  contract.document.originalChecksum = meta.originalChecksum;
  contract.document.pageCount = meta.pageCount;
  contract.document.pageSizes = meta.pageSizes;
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.DOCUMENT_UPLOADED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
    metadataSafe: { pageCount: meta.pageCount },
  });
  return contract;
}

/**
 * Enregistre la configuration des zones de signature. DRAFT uniquement.
 * CHAQUE sauvegarde crée une VERSION (snapshot dans l'historique) ; le contrat
 * conserve la dernière. On valide la GÉOMÉTRIE des zones (page, taille, bords)
 * mais PAS la présence des deux signataires — cette contrainte est vérifiée à la
 * validation du contrat, laissant le DEV sauvegarder des états intermédiaires.
 */
const MAX_VERSION_HISTORY = 50;
export async function setSignatureConfiguration(contract, zones, actor) {
  assertMutable(contract);
  if (!contract.document.originalFilename) {
    throw ApiError.badRequest("Uploader d'abord le PDF du contrat.");
  }
  if (zones.length > 0) {
    const errors = validateZones(zones, { pageCount: contract.document.pageCount });
    if (errors.length) throw ApiError.badRequest('Configuration de signature invalide.', { errors });
  }

  const nextVersion = (contract.signatureConfiguration.version || 0) + 1;
  contract.signatureConfiguration.zones = zones;
  contract.signatureConfiguration.version = nextVersion;
  contract.signatureConfiguration.versions.push({
    version: nextVersion,
    zones,
    savedAt: new Date(),
    savedBy: actor?._id || null,
  });
  if (contract.signatureConfiguration.versions.length > MAX_VERSION_HISTORY) {
    contract.signatureConfiguration.versions = contract.signatureConfiguration.versions.slice(-MAX_VERSION_HISTORY);
  }
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.SIGNATURE_CONFIGURED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
    metadataSafe: { zones: zones.length },
  });
  return contract;
}

const SIGNER_PARTY_LABEL = Object.freeze({
  developer: "l'entreprise développeur",
  client: "l'entreprise cliente",
});

/**
 * Exige un signataire exploitable pour une partie. Distingue « pas configuré »
 * (aucune fiche signataire) de « incomplet » (fiche présente, champs manquants
 * ou email invalide) : ce sont deux actions différentes pour l'utilisateur.
 * @param {'developer'|'client'} party
 */
function assertSignerUsable(signer, party, { companyName = '' } = {}) {
  const label = SIGNER_PARTY_LABEL[party];

  /**
   * DIRE OÙ LA DONNÉE MANQUE, PAS SEULEMENT QU'ELLE MANQUE.
   *
   * ══ LE DÉFAUT D'ERGONOMIE QUE CECI FERME ═════════════════════════════════
   *
   * « Le signataire de l'entreprise développeur n'est pas configuré » laissait
   * croire qu'il fallait le renseigner ICI. Or cette identité n'appartient pas
   * au projet : elle est publiée par la PLATEFORME, une fois, pour tout le
   * parc. Aucun écran de ce Manager ne doit la porter — et l'utilisateur
   * cherchait donc un réglage qui n'existe pas.
   *
   * ══ ET LE SIGNATAIRE CLIENT A CHANGÉ DE CAMP ═════════════════════════════
   *
   * Il « se configurait bien ici » — c'était vrai, et c'était le défaut. Depuis
   * le chantier « entreprise cliente », il vit sur la fiche du Panel, avec le
   * reste de l'identité juridique du client. Aucun écran de ce Manager ne le
   * porte plus.
   *
   * Le message doit donc changer AUSSI, et c'est le point : « configurez le
   * signataire » enverrait l'utilisateur chercher un réglage qui n'existe plus.
   * Les deux parties renvoient désormais vers la plateforme — pour deux raisons
   * différentes, dites différemment.
   */
  const developpeur = party === 'developer';
  const quoi = developpeur
    ? `Le représentant de ${companyName || 'l’entreprise développeur'} utilisé pour la signature`
    : `Le signataire contractuel de ${label}`;
  /** OÙ la donnée manque — la seule moitié du message qui soit actionnable. */
  const ou = developpeur
    ? 'sur la plateforme (Panel L.Y Solution)'
    : 'par L.Y Solution, sur votre fiche client';
  const code = developpeur ? 'PLATFORM_SIGNER_NOT_CONFIGURED' : 'CLIENT_SIGNER_NOT_CONFIGURED';

  if (!signer) {
    throw ApiError.badRequest(`${quoi} n'est pas configuré — il se renseigne ${ou}.`, {
      party,
      missing: [...SIGNER_REQUIRED_FIELDS],
      code,
    });
  }
  const gaps = getSignerGaps(signer);
  if (gaps.length) {
    throw ApiError.badRequest(
      `${quoi} est incomplet : ${formatSignerGaps(gaps)} (à compléter ${ou}).`,
      { party, missing: gaps, code },
    );
  }
}

function toSignerSnapshot(signer, companyName) {
  return {
    firstName: String(signer.firstName || '').trim(),
    lastName: String(signer.lastName || '').trim(),
    jobTitle: String(signer.jobTitle || '').trim(),
    email: String(signer.email || '').trim().toLowerCase(),
    companyName,
  };
}

export function signerFullName(snapshot) {
  return [snapshot?.firstName, snapshot?.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Lit les signataires configurés sur les deux fiches Entreprise et les fige.
 * Refuse si l'une des deux parties n'est pas exploitable — un contrat ne peut
 * pas partir en signature avec une identité approximative.
 *
 * Retourne aussi la vue « éditeur » (couleur de zone, logo, libellé), dérivée
 * du snapshot : elle ne porte donc aucune identité qui n'y soit déjà figée.
 * @returns {Promise<{snapshot: {developer: object, client: object}, presentation: object[]}>}
 */
async function freezeSigners() {
  /**
   * LE SIGNATAIRE DÉVELOPPEUR VIENT DU PANEL, plus de la fiche locale.
   *
   * Il était lu dans `DevCompany`, éditée dans chaque projet. Un contrat
   * pouvait donc être signé au nom d'une entreprise que le Panel ne
   * connaissait pas, pendant que le site du même projet affichait l'autre
   * nom en bas de page.
   *
   * La lecture est LOCALE (dernière configuration reçue) : générer un contrat
   * n'interroge jamais le Panel. Une panne du Panel ne bloque pas la
   * signature, elle fige ce qu'on sait déjà.
   */
  /**
   * ── LE SIGNATAIRE CLIENT VIENT DU PANEL, LUI AUSSI ──────────────────────
   *
   * ══ CE QUI SE PASSAIT AVANT ═════════════════════════════════════════════
   *
   * Il était lu dans `Company.signer` — une fiche ÉDITÉE DANS CE MANAGER.
   * Deux conséquences, et les deux se sont produites :
   *
   *   · un même client possédant deux sites pouvait déclarer deux
   *     signataires différents pour la même personne morale, et rien ne
   *     disait lequel engageait réellement l’entreprise ;
   *   · le CLIENT choisissait l’identité qui signe le contrat que
   *     L.Y Solution lui présente. Un signataire n’est pas une préférence
   *     d’affichage : c’est la personne physique qui engage une société.
   *
   * ══ CE QUI CHANGE, ET CE QUI NE CHANGE PAS ═════════════════════════════
   *
   * CHANGE : la SOURCE. L’autorité est le Panel, pour les DEUX parties —
   * exactement comme pour le signataire développeur, et pour la même raison.
   *
   * NE CHANGE PAS : l’instantané. L’identité reste FIGÉE à la validation du
   * contrat (`signersSnapshot`), et rien de ce qui suit ne la réécrit. Une
   * entreprise qui change de gérant six mois plus tard ne modifie aucun
   * contrat déjà préparé, aucune demande de signature déjà partie.
   *
   * ══ LA LECTURE EST LOCALE ══════════════════════════════════════════════
   *
   * On lit la dernière identité REÇUE, persistée ici. Préparer un contrat
   * n’interroge donc jamais le Panel : une panne du Panel ne bloque pas la
   * signature, elle fige ce qu’on sait déjà.
   */
  const [identiteDev, signataireClient, entrepriseCliente] = await Promise.all([
    getPublishedDeveloperIdentity(),
    getClientContractualSigner(),
    getClientCompany(),
  ]);

  // Aucun repli sur la fiche locale : mieux vaut refuser que signer au nom
  // d'une entreprise dont l'autorité n'a jamais entendu parler.
  if (!identiteDev) {
    throw ApiError.badRequest(
      'Aucune entreprise développeur n’a été publiée par le Panel : impossible de préparer la signature.',
      { party: 'developer', code: 'DEVELOPER_IDENTITY_NOT_PUBLISHED' },
    );
  }

  assertSignerUsable(identiteDev.signer, 'developer', { companyName: identiteDev.name });

  /**
   * AUCUNE ENTREPRISE CLIENTE PUBLIÉE ⇒ REFUS EXPLICITE.
   *
   * Aucun repli sur la fiche locale : mieux vaut refuser que signer au nom
   * d’une entreprise dont l’autorité n’a jamais entendu parler. C’est
   * exactement l’arbitrage retenu pour le signataire développeur, et il vaut
   * ici pour la même raison.
   */
  if (!entrepriseCliente) {
    throw ApiError.badRequest(
      "Aucune entreprise cliente n’est rattachée à ce projet : la signature du contrat est "
      + "indisponible tant que L.Y Solution n’a pas complété votre dossier.",
      { party: 'client', code: 'CLIENT_COMPANY_NOT_LINKED' },
    );
  }
  assertSignerUsable(signataireClient, 'client');

  const snapshot = {
    developer: toSignerSnapshot(identiteDev.signer, identiteDev.name),
    /**
     * LA RAISON SOCIALE, PAS LE NOM D’ENSEIGNE.
     *
     * `Company.name` porte le nom commercial du site — « SB Auto 06 ». Le
     * contrat, lui, engage « SARL DUPONT AUTOMOBILES ». Les confondre ferait
     * signer un document au nom d’une entité qui n’existe pas juridiquement.
     */
    client: toSignerSnapshot(signataireClient, entrepriseCliente.legalName || 'Client'),
  };
  /** La fiche locale ne sert plus qu’à la PRÉSENTATION du document. */
  const companyLocale = await getSingleton(Company);
  const presentation = [
    {
      role: SIGNER_ROLE.DEVELOPER,
      displayName: signerFullName(snapshot.developer),
      companyName: snapshot.developer.companyName,
      logo: identiteDev.logoUrl || '',
      email: snapshot.developer.email,
      color: '#7c3aed',
    },
    {
      role: SIGNER_ROLE.CLIENT,
      displayName: signerFullName(snapshot.client),
      companyName: snapshot.client.companyName,
      /**
       * LE LOGO RESTE CELUI DU SITE, et c’est correct : c’est une donnée de
       * PRÉSENTATION du document, pas une identité juridique. Il vient donc
       * toujours de la fiche locale, qui en est l’autorité.
       */
      logo: companyLocale?.logos?.header || '',
      email: snapshot.client.email,
      color: '#2563eb',
    },
  ];
  return { snapshot, presentation };
}

/**
 * Valide le contrat : verrouille PDF + zones + montants, fige le snapshot des
 * parties, passe en PENDING_DEV_SIGNATURE. Exige un PDF, ≥1 zone/ signataire, et
 * un signataire complet (prénom, nom, email) sur CHACUNE des deux fiches
 * Entreprise — sinon le contrat partirait en signature sans partie identifiée.
 */
export async function validateContract(contract, actor) {
  assertMutable(contract);
  if (!contract.document.originalFilename) throw ApiError.badRequest('PDF du contrat manquant.');

  if (!sm.signatureRequired(contract)) {
    // Signature NON requise dans SB Auto 06 : le document chargé est déjà
    // signé en externe, ou aucune signature supplémentaire n'est nécessaire.
    // Ni zones, ni signataires, ni Yousign — le contrat va droit au paiement.
    contract.signatureConfiguration.locked = true;
    contract.signature.status = SIGNATURE_STATUS.NONE;
    contract.status = sm.assertTransition(contract.status, S.INACTIVE);
    contract.updatedBy = actor?._id || null;
    await contract.save();
    await logContractAudit({
      contractId: contract._id,
      action: CONTRACT_AUDIT_ACTION.VALIDATED_LOCKED,
      actorType: AUDIT_ACTOR_TYPE.DEV,
      actorId: actor?._id,
      details: { signatureRequirement: 'NOT_REQUIRED' },
    });
    return contract;
  }

  const zones = contract.signatureConfiguration.zones || [];
  const errors = validateZones(zones, {
    pageCount: contract.document.pageCount,
    signerRolesPresent: [SIGNER_ROLE.DEVELOPER, SIGNER_ROLE.CLIENT],
  });
  if (errors.length) throw ApiError.badRequest('Zones de signature invalides.', { errors });

  // Fige l'identité des deux parties : à partir d'ici, les fiches Entreprise
  // peuvent évoluer sans jamais rétro-modifier ce contrat.
  const { snapshot, presentation } = await freezeSigners();
  contract.signersSnapshot = snapshot;
  contract.signatureConfiguration.signers = presentation;
  contract.signatureConfiguration.locked = true;
  contract.signature.status = SIGNATURE_STATUS.NONE;
  contract.status = sm.assertTransition(contract.status, S.PENDING_DEV_SIGNATURE);
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.VALIDATED_LOCKED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
  });
  return contract;
}

/**
 * Où renvoyer chaque signataire à la fin du flux Yousign.
 *
 * Chaque partie rentre CHEZ ELLE : le DEV sur sa liste de contrats, le client
 * sur son parcours d'activation. Yousign accepte `redirect_urls` au niveau du
 * signataire, ce qui rend ce dédoublement possible.
 *
 * Renvoie `null` si l'URL du manager n'est pas configurée : mieux vaut le
 * comportement d'origine (le signataire reste chez Yousign) qu'une URL bancale
 * du genre `https:///contrat/...`, qui ferait échouer la création de la demande
 * — donc la signature entière — pour un simple confort de navigation.
 *
 * Le retour ne PROUVE rien : c'est le webhook qui fait foi. Les pages de retour
 * interrogent le backend avant de conclure.
 */
/**
 * L'ADRESSE DE RETOUR — UNE SEULE, POUR LES DEUX SIGNATAIRES.
 *
 * == CE QUI A CHANGE, ET POURQUOI ON N'Y PERD RIEN ==========================
 *
 * Il y en avait six : trois par signataire (succes, erreur, refus), parce que
 * Yousign les acceptait. La plateforme de signature actuelle n'en accepte
 * qu'UNE, pour tout le document, et n'y ajoute AUCUN parametre -- mesure.
 *
 * Le parcours n'y perd rien, parce qu'il ne s'y fiait pas : la page de retour a
 * TOUJOURS interroge le backend plutot que de croire un `?status=success`. Un
 * parametre d'URL est ecrit par celui qui revient ; l'etat du contrat, non.
 *
 * -- POURQUOI UNE ROUTE NEUTRE PLUTOT QUE CELLE DU CLIENT ------------------
 *
 * Les deux signataires atterrissent au meme endroit. Les envoyer sur la page
 * du client ferait arriver le developpeur dans un ecran qui n'est pas le sien ;
 * les envoyer sur la liste des contrats ferait arriver le client dans un ecran
 * auquel il n'a pas acces. `/retour-signature` ne suppose rien : elle lit la
 * session, puis renvoie chacun chez lui.
 */
async function signatureReturnUrl() {
  const cfg = await getSingleton(SystemConfiguration);
  const managerUrl = (cfg.network?.managerUrl || '').trim().replace(/\/$/, '');
  if (!managerUrl) return null;
  return `${managerUrl}/retour-signature`;
}

/**
 * Lance le parcours de signature Yousign. Le DEV signe en premier. Persiste les
 * identifiants Yousign et renvoie le lien de signature du DEV. La signature n'est
 * JAMAIS considérée acquise ici : seul le webhook Yousign la confirmera.
 */
export async function startDevSignature(contract, actor) {
  if (!sm.signatureRequired(contract)) {
    throw ApiError.badRequest('Aucune signature n’est requise dans ce projet pour ce contrat.', {
      code: 'SIGNATURE_NOT_REQUIRED',
    });
  }
  if (contract.status !== S.PENDING_DEV_SIGNATURE) {
    throw ApiError.badRequest('Le contrat doit être validé et en attente de signature DEV.');
  }
  /**
   * LA SIGNATURE EST-ELLE DISPONIBLE ? -- la question ne nomme plus de
   * fournisseur. Elle sonde la CAPACITE, et c'est le Panel qui sait qui la sert.
   */
  await assertSignatureReady();
  if (contract.signature.requestId) {
    throw ApiError.badRequest('Une demande de signature existe déjà pour ce contrat.');
  }
  // Lecture + validation LOCALES avant tout appel externe : un PDF manquant,
  // vide ou corrompu doit être diagnostiqué ici, pas par un 400 Yousign opaque.
  const file = await resolveContractDocumentFile(contract, 'original');
  const result = await createContractSignatureRequest(
    contract,
    file,
    undefined,
    await signatureReturnUrl()
  );

  /**
   * ON ECRIT DANS `signature`, PLUS DANS `yousign`.
   *
   * `provider` est le champ qui rend tout le reste utilisable : c'est lui qui
   * dira, dans six mois, a qui parler pour relire ou annuler cette demande.
   * Sans lui, il faudrait essayer les fournisseurs l'un apres l'autre --
   * c'est-a-dire envoyer l'identifiant d'un contrat chez un fournisseur qui ne
   * le connait pas.
   */
  contract.signature.provider = result.provider;
  contract.signature.requestId = result.signatureRequestId;
  contract.signature.documentId = result.documentId;
  contract.signature.devSignerId = result.devSignerId;
  contract.signature.clientSignerId = result.adminSignerId;
  contract.signature.status = SIGNATURE_STATUS.ONGOING;
  // Un FAIT constaté : la plateforme ramène-t-elle le signataire ? L'écran doit
  // pouvoir dire « revenez de vous-même » plutôt que promettre un retour qui
  // n'arrivera pas.
  contract.signature.autoReturn = Boolean(result.autoReturn);
  contract.updatedBy = actor?._id || null;
  await contract.save();

  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.DEV_SIGNATURE_STARTED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
  });

  const devLink = (result.signers || []).find((s) => s.id === result.devSignerId)?.signature_link || null;
  return { contract, signatureLink: devLink };
}

/**
 * Récupère le lien de signature ADMIN (2ᵉ signataire). Disponible seulement une
 * fois la signature DEV effectuée (ordre imposé). Interroge Yousign en direct.
 */
export async function getAdminSignatureLink(contract) {
  if (!contract.signature.requestId || !contract.signature.clientSignerId) {
    throw ApiError.badRequest('Signature non initialisée.');
  }
  if (!sm.isDevSigned(contract)) {
    throw ApiError.badRequest("En attente de la signature de l'équipe technique.");
  }
  // Lecture PAR LE PANEL : ce projet n'a plus de clé pour interroger Yousign.
  // Lecture PAR LE PANEL : ce projet n'a de cle chez aucun fournisseur.
  return getSignerLink(
    contract.signature.requestId,
    contract.signature.clientSignerId
  );
}

/**
 * Relance la signature d'un contrat en ÉCHEC (refusée/expirée/annulée). Réinitialise
 * le bloc yousign et repasse le contrat en PENDING_DEV_SIGNATURE ; le DEV peut alors
 * relancer la signature (nouvelle demande Yousign). La config reste verrouillée.
 */
export async function restartSignature(contract, actor) {
  if (contract.status !== S.FAILED) {
    throw ApiError.badRequest('Seul un contrat en échec de signature peut être relancé.');
  }
  /**
   * ON REMET `signature` A PLAT, PAS `yousign`.
   *
   * Le bloc historique n'est plus ecrit : le laisser intact preserve la trace
   * de ce qu'etait le contrat avant la bascule, et la relance ouvre une demande
   * chez le fournisseur ACTIF -- dont l'identite sera inscrite par l'ouverture.
   */
  contract.signature = {
    provider: null,
    requestId: null,
    documentId: null,
    devSignerId: null,
    clientSignerId: null,
    status: SIGNATURE_STATUS.NONE,
    devSignedAt: null,
    clientSignedAt: null,
    // Remis à plat comme le reste : la prochaine demande constatera elle-même
    // ce que Yousign accepte. Le garder vrai promettrait un retour automatique
    // sur une demande qui n'existe pas encore.
    autoReturn: false,
  };
  contract.status = sm.assertTransition(contract.status, S.PENDING_DEV_SIGNATURE);
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.SIGNATURE_RESTARTED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id,
  });
  return contract;
}

// --- Suppression / archivage ------------------------------------------------

/**
 * Supprime OU archive selon la valeur légale/financière :
 *  - DRAFT jamais signé et sans transaction -> suppression physique possible ;
 *  - sinon (signé, payé, actif, terminé) -> archivage (soft-delete) ;
 *  - contrat vivant (ACTIVE / CANCEL_AT_PERIOD_END) -> interdit (résilier d'abord).
 */
export async function removeOrArchive(contract, actor) {
  if (LIVE_CONTRACT_STATUSES.includes(contract.status)) {
    throw ApiError.badRequest('Un contrat actif ne peut être supprimé : résiliez-le.');
  }
  const hasValue =
    contract.status !== S.DRAFT ||
    Boolean(signatureOf(contract).requestId) ||
    Boolean(contract.stripe.customerId) ||
    Boolean(contract.stripe.launchFee.paymentIntentId) ||
    Boolean(contract.stripe.subscription.subscriptionId);

  if (hasValue) {
    contract.archived = true;
    contract.archivedAt = new Date();
    contract.updatedBy = actor?._id || null;
    await contract.save();
    await logContractAudit({
      contractId: contract._id,
      action: CONTRACT_AUDIT_ACTION.ARCHIVED,
      actorType: AUDIT_ACTOR_TYPE.DEV,
      actorId: actor?._id,
    });
    return { archived: true };
  }
  await deleteContractStorage(contract._id);
  await Contract.deleteOne({ _id: contract._id });
  return { deleted: true };
}

// --- Activation finale ------------------------------------------------------

/**
 * Active le site : REVÉRIFIE toutes les conditions côté backend (jamais sur la
 * seule foi du front), passe le contrat en ACTIVE, garantit l'unicité du contrat
 * vivant. Le basculement effectif du site est délégué à l'enforcement.
 */
export async function activateContract(contract, actor) {
  if (!sm.canActivate(contract)) {
    throw ApiError.badRequest("Conditions d'activation non réunies.", {
      step: sm.deriveActivationStep(contract),
    });
  }
  // Unicité : aucun autre contrat vivant.
  const other = await Contract.findOne({
    _id: { $ne: contract._id },
    status: { $in: LIVE_CONTRACT_STATUSES },
    archived: false,
  });
  if (other) throw ApiError.conflict('Un autre contrat est déjà actif.');

  contract.status = sm.assertTransition(contract.status, S.ACTIVE);
  contract.activation.activatedAt = new Date();
  contract.activation.activatedBy = actor?._id || null;
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.ACTIVATED,
    actorType: actor?.role === 'DEV' ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.ADMIN,
    actorId: actor?._id,
  });
  return contract;
}

/**
 * Résiliation — comportement PAR ENVIRONNEMENT (LOT recette) :
 *
 *  - PROD (comportement historique, strictement inchangé) : annulation Stripe
 *    EN FIN DE PÉRIODE, contrat en CANCEL_AT_PERIOD_END, le site reste actif
 *    jusqu'à l'échéance ; la suspension effective survient à la fin de période,
 *    confirmée par webhook.
 *
 *  - TEST (ENV applicatif, jamais contract.environment) : résiliation
 *    IMMÉDIATE pour rejouer les scénarios sans attendre un mois — abonnement
 *    Stripe annulé immédiatement, contrat terminé (ENDED) et accès retiré
 *    immédiatement, via le MÊME chemin canonique que la fin d'échéance
 *    (`settleFromSubscription`). Cette logique ne s'applique JAMAIS en PROD.
 */
export async function requestCancellation(contract, actor) {
  if (contract.status !== S.ACTIVE) {
    throw ApiError.badRequest('Seul un contrat actif peut être résilié.');
  }
  /**
   * LA DOCTRINE DES UTILISATEURS ORDINAIRES — inchangée.
   *
   * En recette, une résiliation prend effet tout de suite : c'est ce qui rend
   * un parcours rejouable. En production, elle prend effet à l'échéance, parce
   * qu'un client a payé jusque-là.
   *
   * Un DEV qui doit corriger une erreur passe par `cancelContractImmediately`,
   * qui est une exception ADMINISTRATIVE explicite — et non un assouplissement
   * de cette règle-ci.
   */
  if (config.isTest) {
    return performImmediateCancellation(
      contract, actor, CANCELLATION_AUTHORITY.ORDINARY_TEST_DOCTRINE,
    );
  }
  if (contract.stripe.subscription.subscriptionId) {
    /**
     * L6.2G — la résiliation passe par le Panel, qui vérifie que l'abonnement
     * nous appartient AVANT d'y toucher, puis relit son état pour ne jamais
     * couper deux fois. `ALREADY_CANCELLED` est un succès : il signifie que
     * l'acte était déjà inscrit et qu'aucune seconde mutation n'a été émise.
     */
    await cancelSubscriptionViaPanel({
      subscriptionId: contract.stripe.subscription.subscriptionId,
      mode: 'AT_PERIOD_END',
    });
    contract.stripe.subscription.cancelAtPeriodEnd = true;
    contract.stripe.subscription.cancelledAt = new Date();
  }
  contract.status = sm.assertTransition(contract.status, S.CANCEL_AT_PERIOD_END);
  contract.updatedBy = actor?._id || null;
  await contract.save();
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CANCELLATION_REQUESTED,
    actorType: actor?.role === 'DEV' ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.ADMIN,
    actorId: actor?._id,
    metadataSafe: { endsAt: contract.stripe.subscription.currentPeriodEnd },
  });

  // Événement métier — APRÈS la réussite, en best-effort. `emitSafe` n'échoue
  // jamais vers l'appelant : une résiliation actée chez Stripe ne sera pas annulée
  // parce que le journal a hoqueté. Aucune action n'y est branchée à ce stade
  // (les e-mails viendront au lot templates) : l'événement est donc une trace, et
  // le comportement de la résiliation est strictement inchangé.
  const periodEnd = contract.stripe.subscription.currentPeriodEnd;
  await emitSafe({
    type: 'contract.cancel_requested',
    entityType: 'Contract',
    entityId: contract._id,
    actor: actor
      ? { type: EVENT_ACTOR_TYPE.USER, id: actor._id, role: actor.role }
      : { type: EVENT_ACTOR_TYPE.SYSTEM },
    payloadSafe: {
      reference: contract.reference || '',
      cancelledByRole: actor?.role === 'DEV' ? 'DEV' : actor?.role === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
      currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    },
    // Une seule demande de résiliation par contrat et par date d'effet : un
    // double clic ne produit pas deux faits.
    idempotencyKey: `contract-cancel-requested:${contract._id}:${contract.stripe.subscription.cancelledAt?.toISOString() || ''}`,
  });

  return contract;
}

/**
 * LES DEUX SEULES AUTORISATIONS QUI OUVRENT LA RÉSILIATION IMMÉDIATE.
 *
 * Table FERMÉE, et c'est tout son intérêt : ajouter une entrée est un geste
 * délibéré, relu, qui oblige à écrire au nom de quoi on agit. Un test
 * structurel vérifie qu'aucun appelant n'en invente une troisième.
 */
const CANCELLATION_AUTHORITY = Object.freeze({
  /** La doctrine des utilisateurs ordinaires : immédiat en recette, seulement. */
  ORDINARY_TEST_DOCTRINE: 'ORDINARY_TEST_DOCTRINE',
  /** L'exception administrative : permission DEV explicite, TEST comme PROD. */
  DEV_ADMINISTRATIVE: 'DEV_ADMINISTRATIVE',
});

/**
 * RÉSILIATION IMMÉDIATE — le geste, sans la question de savoir QUI y a droit.
 *
 * ══ CE QUE CETTE FONCTION NE DÉCIDE PLUS ════════════════════════════════════
 *
 * Elle portait sa propre garde : `if (!config.isTest) throw`. L'autorisation
 * était donc adossée à l'ENVIRONNEMENT — une notion qui ne dit rien des droits
 * de celui qui agit. Un développeur autorisé ne pouvait pas corriger en PROD un
 * contrat créé par erreur ; il fallait attendre l'échéance d'un engagement qui
 * n'aurait jamais dû exister.
 *
 * La décision remonte donc aux deux points d'entrée, qui savent, eux, au nom de
 * qui ils agissent :
 *
 *   · `requestCancellation`         — la doctrine des utilisateurs ordinaires,
 *     strictement inchangée : immédiat en TEST, fin de période en PROD ;
 *   · `cancelContractImmediately`   — l'exception administrative, réservée à
 *     une permission DEV explicite, et valable dans les deux mondes.
 *
 * Ce qui suit reste le chemin CANONIQUE : annulation Stripe immédiate
 * (best-effort — l'état distant doit suivre le local), puis
 * `settleFromSubscription` avec un objet « canceled ». Statuts, timeline,
 * CONTRACT_ENDED et réconciliation du site suivent exactement la production.
 * Aucune écriture directe d'état.
 */
async function performImmediateCancellation(contract, actor, authority) {
  /**
   * ── ON NE PEUT PLUS APPELER CETTE PRIMITIVE SANS DIRE AU NOM DE QUOI ─────
   *
   * La garde d'environnement a été retirée à juste titre : elle confondait une
   * propriété du monde avec un droit. Mais la retirer laissait une primitive
   * NUE — et la prochaine personne qui aurait besoin d'une résiliation
   * immédiate aurait pu l'appeler sans qu'aucune ligne ne le lui rappelle.
   *
   * Plutôt que de recopier la vérification de rôle (deux copies divergent
   * toujours), l'appelant doit NOMMER l'autorisation dont il se réclame. La
   * table est fermée, et un appel qui n'en nomme aucune ne compile pas dans sa
   * tête : il échoue franchement, à la première exécution, avec la raison.
   *
   * C'est une erreur de PROGRAMMATION, pas un refus métier : elle ne devient
   * jamais un 403 rendu à un utilisateur. Personne ne doit pouvoir la
   * provoquer depuis le réseau.
   */
  if (!CANCELLATION_AUTHORITY[authority]) {
    throw new Error(
      'performImmediateCancellation : autorisation non nommée. '
      + `Attendu l'une de : ${Object.keys(CANCELLATION_AUTHORITY).join(', ')}.`,
    );
  }

  const subId = contract.stripe.subscription.subscriptionId || null;
  const periodEnd = contract.stripe.subscription.currentPeriodEnd || null;
  const now = Math.floor(Date.now() / 1000);

  if (subId) {
    try {
      /**
       * L6.2G — la coupure immédiate passe par le Panel. C'est elle qui portait
       * le plus vieux défaut connu du parc : aucune clé d'idempotence, plusieurs
       * appelants, et un double clic qui produisait deux appels réels.
       *
       * Le `catch` est CONSERVÉ, et c'est délibéré : la politique existante veut
       * qu'un échec distant n'empêche pas la fin locale du contrat. Le changer
       * ici serait modifier une décision métier sous couvert de migration.
       */
      await cancelSubscriptionViaPanel({ subscriptionId: subId, mode: 'NOW' });
    } catch (err) {
      logger.warn(`Résiliation : annulation Stripe immédiate impossible (${err?.message}). Poursuite en local.`);
    }
  }
  contract.stripe.subscription.cancelledAt = new Date();

  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CANCELLATION_REQUESTED,
    actorType: actor?.role === 'DEV' ? AUDIT_ACTOR_TYPE.DEV : AUDIT_ACTOR_TYPE.ADMIN,
    actorId: actor?._id,
    metadataSafe: { immediate: true, environment: config.env },
  });

  // Fin effective immédiate : ENDED + SUBSCRIPTION_ENDED + suspension du site.
  await settleFromSubscription(
    contract,
    {
      id: subId,
      status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: now,
      canceled_at: now,
    },
    { actor }
  );

  // Même événement métier que la résiliation standard, marqué « immediate ».
  await emitSafe({
    type: 'contract.cancel_requested',
    entityType: 'Contract',
    entityId: contract._id,
    actor: actor
      ? { type: EVENT_ACTOR_TYPE.USER, id: actor._id, role: actor.role }
      : { type: EVENT_ACTOR_TYPE.SYSTEM },
    payloadSafe: {
      reference: contract.reference || '',
      cancelledByRole: actor?.role === 'DEV' ? 'DEV' : actor?.role === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
      currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
      immediate: true,
      environment: config.env,
    },
    idempotencyKey: `contract-cancel-requested:${contract._id}:${contract.stripe.subscription.cancelledAt?.toISOString() || ''}`,
  });

  return Contract.findById(contract._id);
}

/**
 * RÉSILIATION IMMÉDIATE PAR UN DEV — l'exception administrative, y compris en PROD.
 *
 * ══ LE BESOIN, ET POURQUOI L'ENVIRONNEMENT NE POUVAIT PAS Y RÉPONDRE ════════
 *
 * Un contrat créé ou configuré par erreur en production devait attendre son
 * échéance pour disparaître. La garde en place raisonnait sur
 * l'ENVIRONNEMENT — `if (!config.isTest)` — c'est-à-dire sur une propriété du
 * MONDE, qui ne dit rien des droits de celui qui agit. Elle empêchait donc
 * exactement la personne qui a la responsabilité de corriger.
 *
 * ══ CE QUI REMPLACE LA GARDE, ET CE QUI NE CHANGE PAS ═══════════════════════
 *
 * La condition devient une PERMISSION : `role === DEV`. Ce n'est pas
 * « en PROD, on autorise » — c'est « un DEV autorisé peut corriger, où qu'il
 * soit ». La différence compte : la doctrine des utilisateurs ordinaires
 * (`requestCancellation`) n'est pas touchée d'un octet, et un ADMIN qui
 * appellerait ce chemin est refusé, en TEST comme en PROD.
 *
 * La vérification est FAITE ICI, dans le service. Un contrôle qui ne vivrait
 * que dans la route ou dans le bouton laisserait un appel direct passer.
 *
 * ══ IDEMPOTENCE ════════════════════════════════════════════════════════════
 *
 * Un contrat déjà terminé n'est pas une erreur : c'est l'état voulu. On le dit
 * et on s'arrête — sans seconde annulation Stripe, sans second événement, sans
 * seconde facturation, et sans transition d'état interdite.
 */
export async function cancelContractImmediately(contract, actor, { reason = null } = {}) {
  if (actor?.role !== ROLES.DEV) {
    throw ApiError.forbidden(
      'La résiliation immédiate est réservée aux comptes développeur.',
    );
  }

  // DÉJÀ TERMINÉ — réponse stable, aucune mutation. Voir « idempotence ».
  if (contract.status === S.ENDED || contract.status === S.CANCELLED) {
    return { contract, alreadyEnded: true, status: contract.status };
  }

  if (contract.status !== S.ACTIVE && contract.status !== S.CANCEL_AT_PERIOD_END) {
    throw ApiError.badRequest(
      `Un contrat au statut ${contract.status} ne peut pas être résilié immédiatement.`,
    );
  }

  const statutAvant = contract.status;

  /**
   * L'AUDIT EST ÉCRIT AVANT L'EFFET, et il nomme l'exception.
   *
   * `performImmediateCancellation` journalise déjà une demande de résiliation ;
   * celle-ci est d'une autre nature — une correction administrative en
   * production — et doit se distinguer dans le registre. Une trace posée après
   * coup manquerait précisément le cas où l'opération échoue à mi-chemin.
   */
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.CANCELLATION_REQUESTED,
    actorType: AUDIT_ACTOR_TYPE.DEV,
    actorId: actor?._id ?? null,
    metadataSafe: {
      immediate: true,
      administrative: true,
      environment: config.env,
      previousStatus: statutAvant,
      ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
    },
  });

  const frais = await performImmediateCancellation(
    contract, actor, CANCELLATION_AUTHORITY.DEV_ADMINISTRATIVE,
  );
  return {
    contract: frais,
    alreadyEnded: false,
    previousStatus: statutAvant,
    status: frais?.status ?? S.ENDED,
  };
}

/** Marque le début du parcours d'activation (INACTIVE -> ACTIVATION_IN_PROGRESS). */
export async function beginActivation(contract) {
  if (contract.status === S.INACTIVE) {
    contract.status = sm.assertTransition(contract.status, S.ACTIVATION_IN_PROGRESS);
    await contract.save();
  }
  return contract;
}

/** Vue d'activation (étape dérivée + résumé). */
export function activationView(contract) {
  return {
    step: sm.deriveActivationStep(contract),
    signed: sm.isFullySigned(contract),
    devSigned: sm.isDevSigned(contract),
    adminSigned: sm.isAdminSigned(contract),
    launchFeeRequired: sm.launchFeeRequired(contract),
    launchFeeSatisfied: sm.launchFeeSatisfied(contract),
    subscriptionRequired: sm.subscriptionRequired(contract),
    subscriptionSatisfied: sm.subscriptionSatisfied(contract),
    canActivate: sm.canActivate(contract),
  };
}

/** Le contrat « vivant » (ACTIVE / CANCEL_AT_PERIOD_END), ou null. */
export function findLiveContract() {
  return Contract.findOne({ status: { $in: LIVE_CONTRACT_STATUSES }, archived: false });
}

/**
 * Le contrat exposé à l'ADMIN : le vivant en priorité, sinon le plus récent
 * non archivé et non terminé — Y COMPRIS un BROUILLON ou un contrat en attente de
 * signature. L'ADMIN peut ainsi suivre la préparation (« en préparation »,
 * « en attente de signature ») en LECTURE SEULE, même avant activation et même
 * si Stripe/Yousign ne sont pas encore branchés.
 */
export async function findAdminContract() {
  const live = await findLiveContract();
  if (live) return live;
  return Contract.findOne({
    archived: false,
    status: { $in: [S.DRAFT, S.PENDING_DEV_SIGNATURE, S.INACTIVE, S.ACTIVATION_IN_PROGRESS] },
  }).sort({ updatedAt: -1 });
}

/**
 * Sérialisation sûre d'un contrat pour le frontend. Ne contient aucun secret.
 * Les documents sont exposés comme drapeaux + URLs d'endpoints authentifiés
 * (jamais de chemin disque public).
 */
/**
 * LA VUE DE SIGNATURE RENDUE AUX ECRANS.
 *
 * Une seule fabrique, alimentee par `signatureOf` : peu importe que le contrat
 * porte sa signature dans le bloc moderne ou dans l'historique, l'ecran voit la
 * meme chose. Sans elle, un contrat signe l'an dernier afficherait « aucune
 * signature » -- sans erreur, sans journal, sur un objet juridique.
 */
function signatureView(c, role) {
  const sig = signatureOf(c);
  return {
    /** QUI a servi l'acte. `null` tant qu'aucune demande n'est ouverte. */
    provider: sig.provider,
    status: sig.status,
    signatureState: sm.deriveSignatureState(c),
    devSignedAt: sig.devSignedAt || null,
    adminSignedAt: sig.clientSignedAt || null,
    clientSignedAt: sig.clientSignedAt || null,
    hasRequest: Boolean(sig.requestId),
    /**
     * Le signataire sera-t-il ramene ici automatiquement ? Un FAIT constate a
     * l'ouverture, pas un reglage : si la plateforme refuse les redirections,
     * l'ecran doit demander a l'utilisateur de revenir de lui-meme plutot que
     * de lui promettre un retour qui n'arrivera pas.
     */
    autoReturn: Boolean(sig.autoReturn),
    // Detail des signataires (statut par partie) -- pour les panneaux Manager.
    signers: (c.signatureConfiguration?.signers || []).map((s) => ({
      role: s.role,
      displayName: s.displayName,
      companyName: s.companyName,
      email: s.email,
      signed: s.role === 'DEVELOPER' ? Boolean(sig.devSignedAt) : Boolean(sig.clientSignedAt),
      signedAt: s.role === 'DEVELOPER' ? sig.devSignedAt || null : sig.clientSignedAt || null,
    })),
    // L'identifiant technique de la demande n'est expose qu'au DEV (support).
    ...(role === 'DEV' ? { signatureRequestId: sig.requestId || null } : {}),
  };
}

export function serializeContract(contract, { role } = {}) {
  const c = contract.toObject ? contract.toObject() : contract;
  const base = `/api/contracts/${c._id}/documents`;
  return {
    _id: c._id,
    reference: c.reference,
    name: c.name || c.reference,
    status: c.status,
    signatureRequirement: c.signatureRequirement || 'REQUIRED',
    signatureApplicable: sm.signatureRequired(c),
    archived: c.archived,
    environment: c.environment,
    /**
     * CE QUI EXISTE, pas ce qui est écrit en base.
     *
     * Ces drapeaux ne venaient que des métadonnées : un document référencé mais
     * absent du stockage affichait un bouton « Télécharger » qui répondait 404
     * au clic. On croise donc la base ET le disque, comme le fait déjà la
     * projection envoyée au Panel — un seul et même critère des deux côtés.
     *
     * `referenced*` conserve ce que la base dit : c'est ce qui permet de
     * distinguer « jamais généré » de « généré puis introuvable », deux
     * situations qui n'appellent pas la même réponse.
     */
    document: {
      hasOriginal: docs.documentExistsSync(c, 'ORIGINAL'),
      hasSigned: docs.documentExistsSync(c, 'SIGNED'),
      referencedOriginal: Boolean(c.document?.originalFilename),
      referencedSigned: Boolean(c.document?.signedFilename),
      pageCount: c.document?.pageCount || 0,
      pageSizes: c.document?.pageSizes || [],
      signedFetchedAt: c.document?.signedFetchedAt || null,
      originalUrl: docs.documentExistsSync(c, 'ORIGINAL') ? `${base}/original` : null,
      signedUrl: docs.documentExistsSync(c, 'SIGNED') ? `${base}/signed` : null,
      /**
       * LA PREUVE D'AUDIT — annoncée comme les autres pièces : sur ce qui EXISTE.
       *
       * `hasCertificate` croise la base ET le disque, exactement comme les deux
       * autres : un fichier référencé mais absent afficherait un bouton qui
       * répond 404 au clic.
       *
       * Les contrats signés chez le fournisseur historique n'en ont pas. Ce
       * n'est pas un défaut du dossier : leur preuve vit dans l'espace du
       * compte, et `referencedCertificate` à faux dit « il n'y en a jamais eu »
       * là où `hasCertificate` seul aurait dit « introuvable ».
       */
      hasCertificate: docs.documentExistsSync(c, 'CERTIFICATE'),
      referencedCertificate: Boolean(c.document?.certificateFilename),
      certificateFetchedAt: c.document?.certificateFetchedAt || null,
      certificateUrl: docs.documentExistsSync(c, 'CERTIFICATE') ? `${base}/certificate` : null,
    },
    signatureConfiguration: {
      version: c.signatureConfiguration?.version || 0,
      versionCount: (c.signatureConfiguration?.versions || []).length,
      locked: Boolean(c.signatureConfiguration?.locked),
      signers: c.signatureConfiguration?.signers || [],
      zones: c.signatureConfiguration?.zones || [],
    },
    // Identité figée des parties (null tant que le contrat n'est pas validé).
    signersSnapshot: {
      developer: c.signersSnapshot?.developer || null,
      client: c.signersSnapshot?.client || null,
    },
    /**
     * LA TARIFICATION — avec une récurrence TOUJOURS résolue.
     *
     * La ligne d'abonnement voyage telle quelle, à une chose près : sa
     * récurrence est celle que `recurrenceOf` a tranchée, jamais le champ brut.
     * Un contrat non encore migré porte `recurrence: undefined` en base ; le
     * laisser passer ainsi aurait obligé chaque écran — Manager DEV, parcours
     * client, Panel — à refaire le repli sur l'héritage pour son compte. Trois
     * replis, trois occasions de diverger, et la divergence porterait sur le
     * montant qu'un client voit.
     *
     * La règle de priorité vit à UN endroit, et c'est le serveur qui la rend.
     */
    pricing: {
      launchFee: c.pricing?.launchFee,
      subscription: {
        ...(c.pricing?.subscription?.toObject?.() ?? c.pricing?.subscription ?? {}),
        recurrence: recurrenceOf(c.pricing?.subscription),
      },
    },
    taxRate: c.taxRate,
    // `null` voyage tel quel : l'écran doit pouvoir dire « aucune politique »
    // plutôt qu'afficher un 0 qui signifierait l'inverse (fermeture au premier
    // refus).
    paymentGraceDays: Number.isInteger(c.paymentGraceDays) ? c.paymentGraceDays : null,
    /**
     * == LA SIGNATURE, SOUS DEUX NOMS, ET C'EST TEMPORAIRE =================
     *
     * `signature` est la forme cible : neutre, portant le fournisseur.
     * `yousign` est un MIROIR, rendu a l'identique le temps que le Manager
     * migre. Les deux lisent la MEME source (`signatureOf`), donc ils ne
     * peuvent pas diverger -- ce qui est exactement le risque qu'un miroir
     * introduit d'habitude.
     *
     * Le miroir disparait avec l'ecran qui le consomme, pas avant : le
     * supprimer d'abord ferait afficher « aucune signature » sur chaque
     * contrat, sur une interface deployee separement du backend.
     */
    signature: signatureView(c, role),
    yousign: signatureView(c, role),
    stripe: {
      launchFee: {
        status: c.stripe?.launchFee?.status,
        paidAt: c.stripe?.launchFee?.paidAt || null,
        attempt: c.stripe?.launchFee?.attempt || 0,
        lastError: c.stripe?.launchFee?.lastError || null,
        // Identifiants techniques réservés au DEV (support) — jamais à l'ADMIN.
        ...(role === 'DEV'
          ? {
              paymentId: c.stripe?.launchFee?.paymentId || null,
              checkoutSessionId: c.stripe?.launchFee?.checkoutSessionId || null,
              paymentIntentId: c.stripe?.launchFee?.paymentIntentId || null,
            }
          : {}),
      },
      subscription: {
        status: c.stripe?.subscription?.status,
        currentPeriodStart: c.stripe?.subscription?.currentPeriodStart || null,
        currentPeriodEnd: c.stripe?.subscription?.currentPeriodEnd || null,
        cancelAtPeriodEnd: Boolean(c.stripe?.subscription?.cancelAtPeriodEnd),
        cancelledAt: c.stripe?.subscription?.cancelledAt || null,
        endedAt: c.stripe?.subscription?.endedAt || null,
        lastError: c.stripe?.subscription?.lastError?.message
          ? { message: c.stripe.subscription.lastError.message, at: c.stripe.subscription.lastError.at }
          : null,
        // Identifiants techniques réservés au DEV (support).
        ...(role === 'DEV'
          ? {
              subscriptionId: c.stripe?.subscription?.subscriptionId || null,
              productId: c.stripe?.subscription?.productId || null,
              priceId: c.stripe?.subscription?.priceId || null,
              latestInvoiceId: c.stripe?.subscription?.latestInvoiceId || null,
            }
          : {}),
      },
      // Le customerId Stripe n'est utile qu'au DEV (support).
      ...(role === 'DEV' ? { customerId: c.stripe?.customerId || null } : {}),
    },
    activation: c.activation,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...activationView(c),
  };
}

// --- Timeline ---------------------------------------------------------------

/** Libellés FR des actions d'audit pour la timeline. */
const TIMELINE_LABELS = Object.freeze({
  CREATED: 'Contrat créé',
  DOCUMENT_UPLOADED: 'Document PDF importé',
  SIGNATURE_CONFIGURED: 'Zones de signature configurées',
  VALIDATED_LOCKED: 'Configuration validée et verrouillée',
  DEV_SIGNATURE_STARTED: 'Signature lancée',
  DEV_SIGNED: 'Signé par l’équipe technique',
  ADMIN_SIGNED: 'Signé par le client',
  FULLY_SIGNED: 'Contrat signé par les deux parties',
  SIGNED_PDF_FETCHED: 'PDF signé récupéré',
  SIGNATURE_FAILED: 'Signature refusée / expirée / annulée',
  SIGNATURE_RESTARTED: 'Signature relancée',
  CHECKOUT_CREATED: 'Session de paiement créée',
  PAYMENT_PROCESSING: 'Paiement en cours de confirmation',
  PAYMENT_SUCCEEDED: 'Frais de lancement payés',
  PAYMENT_FAILED: 'Paiement des frais de lancement échoué',
  PAYMENT_CANCELLED: 'Paiement annulé',
  PAYMENT_REFUNDED: 'Frais de lancement remboursés',
  PAYMENT_SYNCED: 'Paiement synchronisé',
  SUBSCRIPTION_CHECKOUT_CREATED: 'Souscription abonnement créée',
  SUBSCRIPTION_ACTIVATED: 'Abonnement actif',
  SUBSCRIPTION_PAYMENT_SUCCEEDED: "Paiement d'abonnement confirmé",
  SUBSCRIPTION_PAYMENT_FAILED: "Paiement d'abonnement échoué",
  SUBSCRIPTION_PAST_DUE: 'Abonnement en impayé',
  SUBSCRIPTION_ENDED: 'Abonnement terminé',
  SUBSCRIPTION_SYNCED: 'Abonnement synchronisé',
  ACTIVATED: 'Site activé',
  BILLING_PORTAL_OPENED: 'Espace de facturation Stripe ouvert',
  CANCELLATION_REQUESTED: 'Résiliation demandée',
  CANCELLATION_REVOKED: 'Résiliation annulée',
  CONTRACT_ENDED: 'Contrat terminé',
  SITE_SUSPENDED: 'Site suspendu automatiquement',
  SITE_ACTIVATED: 'Site activé',
  RECONCILED: 'Synchronisation',
  ARCHIVED: 'Contrat archivé',
  /**
   * ══ LES ACTIONS QUI N'AVAIENT PAS DE LIBELLÉ ══════════════════════════════
   *
   * `TIMELINE_LABELS[l.action] || l.action` ne casse jamais : il affiche
   * l'énumération BRUTE. Une action ajoutée sans son libellé passe donc tous
   * les tests et sort en production — mesuré sur la pile déployée, où la
   * timeline du client portait `BILLING_PORTAL_OPENED` en majuscules.
   * `billing-portal.test.js` §3 refuse désormais toute action sans libellé.
   */
  SIGNATURE_CERTIFICATE_FETCHED: 'Certificat de signature récupéré',
  CONTRACT_PROTECTION_CHANGED: 'Protection contractuelle modifiée',
  PAYMENT_GRACE_POLICY_CHANGED: 'Délai de grâce impayé modifié',
  SITE_MANUAL_SUSPENSION_APPLIED: 'Suspension manuelle posée',
  SITE_MANUAL_SUSPENSION_LIFTED: 'Suspension manuelle levée',
});

/**
 * Timeline d'un contrat : journal d'audit ordonné (du plus ancien au plus
 * récent), avec libellés lisibles. Ne contient jamais de secret (métadonnées
 * sûres uniquement, cf. ContractAuditLog).
 */
export async function getContractTimeline(contractId) {
  const logs = await ContractAuditLog.find({ contractId }).sort({ createdAt: 1 }).lean();
  return logs.map((l) => ({
    action: l.action,
    label: TIMELINE_LABELS[l.action] || l.action,
    actorType: l.actorType,
    provider: l.provider || null,
    at: l.createdAt,
    meta: l.metadataSafe || null,
  }));
}

export { REQUIRED_INTEGRATIONS };
