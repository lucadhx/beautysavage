// CONNEXION AU PANEL — Phase 4.
//
// ── LE MANQUE QUE CE CONTRÔLEUR COMBLE ──────────────────────────────────────
// Le pont était complet, testé, persistant… et injoignable : `pairWithPanel()`
// n'était appelé que par un script de test. Aucun opérateur ne pouvait
// appairer un projet sans écrire du code. C'est ici que cela devient une
// opération d'administration ordinaire.
//
// Réservé aux comptes DEV : appairer, c'est confier au Panel l'identité du
// site et recevoir de lui des identifiants d'accès à des services tiers.
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/env.js';
import {
  pairWithPanel,
  unpairFromPanel,
  getPanelBridge,
} from '../services/panelBridge/bridgeRuntime.js';
import { describePairing, isPaired } from '../services/panelBridge/pairingStore.js';
import {
  describeScheduler,
  runHeartbeatCycle,
  runSyncCycle,
} from '../services/panelBridge/bridgeScheduler.js';
import {
  getCompanyConfiguration,
} from '../services/panelConfiguration/panelConfiguration.service.js';
import { describeOutboxHealth } from '../services/panelBridge/persistence/mongoOutboxAdapter.js';

const ok = (res, data) => res.status(200).json({ success: true, data });

/**
 * ÉTAT COMPLET de la connexion : appairage, ordonnanceur, configuration
 * reçue. C'est la page « Connexion Panel » du Manager en un appel.
 *
 * Ne contient JAMAIS le bridgeToken ni la moindre valeur d'identifiant —
 * seulement le nom des clés reçues.
 */
/**
 * L'ENTREPRISE DU PANEL, TELLE QU'ELLE A CONVERGÉ ICI.
 *
 * ══ CE QUE « À JOUR » VEUT DIRE, ET CE QU'IL NE VEUT PAS DIRE ═══════════════
 *
 * Cette réponse ne va PAS interroger le Panel. Elle lit la copie que le pont a
 * appliquée localement — et c'est délibéré : le projet doit continuer de
 * servir ses coordonnées de support quand le Panel est arrêté, en maintenance
 * ou injoignable. Le contraire ferait dépendre l'affichage d'un numéro de
 * téléphone de la disponibilité d'une autre machine.
 *
 * « Dernier état connu » n'est donc pas un pis-aller : c'est le contrat. Le
 * pont fait converger, l'écran affiche ce qui a convergé.
 *
 * `null` quand rien n'a jamais été reçu — une absence, jamais une invention.
 */
export const company = asyncHandler(async (req, res) => ok(res, {
  company: await getCompanyConfiguration(),
  paired: isPaired(),
}));

export const status = asyncHandler(async (req, res) => {
  const pairing = describePairing();
  const bridge = getPanelBridge();
  const company = await getCompanyConfiguration();

  return ok(res, {
    paired: isPaired(),
    pairing: {
      panelUrl: pairing.panelUrl ?? null,
      panelName: pairing.panelName ?? null,
      projectId: pairing.projectId ?? null,
      pairedAt: pairing.pairedAt ?? null,
    },
    bridge: bridge ? bridge.describe?.() ?? { state: bridge.state } : null,
    /**
     * L'ÉTAT DE LA FILE — « appairé » ne veut pas dire « ça passe ».
     *
     * Cet écran affichait l'état du PONT (CONNECTED/DEGRADED), qui ne décrit
     * que le transport. Une instance dont toutes les écritures métier sont
     * refusées par le contrat du Panel affiche CONNECTED : le transport va
     * très bien, c'est la livraison qui n'aboutit pas. Sans cette ligne, la
     * seule trace du blocage était un journal.
     */
    outbox: await describeOutboxHealth(),
    scheduler: describeScheduler(),
    company,
    // Ce que le .env propose, pour que l'écran puisse pré-remplir sans que
    // l'opérateur retape une URL qu'il a déjà configurée.
    suggested: {
      panelUrl: config.panel.url,
      publicBackendUrl: config.panel.publicBackendUrl,
      hasPairingCode: Boolean(config.panel.pairingCode),
    },
  });
});

