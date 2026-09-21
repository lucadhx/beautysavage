/**
 * Anti-abus du formulaire de contact — module PUR (aucun DOM, aucune base, aucun
 * `req`), donc testable directement sous Node.
 *
 * ═══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * **Ce n'est pas un système anti-spam.** C'est un filtre à faible coût contre les
 * robots génériques — ceux qui remplissent tous les champs d'un formulaire et le
 * soumettent instantanément. Un spammeur déterminé le franchit en quelques
 * minutes : il lui suffit de laisser le honeypot vide et d'attendre trois
 * secondes.
 *
 * C'est assumé. L'alternative — un CAPTCHA — coûte un tiers, une dépendance
 * externe, des données envoyées à Google, et une barrière réelle pour les
 * utilisateurs de lecteurs d'écran. Pour un formulaire de contact de garage, le
 * rapport n'y est pas. Si le volume de spam devient un problème, c'est à ce
 * moment-là qu'on paiera ce prix — pas avant.
 *
 * ═══ POURQUOI CE MODULE EXISTE ALORS QUE `rateLimit` EXISTE ══════════════════
 *
 * `middlewares/rateLimit.js` limite par IP et **se désactive hors production**
 * (`config.isTest`, qui vaut `!isProd`). Deux conséquences :
 *
 *  1. il ne protège rien en développement ;
 *  2. il est **intestable** par la suite automatisée.
 *
 * On le réutilise quand même (c'est le mécanisme du dépôt, et il fait son travail
 * en production), mais les règles qui doivent être *vérifiables* vivent ici, dans
 * un module pur, actif partout. Les deux sont complémentaires : `rateLimit`
 * borne un attaquant unique, ce module écarte les robots naïfs et borne le débit
 * GLOBAL — la protection qui compte quand l'attaque vient de mille IP.
 */

/** Délai minimal entre l'affichage du formulaire et sa soumission. */
export const MIN_FILL_TIME_MS = 2_000;

/**
 * Au-delà, on considère que l'horodatage est fantaisiste et on l'IGNORE plutôt
 * que de refuser : un onglet laissé ouvert toute la nuit est un cas normal, et
 * refuser cette personne serait absurde.
 */
export const MAX_FILL_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * Nombre d'URL au-delà duquel un message est tenu pour automatisé.
 *
 * Quatre : une personne qui décrit un problème colle volontiers une ou deux
 * adresses (sa page, un modèle de voiture). Cinq liens dans un message de contact
 * de garage, jamais. Le seuil est haut exprès — un faux positif ici, c'est un
 * client perdu en silence.
 */
export const MAX_URLS_IN_MESSAGE = 4;

/** Débit GLOBAL, toutes origines confondues. Dernier rempart d'une attaque distribuée. */
export const GLOBAL_WINDOW_MS = 60_000;
export const GLOBAL_MAX_PER_WINDOW = 30;

/** Motifs de rejet — journal serveur uniquement, jamais renvoyés au visiteur. */
export const ABUSE_REASON = Object.freeze({
  HONEYPOT: 'HONEYPOT',
  TOO_FAST: 'TOO_FAST',
  TOO_MANY_URLS: 'TOO_MANY_URLS',
  GLOBAL_RATE: 'GLOBAL_RATE',
});

/**
 * Le honeypot est-il rempli ?
 *
 * Le champ est invisible et hors du parcours clavier : un humain ne peut pas le
 * remplir. Un robot qui remplit tout, si.
 *
 * La comparaison se fait après `trim()` : « ␣␣␣ » ne compte PAS comme rempli.
 * C'est délibéré, et c'est le sens le plus prudent — un espace parasite injecté
 * par une extension de navigateur rejetterait un vrai visiteur, en silence. Un
 * robot, lui, écrit une vraie valeur (une URL, un nom) : c'est ce qu'on attrape.
 */
export function isHoneypotFilled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * La soumission est-elle trop rapide pour être humaine ?
 *
 * `formStartedAt` est posé par le frontend à l'affichage du formulaire. Il est
 * **falsifiable** — c'est le client qui l'envoie. Ce n'est donc pas une garantie,
 * juste un coût supplémentaire pour un robot naïf.
 *
 * ABSENT ⇒ ON ACCEPTE. Un horodatage manquant peut venir d'un navigateur exotique
 * ou d'un JavaScript partiellement chargé ; refuser sur cette base perdrait de
 * vrais visiteurs pour gêner un robot qui, de toute façon, peut simplement
 * envoyer une date crédible.
 *
 * @returns {boolean} true si la soumission est suspecte
 */
