import { z } from 'zod';
import {
  CONTACT_REASON_VALUES,
  CONTACT_STATUS_VALUES,
  CONTACT_ERROR_CODES as E,
  MAX_NAME_LENGTH,
  MAX_COMPANY_LENGTH,
  MAX_ACTIVITY_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_URL_LENGTH,
  MAX_PAGE_SIZE,
} from '../utils/contactConstants.js';

/**
 * Validation des demandes de contact.
 *
 * ─── LES CODES D'ERREUR SONT UN CONTRAT ──────────────────────────────────────
 *
 * Chaque règle publique porte un `message` qui EST le code métier
 * (`CONTACT_EMAIL_INVALID`…). Le middleware d'erreur renvoie les `issues` zod ; le
 * frontend s'appuie sur ces codes pour placer le message sous le bon champ, sans
 * jamais parser une phrase française.
 *
 * ─── `.strict()` PARTOUT ─────────────────────────────────────────────────────
 *
 * Un champ inconnu est REFUSÉ, pas ignoré. Sur une route publique c'est une
 * garde réelle : un robot qui poste `{ status: 'RESOLVED' }` ou
 * `{ submissionId: '…' }` doit se heurter à un mur, pas voir son champ
 * silencieusement écarté.
 */

/** Normalise les espaces : « Jean   Dupont » et « Jean Dupont » sont le même nom. */
const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Nettoie un message multi-ligne.
 *
 * Les retours à la ligne sont CONSERVÉS (ils portent la mise en forme voulue par
 * le visiteur, et le template les rend via `white-space: pre-line`), mais les
 * espaces horizontaux sont normalisés et les lignes vides en excès réduites.
 * Aucune interprétation : le message reste du TEXTE.
 */
const cleanMessage = (v) =>
  String(v ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Normalise un téléphone : chiffres, `+`, et rien d'autre.
 *
 * On ne VALIDE pas le format international (libphonenumber pèserait 150 ko pour
 * un champ facultatif que personne ne recompose automatiquement). On normalise
 * la saisie et on borne — « 06 12 34 56 78 » et « 06.12.34.56.78 » deviennent
 * comparables, ce qui suffit à l'usage : un humain rappelle.
 */
const normalizePhone = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.replace(/[^\d+]/g, '').slice(0, MAX_PHONE_LENGTH);
};

/** URL http/https uniquement, bornée. Toute autre valeur devient `''`. */
const safeUrl = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH, E.CONTACT_PAGE_URL_INVALID)
  .refine((v) => !v || /^https?:\/\//i.test(v), E.CONTACT_PAGE_URL_INVALID)
  .optional()
  .default('');

/**
 * Corps de la soumission publique.
 *
 * `hpCheck` (honeypot) et `formStartedAt` sont les champs ANTI-ABUS. Ils sont déclarés ici
 * pour passer `.strict()`, mais ne sont jamais persistés : le service ne les
 * reçoit même pas.
 */
const submitContactBody = z
  .object({
    name: z
      .string({ required_error: E.CONTACT_NAME_REQUIRED })
      .transform(collapse)
      .pipe(
        z.string()
          .min(1, E.CONTACT_NAME_REQUIRED)
          .max(MAX_NAME_LENGTH, E.CONTACT_NAME_TOO_LONG)
      ),

    companyName: z
      .string({ required_error: E.CONTACT_COMPANY_REQUIRED })
      .transform(collapse)
      .pipe(
        z.string()
          .min(1, E.CONTACT_COMPANY_REQUIRED)
          .max(MAX_COMPANY_LENGTH, E.CONTACT_COMPANY_TOO_LONG)
      ),

    activity: z
      .string()
      .transform(collapse)
      .pipe(z.string().max(MAX_ACTIVITY_LENGTH, E.CONTACT_ACTIVITY_TOO_LONG))
      .optional()
      .default(''),

    email: z
      .string({ required_error: E.CONTACT_EMAIL_INVALID })
      .trim()
      .toLowerCase()
      .max(MAX_EMAIL_LENGTH, E.CONTACT_EMAIL_INVALID)
      .email(E.CONTACT_EMAIL_INVALID),

    phone: z
      .string()
      .max(64, E.CONTACT_PHONE_INVALID)
      .transform(normalizePhone)
      .optional()
      .default(''),

    reason: z.enum(CONTACT_REASON_VALUES, {
      errorMap: () => ({ message: E.CONTACT_REASON_INVALID }),
    }),

    message: z
      .string({ required_error: E.CONTACT_MESSAGE_REQUIRED })
      // Borne AVANT nettoyage : sans elle, un mégaoctet d'espaces serait
      // normalisé en une ligne et passerait la limite d'après-nettoyage.
      .max(MAX_MESSAGE_LENGTH * 2, E.CONTACT_MESSAGE_TOO_LONG)
      .transform(cleanMessage)
      .pipe(
        z.string()
          .min(1, E.CONTACT_MESSAGE_REQUIRED)
          .max(MAX_MESSAGE_LENGTH, E.CONTACT_MESSAGE_TOO_LONG)
      ),

    pageUrl: safeUrl,

    /**
     * Clé d'idempotence du client. UUID : un format libre laisserait un robot
     * choisir une clé fixe et bloquer toutes les soumissions suivantes.
     */
    clientSubmissionId: z.string().uuid().optional(),

    // --- Anti-abus : jamais persistés ---------------------------------------
    /** Honeypot. Nommé comme un champ ordinaire — voir contactAbuse.js. */
    hpCheck: z.string().max(200).optional(),
    /** Horodatage d'affichage du formulaire (falsifiable, cf. contactAbuse.js). */
    formStartedAt: z.union([z.string().max(40), z.number()]).optional(),
  })
  .strict();

// --- Manager -----------------------------------------------------------------

const submissionIdParam = z.object({
  submissionId: z.string().min(1).max(64),
});

/**
 * Filtres de liste.
 *
 * `limit` est borné ICI **et** dans le service : le premier donne une erreur
 * lisible, le second garantit qu'aucun appelant (script, test) ne contourne la
 * borne en sautant la validation.
 */
const listQuery = z
  .object({
    // Cycle de vie SIMPLE : non résolues par défaut ; `resolved`/`unread` en filtres.
    resolved: z.enum(['true', 'false']).optional(),
    unread: z.enum(['true', 'false']).optional(),
    reason: z.enum(CONTACT_REASON_VALUES).optional(),
    search: z.string().trim().max(120).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    // Curseur COMPOSITE opaque (base64), pas une simple date : tri à deux clés.
    cursor: z.string().max(200).optional(),
  })
  .strict();

const statusBody = z.object({ status: z.enum(CONTACT_STATUS_VALUES) }).strict();

/** `userId: null` désassigne. */
const assignmentBody = z
  .object({ userId: z.string().length(24).nullable() })
  .strict();

export const submitContactSchema = { body: submitContactBody };
export const submissionIdSchema = { params: submissionIdParam };
export const listSubmissionsSchema = { query: listQuery };
export const updateStatusSchema = { params: submissionIdParam, body: statusBody };
export const updateAssignmentSchema = { params: submissionIdParam, body: assignmentBody };
