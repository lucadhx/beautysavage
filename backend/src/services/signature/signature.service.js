// SIGNATURE — ce projet ne parle à AUCUN fournisseur, il DEMANDE au Panel.
//
// docs/R10_5_FINAL_EMAIL_AND_YOUSIGN_CONTROL_PLANE_REPORT.md, puis
// docs/OPENSIGN_MIGRATION.md (bascule OpenSign).
//
// ══ CE MODULE NE SAIT PAS QUI SIGNE, ET C'EST LE POINT ══════════════════════
//
// Il s'appelait `yousign.service.js`. Le nom était devenu faux : depuis la
// bascule, une nouvelle demande part chez OpenSign, une ancienne reste chez
// Yousign, et ce fichier ne fait ni l'un ni l'autre — il demande une CAPACITÉ.
//
// Le renommage n'est pas cosmétique. Un module nommé d'après un fournisseur
// invite à y écrire une particularité de ce fournisseur ; c'est exactement ce
// qui était arrivé, et qu'on retire plus bas.
//
// ══ CE QUI A CHANGÉ, ET CE QUI N'A PAS BOUGÉ ════════════════════════════════
//
// Ce module était un client Yousign : il lisait une clé locale, construisait des
// requêtes HTTP, orchestrait création/document/signataires/champs/activation, et
// nettoyait ses brouillons.
//
// Il est devenu une FAÇADE de plan de contrôle. Il demande un verbe au Panel,
// qui choisit le monde, ouvre son coffre, vérifie l'appartenance, réserve
// l'opération et parle au fournisseur.
//
// Ce qui n'a pas bougé : la SIGNATURE des fonctions exportées. `contract.service`,
// `contractWebhook.service`, `reconciliation.service` et `contractTestTools`
// appellent exactement les mêmes noms avec les mêmes arguments. C'est délibéré —
// migrer cinq appelants en même temps que le transport aurait mêlé deux
// changements dont l'un seul est risqué, et rendu toute régression ambiguë.
//
// ══ CE QUI RESTE LÉGITIMEMENT ICI ═══════════════════════════════════════════
//
// L'identité des signataires vient du SNAPSHOT contractuel figé à la validation,
// jamais des fiches Entreprise vivantes. Le placement des zones vient de la
// configuration du contrat. Ce sont des règles MÉTIER de ce projet : les
// déplacer vers le Panel lui aurait fait porter une connaissance contractuelle
// qui ne le regarde pas.
//
// ══ CE QUI N'EST PLUS ICI, ET NE DOIT PAS REVENIR ═══════════════════════════
//
// Aucune clé d'appel, aucune URL Yousign, aucun `fetch`, aucun stub, aucun
// repli. Le jour où le Panel est injoignable, la signature échoue franchement —
// c'est la bonne réponse : un repli local supposerait une clé locale, et c'est
// exactement ce que ce lot supprime.
import { invokeCapability, capabilitiesAvailable } from '../panelBridge/capabilityClient.js';
import { mapZoneToField } from './signatureCoordinates.js';
import { SIGNATURE_STATUS, SIGNER_ROLE } from '../../utils/contractConstants.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';

