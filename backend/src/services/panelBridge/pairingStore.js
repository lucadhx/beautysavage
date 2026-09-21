/**
 * ÉTAT D'APPAIRAGE du projet — partagé par les DEUX ponts :
 *   - le PanelBridge (sortant) s'en sert comme credentials Bearer vers le Panel ;
 *   - le ProjectBridge (entrant) s'en sert pour vérifier les requêtes du Panel.
 * Un SEUL secret d'appairage pour les deux sens (spec §securitySchemes) : le
 * révoquer ferme tout.
 *
 * ARCHITECTURE (Phase 2A) — cache RAM + persistance injectée :
 *   - les LECTURES (isPaired, vérification de token, describePairing) restent
 *     SYNCHRONES sur le cache RAM : elles sont sur le chemin de chaque requête
 *     entrante du pont ;
 *   - les ÉCRITURES (setPairing, clearPairing, rotation) traversent
 *     l'adaptateur de persistance injecté (`configurePairingPersistence`) —
 *     en pratique l'adaptateur Mongo chiffré (persistence/mongoPairingAdapter)
 *     branché au bootstrap ; sans adaptateur (tests unitaires purs), le store
 *     fonctionne en RAM seule ;
 *   - `hydratePairing()` recharge le cache au démarrage : UN REDÉMARRAGE DU
 *     BACKEND NE CASSE JAMAIS L'APPAIRAGE.
 *
 * ROTATION : `rotateBridgeToken()` remplace le token en conservant l'ancien
 * pendant une fenêtre de transition (défaut 24 h) — pendant la fenêtre, les
 * DEUX tokens sont acceptés en entrée ; à l'expiration, seul le nouveau vit.
 *
 * Le token n'est JAMAIS exposé par describePairing() ni journalisé : seule la
 * vérification à l'aveugle (timingSafeEqual sur empreintes) est offerte.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** @type {{ panelUrl, projectId, panelName, bridgeToken, pairedAt, bridgeTokenPrevious: {token, expiresAt}|null, tokenRotatedAt: string|null } | null} */
let pairing = null;
/** Adaptateur { load(), save(p), clear() } — null = RAM seule (tests). */
let persistence = null;

/**
 * ══ QUI VEUT SAVOIR QUE L'APPAIRAGE VIENT DE CHANGER ? ══════════════════════
 *
 * ── LE DÉFAUT QUE CETTE LISTE FERME ─────────────────────────────────────────
 *
 * L'appairage est une dépendance STRUCTURANTE : le provisionnement des
 * webhooks, la récupération des secrets, les capacités du plan de contrôle en
 * dépendent tous. Or il APPARAÎT — au démarrage par hydratation, plus tard par
 * un appairage manuel depuis le Manager. Tout ce qui avait été sauté faute de
 * Panel restait sauté, sans que rien ne l'apprenne : c'est très exactement la
 * chaîne qui produisait
 *
 *     Webhook STRIPE/payment : réconciliation sautée (PANEL_NOT_PAIRED)
 *     Pont Panel : appairage restauré
 *     API PRÊTE
 *
 * ── POURQUOI L'OBSERVATEUR VIT ICI, ET N'IMPORTE RIEN ───────────────────────
 *
 * Parce que ce fichier est le SEUL endroit du projet qui sait, de première
 * main, que l'appairage a changé. Y déposer un simple registre de rappels ne
 * fait entrer aucune dépendance : le module de pont continue de ne rien
 * connaître du métier — c'est l'abonné qui apporte son propre travail.
 * `bridge-conformity` le vérifie, et la règle est respectée par construction.
 */
const observateurs = new Set();

/**
 * S'abonne aux changements d'appairage. Rend la fonction de désinscription.
 *
 * @param {(evenement: {type: 'PAIRED'|'UNPAIRED', source: string, pairing: object|null}) => void} fn
 */
export function onPairingChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  observateurs.add(fn);
  return () => observateurs.delete(fn);
}

/**
 * Prévient les abonnés. Ne lève JAMAIS et n'attend personne : un abonné en
 * échec ne doit pas faire échouer un appairage qui, lui, a réussi.
 */
function notifierChangement(type, source) {
  if (observateurs.size === 0) return;
  const vue = type === 'PAIRED' ? describePairing() : null;
  for (const observateur of [...observateurs]) {
    try {
      void Promise.resolve(observateur({ type, source, pairing: vue })).catch(() => {});
    } catch { /* un observateur ne casse jamais l'appairage */ }
  }
}

/** Branche l'adaptateur de persistance (bootstrap). */
export function configurePairingPersistence(adapter) {
  persistence = adapter || null;
}

/**
 * Recharge l'appairage persisté dans le cache RAM (démarrage). Renvoie la vue
 * non sensible (describePairing) ou null. Sans adaptateur : no-op.
 */