export function isTooFast(formStartedAt, now = Date.now(), minMs = MIN_FILL_TIME_MS) {
  if (!formStartedAt) return false;
  const started = typeof formStartedAt === 'number' ? formStartedAt : Date.parse(String(formStartedAt));
  if (!Number.isFinite(started)) return false; // date illisible : on n'en tient pas compte
  const elapsed = now - started;
  if (elapsed < 0) return false;               // horloge client en avance : ignoré
  if (elapsed > MAX_FILL_TIME_MS) return false; // onglet oublié : normal
  return elapsed < minMs;
}

/** Compte les URL d'un texte. */
export function countUrls(text) {
  const matches = String(text || '').match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi);
  return matches ? matches.length : 0;
}

/** Le message a-t-il l'allure d'un envoi automatisé ? */
export function looksAutomated(message, maxUrls = MAX_URLS_IN_MESSAGE) {
  return countUrls(message) > maxUrls;
}

/**
 * Compteur global, en mémoire.
 *
 * Mêmes limites que `middlewares/rateLimit.js`, et pour la même raison : le dépôt
 * est déployé en mono-processus (PM2 `fork`). En cluster, chaque instance aurait
 * son compteur et la limite effective serait multipliée par le nombre
 * d'instances. Ce serait à remplacer par Redis — pas à ajouter aujourd'hui pour
 * un besoin qui n'existe pas.
 */
const globalWindow = { count: 0, reset: 0 };

/** Consomme un jeton du débit global. `true` si la limite est franchie. */
export function hitGlobalRate(now = Date.now()) {
  if (now > globalWindow.reset) {
    globalWindow.count = 0;
    globalWindow.reset = now + GLOBAL_WINDOW_MS;
  }
  globalWindow.count += 1;
  return globalWindow.count > GLOBAL_MAX_PER_WINDOW;
}

/** Remet le compteur global à zéro. Réservé aux tests. */
export function _resetGlobalRate() {
  globalWindow.count = 0;
  globalWindow.reset = 0;
}

/**
 * Verdict sur une soumission.
 *
 * ─── UN SIGNAL N'EST PAS UNE DÉCISION ────────────────────────────────────────
 *
 * L'erreur passée : rejeter sur le SEUL honeypot. Or les navigateurs et les
 * gestionnaires de mots de passe remplissent parfois un champ caché — un autofill
 * parfaitement légitime déclenchait alors le rejet, et le visiteur perdait sa
 * demande en silence. Inacceptable.
 *
 * Désormais le honeypot, la rapidité et l'excès d'URL sont des SIGNAUX. Une
 * soumission n'est tenue pour un robot que si PLUSIEURS signaux concordent
 * (≥ 2) — un autofill isolé ne suffit plus. Les signaux sont toujours renvoyés
 * (`signals`) pour être tracés côté DEV, même quand la demande est acceptée.
 *
 * EXCEPTION : le débit GLOBAL est un garde INFRASTRUCTURE (attaque distribuée),
 * pas une heuristique de contenu. Il bloque seul — mais n'est consommé que si la
 * soumission a franchi les heuristiques, pour qu'une vague de robots n'épuise pas
 * le quota des visiteurs légitimes.
 *
 * ─── RÉPONSE NEUTRE SUR REJET ────────────────────────────────────────────────
 *
 * Un rejet (`accept: false`) est désormais RARE (spam multi-signaux avéré, ou
 * débit global). L'appelant répond alors un succès neutre : dire « rejeté » à un
 * robot lui apprendrait quoi corriger.
 *
 * @returns {{accept: boolean, reason: string|null, signals: string[]}}
 */
export function assessSubmission({ website, formStartedAt, message, now = Date.now() }) {
  const signals = [];
  if (isHoneypotFilled(website)) signals.push(ABUSE_REASON.HONEYPOT);
  if (isTooFast(formStartedAt, now)) signals.push(ABUSE_REASON.TOO_FAST);
  if (looksAutomated(message)) signals.push(ABUSE_REASON.TOO_MANY_URLS);

  // Deux signaux d'heuristique qui concordent = robot. Un seul = on accepte, on
  // trace. (Un honeypot rempli SEUL est très probablement un autofill.)
  if (signals.length >= 2) {
    return { accept: false, reason: signals[0], signals };
  }

  // Débit global : dernier rempart, consommé UNIQUEMENT ici (après les heuristiques).
  if (hitGlobalRate(now)) {
    signals.push(ABUSE_REASON.GLOBAL_RATE);
    return { accept: false, reason: ABUSE_REASON.GLOBAL_RATE, signals };
  }

  // Accepté — avec, éventuellement, un signal isolé à tracer (ex. HONEYPOT seul).
  return { accept: true, reason: null, signals };
}

export default { assessSubmission, isHoneypotFilled, isTooFast, looksAutomated, countUrls };