/**
 * LA TAILLE MAXIMALE D'UN DOCUMENT.
 *
 * Elle est REDÉCLARÉE ici, et c'est assumé : le projet doit pouvoir refuser un
 * PDF hors gabarit AVANT de l'encoder en base64 et de le pousser sur le pont.
 * Sans ce contrôle local, on transporterait 20 Mio pour s'entendre dire non.
 *
 * ══ POURQUOI ELLE A BAISSÉ ════════════════════════════════════════════════
 *
 * Elle valait 12 Mio — la borne de notre TRANSPORT. Le fournisseur retenu
 * refuse au-delà de 10 Mo, mesuré en bac à sable :
 * « File too large. Max allowed file size is 10 MB ».
 *
 * Garder 12 Mio aurait laissé passer un document de 11 Mo : le Panel l'aurait
 * accepté, aurait réservé le contrat, débité un crédit chez le fournisseur, et
 * n'aurait appris le refus qu'après — avec un message parlant du fournisseur
 * pour un problème qui est celui du PDF.
 *
 * La valeur fait autorité côté Panel — c'est lui qui tranche — et le contrôle
 * local n'est qu'une politesse pour l'appelant. Si les deux divergent, c'est le
 * Panel qui gagne, et le message vient de lui.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Traduit l'état RENDU PAR LE PANEL vers le statut interne.
 *
 * ══ CE QUI A CHANGÉ, ET POURQUOI C'ÉTAIT INDISPENSABLE ═══════════════════════
 *
 * Cette fonction traduisait le vocabulaire de Yousign — `ongoing`, `done`,
 * `canceled` — que le Panel relayait tel quel. C'était une fuite
 * d'implémentation restée invisible tant qu'il n'y avait qu'un fournisseur.
 *
 * OpenSign dit `in-progress`, `completed`, `declined`. La table d'avant y
 * répondait `NONE` sur CHAQUE état : sans erreur, sans journal, sans rien —
 * et le contrat serait resté « en cours » pour toujours.
 *
 * Le Panel TRADUIT désormais, et rend un `state` neutre. Ce module ne fait plus
 * que projeter ce vocabulaire commun sur le sien, et il ne changera plus quand
 * le fournisseur changera.
 *
 * ── LE REPLI SUR LE VOCABULAIRE HISTORIQUE ─────────────────────────────────
 *
 * Un Panel non encore déployé rend l'ancien `status` sans `state`. On continue
 * donc de lire les mots de Yousign quand le nouveau champ manque : c'est ce qui
 * permet de déployer les deux dépôts dans l'ordre qu'on veut, sans fenêtre où
 * les contrats cessent d'avancer.
 */
export function mapRequestStatus(etat) {
  switch (etat) {
    case 'DRAFT':
    case 'draft':
      return SIGNATURE_STATUS.DRAFT;
    case 'ONGOING':
    case 'ongoing':
    case 'approval':
      return SIGNATURE_STATUS.ONGOING;
    case 'DONE':
    case 'done':
      return SIGNATURE_STATUS.DONE;
    case 'DECLINED':
    case 'declined':
    case 'rejected':
      return SIGNATURE_STATUS.DECLINED;
    case 'EXPIRED':
    case 'expired':
      return SIGNATURE_STATUS.EXPIRED;
    case 'CANCELED':
    case 'canceled':
    case 'deleted':
      return SIGNATURE_STATUS.CANCELED;
    default:
      return SIGNATURE_STATUS.NONE;
  }
}

/**
 * Traduit une partie du snapshot contractuel en signataire.
 *
 * L'identité provient EXCLUSIVEMENT de `contract.signersSnapshot`, figé à la
 * validation : jamais des fiches Entreprise, qui peuvent avoir changé depuis.
 * Un snapshot vide ne peut venir que d'un contrat corrompu ou antérieur à la
 * configuration des signataires — on échoue ici plutôt que d'envoyer une
 * identité vide, que le Panel rejetterait avec un message plus lointain.
 */
export function buildSignerPayload(snapshot, party) {
  const firstName = String(snapshot?.firstName || '').trim();
  const lastName = String(snapshot?.lastName || '').trim();
  const email = String(snapshot?.email || '').trim();
  if (!firstName || !lastName || !email) {
    const label = party === 'developer' ? "l'entreprise développeur" : "l'entreprise cliente";
    throw ApiError.badRequest(
      `Signataire de ${label} absent du contrat. Reconfigurez le signataire puis créez un nouveau contrat.`
    );
  }
  return {
    role: party === 'developer' ? SIGNER_ROLE.DEVELOPER : SIGNER_ROLE.CLIENT,
    firstName,
    lastName,
    email,
  };
}