export async function hydratePairing() {
  if (!persistence) return describePairing().paired ? describePairing() : null;
  const stored = await persistence.load();
  pairing = stored
    ? {
        panelUrl: stored.panelUrl,
        panelFrontendUrl: stored.panelFrontendUrl || null,
        projectId: stored.projectId,
        panelName: stored.panelName || '',
        bridgeToken: stored.bridgeToken,
        pairedAt: stored.pairedAt,
        bridgeTokenPrevious: stored.bridgeTokenPrevious || null,
        tokenRotatedAt: stored.tokenRotatedAt || null,
      }
    : null;
  if (pairing) notifierChangement('PAIRED', 'HYDRATION');
  return pairing ? describePairing() : null;
}

/** Enregistre un appairage (résultat d'un bootstrap réussi). Persisté. */
export async function setPairing({ panelUrl, panelFrontendUrl = null, projectId, panelName, bridgeToken }) {
  pairing = {
    panelUrl: String(panelUrl || ''),
    panelFrontendUrl: panelFrontendUrl ? String(panelFrontendUrl) : null,
    projectId: String(projectId),
    panelName: String(panelName || ''),
    bridgeToken: String(bridgeToken),
    pairedAt: new Date().toISOString(),
    bridgeTokenPrevious: null,
    tokenRotatedAt: null,
  };
  if (persistence) await persistence.save(pairing);
  /**
   * APRÈS la persistance : un abonné qui rejoue une réconciliation doit
   * trouver un appairage déjà durable. Le prévenir avant ferait retenter un
   * geste qu'un redémarrage immédiat aurait perdu.
   */
  notifierChangement('PAIRED', 'PAIRING');
}

/**
 * Efface l'appairage (désappairage / débranchement). Idempotent. Le RAM est
 * TOUJOURS vidé, même si la persistance échoue : le débranchement local prime
 * (04_STANDALONE §4.1) — l'échec est propagé à l'appelant pour journalisation.
 */
export async function clearPairing() {
  pairing = null;
  notifierChangement('UNPAIRED', 'UNPAIRING');
  if (persistence) await persistence.clear();
}

/**
 * Rotation du bridgeToken : le nouveau token devient courant, l'ancien reste
 * accepté jusqu'à la fin de la fenêtre de transition. Persisté.
 */
export async function rotateBridgeToken(newToken, { windowMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!pairing) throw new Error('rotateBridgeToken : aucun appairage.');
  const now = new Date();
  pairing = {
    ...pairing,
    bridgeToken: String(newToken),
    bridgeTokenPrevious: {
      token: pairing.bridgeToken,
      expiresAt: new Date(now.getTime() + windowMs).toISOString(),
    },
    tokenRotatedAt: now.toISOString(),
  };
  if (persistence) await persistence.save(pairing);
}

export function isPaired() {
  return pairing !== null;
}

/** Le token courant — réservé au PanelBridge (Authorization sortant). */
export function currentBridgeToken() {
  return pairing?.bridgeToken ?? null;
}

/** Comparaison en temps constant sur empreintes SHA-256. */
function tokensMatch(known, candidate) {
  const a = createHash('sha256').update(known).digest();
  const b = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(a, b);
}

/**
 * Vérifie un token entrant (Panel → ProjectBridge) en temps constant.
 * Accepte le token courant, OU l'ancien token pendant sa fenêtre de rotation.
 */
export function verifyIncomingBridgeToken(candidate) {
  if (!pairing || typeof candidate !== 'string' || candidate.length === 0) return false;
  if (tokensMatch(pairing.bridgeToken, candidate)) return true;
  const previous = pairing.bridgeTokenPrevious;
  if (previous && new Date(previous.expiresAt).getTime() > Date.now()) {
    return tokensMatch(previous.token, candidate);
  }
  return false;
}

/** Vue NON sensible de l'appairage (statuts, page « Connexion Panel »…). */
export function describePairing() {
  if (!pairing) return { paired: false };
  return {
    paired: true,
    panelUrl: pairing.panelUrl,
    panelFrontendUrl: pairing.panelFrontendUrl ?? null,
    panelName: pairing.panelName,
    projectId: pairing.projectId,
    pairedAt: pairing.pairedAt,
    tokenRotatedAt: pairing.tokenRotatedAt,
    rotationWindowOpen: Boolean(
      pairing.bridgeTokenPrevious &&
        new Date(pairing.bridgeTokenPrevious.expiresAt).getTime() > Date.now()
    ),
  };
}

/** Réinitialise le cache RAM SEUL (tests : simule un redémarrage du process). */
export function resetPairingCacheForTests() {
  pairing = null;
}

/**
 * Débranche tous les observateurs — recettes qui amorcent plusieurs fois un
 * même processus. En production, l'abonnement est unique et permanent.
 */
export function resetPairingObserversForTests() {
  observateurs.clear();
}
