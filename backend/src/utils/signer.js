/**
 * Règles de complétude d'un signataire contractuel — partagées par la
 * validation du contrat, les validateurs Zod et les tests. Le manager applique
 * les mêmes règles côté UI (badge de complétion) : toute évolution ici doit y
 * être répercutée (manager/src/lib/signer.ts).
 */

// Volontairement permissive : on refuse l'absurde (pas d'@, pas de domaine),
// pas l'exotique. Yousign reste l'autorité finale sur la délivrabilité.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

/**
 * Champs exigés pour signer. `jobTitle` en est volontairement absent : la
 * fonction est une mention de courtoisie sur le contrat, elle ne conditionne
 * pas la capacité à signer.
 */
export const SIGNER_REQUIRED_FIELDS = Object.freeze(['firstName', 'lastName', 'email']);

export const SIGNER_FIELD_LABEL = Object.freeze({
  firstName: 'prénom',
  lastName: 'nom',
  jobTitle: 'fonction',
  email: 'email',
});

/**
 * Retourne la liste des champs requis manquants ou invalides.
 * @returns {string[]} noms de champs (`firstName` | `lastName` | `email`)
 */
export function getSignerGaps(signer) {
  if (!signer) return [...SIGNER_REQUIRED_FIELDS];
  const gaps = [];
  for (const field of SIGNER_REQUIRED_FIELDS) {
    const value = String(signer[field] ?? '').trim();
    if (!value) gaps.push(field);
    else if (field === 'email' && !isValidEmail(value)) gaps.push(field);
  }
  return gaps;
}

export function isSignerComplete(signer) {
  return getSignerGaps(signer).length === 0;
}

/** Traduit les champs manquants en énumération lisible : "prénom, nom et email". */
export function formatSignerGaps(gaps) {
  const labels = gaps.map((g) => SIGNER_FIELD_LABEL[g] || g);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
}