/** Le Panel est-il joignable ? Sans lui, aucune signature n'est possible. */
function assertControlPlane() {
  if (!capabilitiesAvailable()) {
    throw ApiError.badRequest(
      'Aucun Panel appairé : les signatures sont administrées par la plateforme, '
      + 'et elle est injoignable.',
      { code: 'SIGNATURE_CONTROL_PLANE_UNAVAILABLE' }
    );
  }
}

/**
 * Traduit un refus de capacité en erreur présentable.
 *
 * ── LA DISTINCTION QUI COMPTE ───────────────────────────────────────────────
 *
 * `CAPABILITY_TIMEOUT` ne devient PAS « échec ». Il signifie que l'issue est
 * INDÉTERMINÉE : la demande a peut-être été créée chez Yousign. Le Panel garde
 * alors le contrat verrouillé, et un opérateur tranche depuis l'écran des
 * réservations. Présenter cela comme un échec inviterait à relancer — donc à
 * solliciter deux fois un signataire réel.
 */
/**
 * Traduit un refus de capacité en message que l'exploitant peut ACTIONNER.
 *
 * Exportée pour être éprouvable : c'est la seule pièce du parcours de signature
 * que l'utilisateur lit vraiment, et elle n'était couverte par aucun test —
 * ce qui est précisément comment « Entrée refusée par « signature.request.open ». »
 * a pu rester affiché à un développeur pendant tout un lot.
 */
export function explainSignatureRefusal(error, action = 'l’ouverture de la signature') {
  return explain(error, action);
}

