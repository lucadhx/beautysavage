import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route introuvable : ${req.method} ${req.originalUrl}`));
}

/**
 * HELPER UNIQUE de normalisation des erreurs de VALIDATION (Zod ou Mongoose) vers
 * une structure STABLE :
 *
 *   { code: 'VALIDATION_ERROR', message, details: [{ path, code, message }] }
 *
 * `details` est TOUJOURS un tableau — jamais une string, jamais un objet nu — pour
 * qu'aucun consommateur ne puisse itérer une string (« Cannot create property
 * 'code' on string »). On NE MUTE jamais l'erreur d'origine : on construit du neuf.
 */
function normalizeValidationError(err) {
  let details = [];
  if (err instanceof ZodError) {
    details = (err.errors || []).map((e) => ({
      path: Array.isArray(e.path) ? e.path.join('.') : String(e.path ?? ''),
      code: e.code || 'invalid',
      message: e.message || 'Valeur invalide',
    }));
  } else {
    // Mongoose ValidationError : { errors: { path: { kind, message } } }
    details = Object.values(err.errors || {}).map((e) => ({
      path: String(e?.path ?? ''),
      code: e?.kind || 'invalid',
      message: e?.message || 'Valeur invalide',
    }));
  }
  const first = details[0];
  const message = zodTopMessage(err) || first?.message || 'Données invalides';
  return { code: 'VALIDATION_ERROR', message, details };
}

/**
 * Message TOP-LEVEL le plus utile : le message du premier champ (déjà rédigé côté
 * schéma), avec le cas `.strict()` traduit en français (« Unrecognized key(s) »
 * est illisible pour un utilisateur). N'accepte que des erreurs Zod.
 */
function zodTopMessage(err) {
  if (!(err instanceof ZodError)) return null;
  const first = err.errors?.[0];
  if (!first) return null;
  if (first.code === 'unrecognized_keys') {
    const keys = (first.keys || []).join(', ');
    return keys ? `Champ non reconnu : ${keys}` : 'Champ non reconnu dans la requête.';
  }
  return first.message || null;
}

/**
 * Pannes d'infrastructure Mongo/Mongoose. Elles n'ont rien à voir avec la
 * requête : les traduire en 503 explicite plutôt qu'en « Erreur serveur ».
 */
const MONGO_UNAVAILABLE = new Set([
  'MongooseServerSelectionError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTimeoutError',
]);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Erreur serveur';
  let details = err.details;

  // Code métier stable remonté au niveau racine (défini pour les validations).
  let topCode;

  if (err instanceof ZodError || err.name === 'ValidationError') {
    // Zod OU Mongoose : une SEULE normalisation, structure stable, message précis.
    // Jamais un générique « Données invalides » quand un champ est identifiable.
    statusCode = 400;
    const norm = normalizeValidationError(err);
    topCode = norm.code;
    message = norm.message;
    details = norm.details;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Identifiant invalide : ${err.value}`;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = `Valeur déjà utilisée : ${Object.keys(err.keyValue || {}).join(', ')}`;
  } else if (err.name === 'VersionError' || err.name === 'ParallelSaveError') {
    // Écriture concurrente (verrouillage optimiste Mongoose) : le document a
    // changé entre la lecture et l'enregistrement. Ce n'est PAS une panne — le
    // client peut simplement recharger et refaire. Sans ce mapping, l'erreur
    // tombait en 500 « Erreur serveur », indiscernable d'un vrai plantage.
    statusCode = 409;
    message = 'Modification concurrente : les données ont changé entre-temps. Rechargez la page puis réessayez.';
    details = { code: 'CONCURRENT_UPDATE' };
  } else if (MONGO_UNAVAILABLE.has(err.name)) {
    // Base injoignable / sélection de serveur expirée. C'est une indisponibilité
    // temporaire, pas une erreur de la requête : le dire franchement évite de
    // faire chercher un bug applicatif qui n'existe pas.
    statusCode = 503;
    message = 'Base de données momentanément injoignable. Réessayez dans quelques instants.';
    details = { code: 'DATABASE_UNAVAILABLE' };
  }

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, err.stack || err.message);
  }

  // Le diagnostic ciblé « email-config » (payload + stack sur 4xx) a été retiré
  // avec les parcours Brevo qu'il servait à déboguer : les erreurs restantes de ce
  // module sont toutes des ApiError volontaires portant un code stable.

  // Ne jamais divulguer le message d'une erreur interne inattendue (500 non
  // volontaire) : seuls les ApiError explicites portent un message destiné au
  // client. Le détail complet reste dans les logs serveur ci-dessus.
  const safeMessage =
    statusCode >= 500 && !(err instanceof ApiError) ? 'Erreur serveur' : message;

  // Remonte un code métier stable au niveau racine : celui de la validation
  // (`topCode`), sinon celui porté par un `details` OBJET (jamais un tableau,
  // jamais une string). Le front peut lire `message` OU `code` OU `details[i].code`.
  const objectDetailCode =
    details && typeof details === 'object' && !Array.isArray(details) ? details.code : undefined;
  const code = topCode ?? objectDetailCode;

  /**
   * ── LE MOTIF, À CÔTÉ DU CODE ───────────────────────────────────────────
   *
   * Un refus du Panel porte DEUX niveaux : le code dit la NATURE du refus
   * (« cette capacité ne peut pas être servie »), le motif dit POURQUOI
   * (« l’entreprise cliente est incomplète »). Le premier pilote la reprise,
   * le second est ce qu’on montre à un humain.
   *
   * Le motif voyageait déjà — enfoui dans `details.panelDetails.reason` —
   * mais aucun écran n’allait le chercher à cette profondeur. On le remonte
   * à la racine : un contrat d’erreur qui exige trois niveaux de navigation
   * n’est pas lu, il est contourné.
   */
  const reason = details?.panelDetails?.reason ?? details?.reason ?? undefined;

  /**
   * ── LE DÉLAI, LUI AUSSI, À LA RACINE ───────────────────────────────────
   *
   * Un 429 sans durée oblige l'écran à inventer une phrase vague. La durée
   * voyage déjà dans `details`, mais le client du manager NORMALISE
   * `details` en tableau-ou-rien : un objet y est écarté, et l'information
   * se perd en route. On la remonte donc à côté du code.
   *
   * L'en-tête `Retry-After` reste la source pour les intermédiaires HTTP ;
   * ce champ est là pour l'humain, que le corps de réponse atteint.
   */
  const retryAfterSeconds = Number.isFinite(Number(details?.retryAfterSeconds))
    ? Number(details.retryAfterSeconds)
    : undefined;

  res.status(statusCode).json({
    success: false,
    ...(code ? { code } : {}),
    ...(reason ? { reason } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    message: safeMessage,
    ...(details ? { details } : {}),
    ...(config.isTest && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}
