/**
 * Forme CANONIQUE d'un identifiant de message fournisseur (`messageId` Brevo).
 *
 * ─── POURQUOI UN SEUL HELPER ─────────────────────────────────────────────────
 *
 * Brevo renvoie le `messageId` de `POST /v3/smtp/email` AVEC chevrons RFC
 * (`<202607…@smtp-relay.mailin.fr>`) mais envoie `message-id` SANS chevrons dans
 * ses webhooks. Trois normalisations locales et légèrement différentes avaient
 * fini par coexister (ingestion, diagnostic, réconciliation) : c'est exactement
 * le terreau d'un bug de corrélation silencieux.
 *
 * Règle unique : on ÉCRIT la forme canonique (sans chevrons), et on LIT via
 * `providerMessageIdVariants` — qui accepte aussi la forme historique avec
 * chevrons, pour ne pas invalider les livraisons déjà en base.
 */

/**
 * Réduit un identifiant à sa forme canonique : trimé, sans chevrons.
 *
 * La CASSE est préservée : la partie locale d'un Message-ID est sensible à la
 * casse (RFC 5322) et Brevo la renvoie à l'identique — la normaliser risquerait
 * de casser un rapprochement au lieu d'en réparer un.
 *
 * @returns {string} forme canonique, ou '' si la valeur est vide/invalide.
 */
export function normalizeProviderMessageId(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.replace(/^<+/, '').replace(/>+$/, '').trim();
}

/**
 * Variantes acceptées à la LECTURE : forme canonique + forme historique avec
 * chevrons. Sert aux requêtes `$in` de rapprochement.
 *
 * @returns {string[]} vide si l'identifiant est vide (aucune recherche à faire).
 */
export function providerMessageIdVariants(value) {
  const bare = normalizeProviderMessageId(value);
  if (!bare) return [];
  return Array.from(new Set([bare, `<${bare}>`]));
}

export default { normalizeProviderMessageId, providerMessageIdVariants };