function explain(error, action) {
  const code = error?.code ?? '';

  if (code === 'CAPABILITY_TIMEOUT') {
    logger.error(`Signature — issue INDÉTERMINÉE sur ${action} : ${error?.message ?? ''}`);
    return ApiError.badRequest(
      'La plateforme n’a pas confirmé l’ouverture de la signature : l’issue est indéterminée. '
      + 'Ne relancez pas — l’équipe technique doit d’abord vérifier si la demande existe.',
      { code: 'SIGNATURE_OUTCOME_UNKNOWN' }
    );
  }
  if (code === 'CAPABILITY_BLOCKED_PREOPENING') {
    return ApiError.badRequest(
      'Cette instance n’est pas ouverte commercialement : les signatures réelles sont refusées.',
      { code }
    );
  }
  if (code === 'CAPABILITY_RESOURCE_NOT_OWNED') {
    return ApiError.badRequest('Demande de signature inconnue pour ce site.', { code });
  }
  if (code === 'CAPABILITY_CREDENTIALS_MISSING' || code === 'CAPABILITY_NOT_AVAILABLE') {
    return ApiError.badRequest(
      'La plateforme n’est pas configurée pour signer : contactez l’équipe technique.',
      { code }
    );
  }

  /**
   * ENTRÉE REFUSÉE — ET SURTOUT : PAR QUI, ET POURQUOI.
   *
   * Le message brut disait « Entrée refusée par « signature.request.open ». »
   * et rien d'autre. Il envoyait chercher un défaut de payload alors que le
   * refus venait d'une RÈGLE DU COMPTE de signature — un contrat parfaitement
   * formé, refusé pour l'adresse d'un signataire.
   *
   * Le Panel ne relaie pas la phrase du fournisseur (elle n'est pas
   * contractuelle) mais il en rend un MOTIF stable. On le traduit ici en ce que
   * l'exploitant peut réellement faire.
   */
  if (code === 'CAPABILITY_INPUT_INVALID') {
    const motif = error?.details?.panelDetails?.reason ?? error?.details?.reason ?? null;
    const champs = error?.details?.panelDetails?.invalidParams ?? [];
    logger.error(
      `Signature — ${action} refusée en entrée (motif ${motif || 'non reconnu'}`
      + `${champs.length ? `, champs ${champs.join(', ')}` : ''}).`
    );

    /**
     * ══ LES MOTIFS QUE LE FOURNISSEUR ACTUEL PRODUIT RÉELLEMENT ═══════════
     *
     * Le motif `SIGNER_EMAIL_NOT_IN_ORGANISATION` a disparu d'ici : il
     * décrivait une limitation du bac à sable YOUSIGN, qui n'accepte comme
     * destinataire qu'une adresse de l'organisation du compte. OpenSign n'a pas
     * cette limitation — mesuré, avec des adresses externes et l'envoi activé.
     *
     * Le laisser aurait affiché à un développeur une explication détaillée et
     * FAUSSE, l'envoyant vérifier des adresses parfaitement acceptables. Un
     * message d'erreur périmé coûte plus cher que pas de message : il occupe la
     * place du vrai.
     */
    if (motif === 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED') {
      return ApiError.badRequest(
        'Le compte de signature de la plateforme n’a plus de crédits : aucune demande '
        + 'ne peut être ouverte tant qu’il n’est pas rechargé. Le contrat est intact, '
        + 'et rien n’a été envoyé à personne.',
        { code: 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED' }
      );
    }
    if (motif === 'SIGNATURE_DOCUMENT_TOO_LARGE_FOR_PROVIDER') {
      return ApiError.badRequest(
        'Le document dépasse la taille que la plateforme de signature accepte. '
        + 'Allégez le PDF (compression des images) avant de relancer la signature.',
        { code: 'SIGNATURE_DOCUMENT_TOO_LARGE' }
      );
    }

    return ApiError.badRequest(
      'La plateforme a refusé les données de signature'
      + (champs.length ? ` (${champs.join(', ')})` : '')
      + '. Vérifiez le document, les zones et les deux signataires, puis relancez.',
      { code: 'SIGNATURE_INPUT_REFUSED' }
    );
  }

  logger.error(`Signature — ${action} refusée (${code || 'inconnu'}) : ${error?.message ?? ''}`);
  return ApiError.badRequest(
    error?.message || 'La demande de signature a été refusée par la plateforme.',
    { code: code || 'SIGNATURE_REFUSED' }
  );
}

/**
 * Ouvre la demande de signature d'un contrat.
 *
 * ── UN SEUL APPEL, LÀ OÙ IL Y EN AVAIT CINQ ─────────────────────────────────
 *
 * Création, document, signataires, champs et activation sont désormais UN acte
 * côté Panel. Ce projet ne peut donc plus s'arrêter au milieu d'une
 * préparation, et n'a plus de brouillon à nettoyer — le tout-ou-rien vit là où
 * se trouvent les identifiants.
 *
 * ── UNE SEULE URL DE RETOUR, ET ELLE NE PORTE PAS L'ISSUE ───────────────────
 *
 * Yousign acceptait trois adresses PAR SIGNATAIRE (succès, erreur, refus).
 * OpenSign n'en accepte qu'UNE, pour tout le document, et n'y ajoute AUCUN
 * paramètre — mesuré en bac à sable.
 *
 * Le parcours n'y perd rien, parce qu'il ne s'y fiait pas : la page de retour a
 * toujours interrogé le backend plutôt que de croire un `?status=success`. Un
 * paramètre d'URL est contrôlé par celui qui revient ; l'état du contrat, non.
 *
 * `autoReturn` reste rendu — c'est un fait constaté, que l'écran affiche.
 *
 * @param {object} contract
 * @param {{buffer: Buffer, filename: string}} file
 * @param {*} [_provider] conservé pour la compatibilité d'appel — IGNORÉ.
 * @param {string|null} [returnUrl] l'adresse de retour, unique
 */
export async function createContractSignatureRequest(
  contract,
  file,
  _provider = undefined,
  returnUrl = null
) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw ApiError.badRequest('Document de contrat illisible : PDF vide ou absent.');
  }
  /**
   * REFUS LOCAL AVANT ENCODAGE. Le Panel tranche en dernier ressort, mais
   * transporter 20 Mio sur le pont pour s'entendre dire non serait absurde.
   */
  if (file.buffer.length > MAX_DOCUMENT_BYTES) {
    const mib = Math.round((file.buffer.length / (1024 * 1024)) * 10) / 10;
    throw ApiError.badRequest(
      `Document trop volumineux : ${mib} Mio pour une limite de 10 Mio. `
      + 'Allégez le PDF (compression des images) avant de relancer la signature.',
      { code: 'SIGNATURE_DOCUMENT_TOO_LARGE' }
    );
  }

  /**
   * LA GARDE DE PLAN DE CONTRÔLE VIENT APRÈS LES CONTRÔLES D'ENTRÉE.
   *
   * Un PDF absent ou hors gabarit est invalide que le Panel soit joignable ou
   * non. Vérifier l'appairage d'abord aurait rendu « Panel injoignable » comme
   * cause pour un document de 20 Mio — un diagnostic qui envoie chercher la
   * panne au mauvais endroit.
   */
  assertControlPlane();

  let outcome;
  try {
    outcome = await invokeCapability(
      'signature.request.open',
      buildSignatureOpenPayload(contract, file, returnUrl),
    );
  } catch (err) {
    throw explain(err, 'l’ouverture de la signature');
  }

  const result = outcome?.result ?? {};
  const byRole = new Map((result.signers || []).map((s) => [s.role, s]));
  const dev = byRole.get(SIGNER_ROLE.DEVELOPER);
  const client = byRole.get(SIGNER_ROLE.CLIENT);

  return {
    /**
     * QUI A SERVI L'ACTE — persisté par l'appelant, et lu à chaque relecture.
     * Sans lui, un contrat historique deviendrait illisible après une bascule.
     */
    provider: result.provider ?? null,
    signatureRequestId: result.signatureRequestId,
    documentId: result.documentId,
    devSignerId: dev?.signerId ?? null,
    adminSignerId: client?.signerId ?? null,
    /** Forme conservée pour l'appelant : il y cherche `signature_link`. */
    signers: (result.signers || []).map((s) => ({
      id: s.signerId,
      signature_link: s.signatureLink,
    })),
    /**
     * `autoReturn` est un FAIT constaté, pas un réglage : il dit si les
     * redirections ont été acceptées. Le Panel ne le rend pas explicitement ;
     * on le déduit de la présence d'un lien, ce qui reste vrai dans les deux
     * cas et n'invente rien.
     */
    autoReturn: Boolean(returnUrl),
  };
}