/**
 * APPAIRAGE. Le code est à usage unique côté Panel : une tentative avec un
 * mauvais code le consomme quand même. On le rappelle dans le message d'échec
 * plutôt que de laisser l'opérateur réessayer indéfiniment.
 */
export const pair = asyncHandler(async (req, res) => {
  const panelUrl = String(req.body?.panelUrl ?? config.panel.url ?? '').trim();
  const pairingCode = String(req.body?.pairingCode ?? config.panel.pairingCode ?? '').trim();
  const publicBackendUrl =
    String(req.body?.publicBackendUrl ?? config.panel.publicBackendUrl ?? '').trim() || null;

  if (!panelUrl || !pairingCode) {
    return res.status(400).json({
      success: false,
      code: 'PANEL_PAIRING_INCOMPLETE',
      message:
        'Appairage impossible parce que l’URL du Panel et le code d’appairage sont tous deux requis.',
    });
  }

  /**
   * LE REFUS DU PANEL N'EST PAS UN REFUS DE NOTRE SESSION.
   *
   * Dans le contrat du pont, un code d'appairage invalide vaut 401 — c'est le
   * Panel qui refuse le code. Relayé tel quel, ce 401 arrivait au Manager sur
   * une route où il ne peut vouloir dire qu'une chose : « votre session a
   * expiré ». L'opérateur, authentifié et légitime, était déconnecté pour une
   * faute de frappe.
   *
   * On traduit donc à la frontière : l'appelant EST authentifié (la route
   * l'exige déjà), c'est l'APPAIRAGE qui est refusé. 422, avec le code et le
   * message d'origine intacts — rien n'est masqué, seule la catégorie HTTP est
   * remise à sa place.
   */
  let pairing;
  try {
    pairing = await pairWithPanel({ panelUrl, pairingCode, publicBackendUrl });
  } catch (err) {
    if (err?.statusCode === 401) {
      return res.status(422).json({
        success: false,
        code: err.details?.code ?? err.code ?? 'PANEL_PAIRING_REFUSED',
        message: err.message ?? 'Le Panel a refusé cet appairage.',
      });
    }
    throw err;
  }
  return res.status(201).json({
    success: true,
    data: {
      paired: true,
      panelName: pairing.panelName,
      panelUrl: pairing.panelUrl,
      projectId: pairing.projectId,
      // Ce que le Panel a joint : l'opérateur voit immédiatement si la
      // découverte a fonctionné, ou si le projet est appairé mais aveugle.
      discovered: {
        company: pairing.discovery?.company?.identity?.name ?? null,
        companyVersion: pairing.discovery?.company?.version ?? null,
        /**
         * Les API intégrées ne sont PLUS appliquées (lot L4) : un Panel à jour
         * n'en envoie plus, et celles d'un Panel antérieur sont refusées. On
         * affiche donc ce qu'on a REFUSÉ, et non ce qu'on aurait reçu — c'est
         * la seule lecture honnête pour l'opérateur qui appaire.
         */
        integratedApisRefused: (pairing.discovery?.integratedApis ?? []).length,
      },
    },
  });
});

/** DÉSAPPAIRAGE — best-effort côté Panel, toujours effectif localement. */
export const unpair = asyncHandler(async (req, res) => {
  const result = await unpairFromPanel();
  return ok(res, result);
});

/**
 * Cycles à la demande. Utile en recette : on ne veut pas attendre la cadence
 * pour vérifier qu'un heartbeat passe ou qu'une configuration arrive.
 */
export const syncNow = asyncHandler(async (req, res) => {
  const [heartbeat, sync] = await Promise.all([runHeartbeatCycle(), runSyncCycle()]);
  return ok(res, { heartbeat, sync });
});