/**
 * LE PAYLOAD DE `signature.request.open`, ET RIEN D'AUTRE.
 *
 * ══ POURQUOI CETTE FONCTION EST SÉPARÉE DE L'APPEL ══════════════════════════
 *
 * Le payload était construit dans le corps de l'invocation. Il n'était donc
 * éprouvable qu'en appelant réellement le Panel — c'est-à-dire jamais dans une
 * suite. Une divergence avec le contrat de capacité ne se découvrait qu'en
 * production, sous la forme d'un refus que personne ne pouvait lire.
 *
 * Isolée et PURE, elle se valide contre le schéma réel du Panel dans un test,
 * sans réseau, sans fournisseur, sans base.
 *
 * @param {object} contract       le contrat, avec son snapshot de signataires
 * @param {{buffer: Buffer, filename: string}} file  le PDF déjà lu et validé
 * @param {string|null} returnUrl  l’adresse de retour, unique — voir plus haut
 */
export function buildSignatureOpenPayload(contract, file, returnUrl = null) {
  const snapshot = contract.signersSnapshot || {};
  // L'ORDRE du tableau EST l'ordre de signature : DEV puis CLIENT.
  const signers = [
    buildSignerPayload(snapshot.developer, 'developer'),
    buildSignerPayload(snapshot.client, 'client'),
  ];

  const pageSizeByPage = new Map((contract.document?.pageSizes || []).map((p) => [p.page, p]));
  const fields = (contract.signatureConfiguration?.zones || []).map((zone) => {
    const mapped = mapZoneToField(zone, pageSizeByPage.get(zone.page));
    return {
      signerRole: zone.signerRole,
      page: mapped.page,
      x: mapped.x,
      y: mapped.y,
      width: mapped.width,
      height: mapped.height,
    };
  });
  if (fields.length === 0) {
    throw ApiError.badRequest('Aucune zone de signature configurée pour ce contrat.');
  }

  return {
    /**
     * LA RÉFÉRENCE MÉTIER — c'est elle qui fonde l'appartenance côté Panel,
     * et qui reviendra dans l'événement de webhook. Le contrat est l'entité
     * dont on parle ; l'identifiant Yousign n'en est qu'une conséquence.
     */
    contractRef: String(contract._id),
    name: `Contrat ${contract.reference || contract._id}`,
    documentBase64: file.buffer.toString('base64'),
    documentFilename: file.filename,
    signers,
    fields,
    ...(returnUrl ? { returnUrl } : {}),
    /**
     * `operationId` DÉRIVÉ DU CONTRAT, et non tiré au hasard.
     *
     * Deux clics produisent alors la MÊME clé, donc le même acte : le
     * registre d'opérations du Panel les fait converger au lieu d'ouvrir deux
     * demandes. Une clé aléatoire aurait laissé le second clic passer pour une
     * intention distincte — et seul l'index « une demande vivante par
     * contrat » l'aurait rattrapé, plus tard et moins clairement.
     */
    operationId: `sig-open-${contract._id}`,
  };
}

/** Le lien de signature d'un signataire — lecture, via le Panel. */
export async function getSignerLink(signatureRequestId, signerId) {
  assertControlPlane();
  try {
    const outcome = await invokeCapability('signature.signer.retrieve', {
      signatureRequestId,
      signerId,
    });
    return outcome?.result?.signatureLink ?? null;
  } catch (err) {
    throw explain(err, 'la lecture du lien de signature');
  }
}

/** L'état d'une demande — lecture, via le Panel. */
export async function getSignatureRequestStatus(signatureRequestId) {
  assertControlPlane();
  try {
    const outcome = await invokeCapability('signature.request.retrieve', { signatureRequestId });
    return outcome?.result ?? null;
  } catch (err) {
    throw explain(err, 'la lecture de la demande de signature');
  }
}

/**
 * Télécharge le PDF signé.
 *
 * ── LE `documentId` N'EST PLUS TRANSMIS ─────────────────────────────────────
 *
 * Le Panel le connaît depuis l'ouverture et le tient dans le lien
 * d'appartenance. Le lui envoyer permettrait de nommer un autre document au
 * sein d'une demande possédée ; il est donc ignoré, et l'argument n'est
 * conservé que pour ne pas casser les appelants.
 *
 * L'EMPREINTE est vérifiée à l'arrivée : le contenu a traversé un pont, et
 * refaire confiance au transport sans le contrôler serait un choix, pas un
 * oubli.
 */
export async function downloadSignedDocument(signatureRequestId, _documentId = undefined) {
  assertControlPlane();
  let outcome;
  try {
    outcome = await invokeCapability('signature.document.download', { signatureRequestId });
  } catch (err) {
    throw explain(err, 'la récupération du document signé');
  }

  const result = outcome?.result ?? {};
  const buffer = Buffer.from(result.contentBase64 ?? '', 'base64');

  if (result.byteLength && buffer.length !== result.byteLength) {
    throw ApiError.badRequest(
      'Document signé incomplet : la taille reçue ne correspond pas à celle annoncée.',
      { code: 'SIGNED_DOCUMENT_TRUNCATED' }
    );
  }
  if (result.sha256) {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== result.sha256) {
      throw ApiError.badRequest(
        'Document signé altéré : l’empreinte reçue ne correspond pas au contenu.',
        { code: 'SIGNED_DOCUMENT_CHECKSUM_MISMATCH' }
      );
    }
  }
  return buffer;
}

/**
 * La PREUVE D'AUDIT d'une signature achevée — via le Panel.
 *
 * ── CE N'EST PAS UNE VARIANTE DU CONTRAT SIGNÉ ────────────────────────
 *
 * Le contrat signé porte les engagements ; le certificat atteste QUI a signé,
 * QUAND et DEPUIS OÙ. Les deux pièces sont séparées chez le fournisseur, et
 * elles le restent ici : les fusionner rendrait impossible de produire l'une
 * sans l'autre, et l'opération est irréversible.
 *
 * ── ELLE PEUT LÉGITIMEMENT NE PAS EXISTER ───────────────────────────
 *
 * Deux cas, et tous deux normaux :
 *
 *   · la demande n'est pas encore ACHEVÉE — il n'y a rien à attester ;
 *   · elle a été signée chez le fournisseur historique, qui ne publiait pas de
 *     certificat par cette voie.
 *
 * L'appelant reçoit `null` dans ces deux cas, et une exception dans les
 * autres. Confondre « pas de certificat » avec « échec » ferait échouer
 * l'achèvement d'un contrat pour une pièce annexe.
 *
 * L'EMPREINTE est vérifiée à l'arrivée, comme pour le contrat.
 */
export async function downloadSignatureCertificate(signatureRequestId) {
  assertControlPlane();
  let outcome;
  try {
    outcome = await invokeCapability('signature.certificate.download', { signatureRequestId });
  } catch (err) {
    const motif = err?.details?.panelDetails?.reason ?? err?.details?.reason ?? null;
    if (motif === 'CERTIFICATE_NOT_PUBLISHED_YET' || motif === 'CERTIFICATE_NOT_SERVED_BY_LEGACY_PROVIDER') {
      logger.info(
        `[signature] aucun certificat d’audit pour ${signatureRequestId} (${motif}) — `
        + 'ce n’est pas un échec.',
      );
      return null;
    }
    throw explain(err, 'la récupération du certificat d’audit');
  }

  const result = outcome?.result ?? {};
  const buffer = Buffer.from(result.contentBase64 ?? '', 'base64');
  if (result.byteLength && buffer.length !== result.byteLength) {
    throw ApiError.badRequest(
      'Certificat d’audit incomplet : la taille reçue ne correspond pas à celle annoncée.',
      { code: 'SIGNATURE_CERTIFICATE_TRUNCATED' }
    );
  }
  if (result.sha256) {
    const { createHash } = await import('node:crypto');
    if (createHash('sha256').update(buffer).digest('hex') !== result.sha256) {
      throw ApiError.badRequest(
        'Certificat d’audit altéré : l’empreinte reçue ne correspond pas au contenu.',
        { code: 'SIGNATURE_CERTIFICATE_CHECKSUM_MISMATCH' }
      );
    }
  }
  return { buffer, contentType: result.contentType ?? 'application/octet-stream', sha256: result.sha256 ?? null };
}

/** Annule une demande en cours — via le Panel. */
export async function cancelSignatureRequest(signatureRequestId, reason = 'cancelled') {
  assertControlPlane();
  try {
    await invokeCapability('signature.request.cancel', {
      signatureRequestId,
      reason,
      operationId: `sig-cancel-${signatureRequestId}`,
    });
    return true;
  } catch (err) {
    throw explain(err, 'l’annulation de la signature');
  }
}

/*
 * LA VÉRIFICATION DE WEBHOOK A ÉTÉ RETIRÉE (R10.5C, cutover final).
 *
 * Elle vivait ici tant que l'endpoint Yousign était local. Il ne l'est plus :
 * Yousign appelle le Panel, qui vérifie, résout l’appartenance, normalise et
 * projette durablement par le pont.
 *
 * Ce projet n'a donc plus AUCUN secret Yousign — ni clé d'appel, ni secret de
 * vérification. Garder une fonction sans appelant aurait laissé croire à une
 * protection active, et invité à rebrancher un endpoint local.
 */

export default {
  MAX_DOCUMENT_BYTES,
  mapRequestStatus,
  buildSignerPayload,
  createContractSignatureRequest,
  getSignerLink,
  getSignatureRequestStatus,
  downloadSignedDocument,
  downloadSignatureCertificate,
  cancelSignatureRequest,
};
