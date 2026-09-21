/**
 * « CETTE INTEGRATED API DOIT-ELLE QUELQUE CHOSE AU DÉMARRAGE ? » — et l'a-t-elle fait ?
 *
 * ══ POURQUOI CE MODULE EXISTE, ET POURQUOI IL NE CITE AUCUN FOURNISSEUR ═════
 *
 * Le démarrage savait réconcilier des webhooks. Il ne savait pas RÉPONDRE à la
 * question ci-dessus — d'où la ligne « réconciliation sautée (PANEL_NOT_PAIRED) »
 * qui ne coûtait rien à personne : aucun code n'avait à en rendre compte.
 *
 * Deux questions, une seule surface :
 *
 *   1. QUE DOIT ce fournisseur au démarrage ? — déduit du CATALOGUE (autorité,
 *      champs requis) et du REGISTRE de webhooks gérés. Jamais d'un `if
 *      provider === 'STRIPE'`.
 *   2. L'A-T-IL FAIT ? — déduit du rapport de réconciliation, jamais de
 *      l'existence d'une ligne en base.
 *
 * Le résultat est un état du vocabulaire commun (`INTEGRATED_API_STARTUP`), une
 * PREUVE quand c'est un succès, et — quand la dépendance manquante peut
 * revenir — un travail de reprise inscrit au gestionnaire.
 *
 * ══ LA DISTINCTION QUI PORTE TOUT LE LOT ════════════════════════════════════
 *
 * Un geste sauté n'a pas UNE cause, il en a deux espèces :
 *
 *   · DÉFINITIVE pour ce démarrage — le fournisseur est désactivé, sa clé n'est
 *     pas renseignée, la plateforme s'en charge. Rien n'était dû : `NOT_REQUIRED`.
 *   · TRANSITOIRE — le Panel n'était pas encore appairé, l'adresse publique
 *     n'existait pas encore, le registre n'a pas répondu. Quelque chose ÉTAIT
 *     dû : `DEGRADED_RETRYING`, et une reprise est inscrite.
 *
 * Confondre les deux est exactement ce qui produisait le faux « API PRÊTE ».
 */
import { IntegratedApi } from '../../models/IntegratedApi.model.js';
import {
  activeProviders,
  requiredFieldKeys,
  isPanelAuthority,
} from '../../utils/integratedApiCatalog.js';
import { integrationWebhookProviders } from '../webhooks/integrationWebhookProviders.js';
import { MANAGED_WEBHOOKS } from '../webhooks/managedWebhookRegistry.js';
import {
  INTEGRATED_API_STARTUP,
  recordIntegratedApi,
  updateIntegratedApi,
} from './bootstrapReport.service.js';
import { registerStartupJob } from './startupReconciliation.service.js';
import { config } from '../../config/env.js';

/**
 * MOTIFS DÉFINITIFS pour ce démarrage — rien n'était dû, et le dire est exact.
 *
 * `*_DISABLED` : quelqu'un a coupé le fournisseur ; le rallumer est une action
 * humaine, pas une reprise. `API_KEY_MISSING` : la fonctionnalité n'est pas
 * configurée — l'état normal d'un projet qui n'envoie pas d'e-mail.
 */
const MOTIFS_DEFINITIFS = new Set([
  'PROVIDER_DISABLED',
  'BREVO_DISABLED',
  'API_KEY_MISSING',
  'REMOTE_SYNC_UNSUPPORTED',
]);

/**
 * MOTIFS ARMÉS — la dépendance ne reviendra pas d'elle-même, elle ARRIVERA.
 *
 * ── `PANEL_NOT_PAIRED` ──────────────────────────────────────────────────────
 *
 * L'audit tourne APRÈS la restauration de l'appairage : si le provisionneur
 * répond encore « non appairé », c'est que le projet EST autonome, pas qu'il
 * a couru trop vite. Reprogrammer toutes les quinze secondes marèlerait un
 * rendez-vous que personne n'a pris, puis conclurait à l'épuisement alors que
 * rien n'a échoué. On arme, et l'observateur d'appairage déclenche.
 *
 * ── `URL_NOT_PUBLIC`, ET POURQUOI IL DÉPEND DU MONDE ────────────────────────
 *
 * En développement, l'absence de tunnel est un état de travail parfaitement
 * normal : la veille de tunnel est justement l'événement qui débloque. En
 * PRODUCTION, l'adresse publique est écrite par le déploiement — son absence
 * est une anomalie qui peut se résoudre seule, donc une VRAIE reprise.
 */
const MOTIFS_ARMES = new Set(['PANEL_NOT_PAIRED']);

/**
 * MOTIFS TRANSITOIRES connus. La liste est indicative : tout motif INCONNU est
 * traité comme transitoire. Se tromper dans ce sens coûte une reprise inutile ;
 * se tromper dans l'autre ressuscite le défaut qu'on corrige.
 */
const MOTIFS_TRANSITOIRES = new Set([
  'REGISTRY_UNAVAILABLE',
  'RECONCILIATION_TIMEOUT',
  'RECONCILIATION_NOT_RUN',
]);

function classerMotif(reason) {
  const code = String(reason || '').toUpperCase();
  if (MOTIFS_DEFINITIFS.has(code)) return 'DEFINITIF';
  if (MOTIFS_ARMES.has(code)) return 'ARME';
  if (code === 'URL_NOT_PUBLIC') return config.isProd ? 'TRANSITOIRE' : 'ARME';
  if (MOTIFS_TRANSITOIRES.has(code)) return 'TRANSITOIRE';
  return 'TRANSITOIRE';
}

/** Phrase humaine pour un motif — jamais un code nu dans le journal. */
const PHRASES = Object.freeze({
  PANEL_NOT_PAIRED: 'projet autonome — le provisionnement appartient au Panel ; réconciliation ARMÉE, elle partira dès l’appairage',
  URL_NOT_PUBLIC: 'aucune adresse publique HTTPS (tunnel absent en dev, domaine non déployé)',
  REGISTRY_UNAVAILABLE: 'registre IntegratedAPI illisible',
  RECONCILIATION_TIMEOUT: 'délai de réconciliation dépassé',
  RECONCILIATION_NOT_RUN: 'réconciliation non exécutée',
  PROVIDER_DISABLED: 'fournisseur désactivé',
  BREVO_DISABLED: 'fournisseur désactivé',
  API_KEY_MISSING: 'aucun identifiant renseigné — fonctionnalité non configurée',
  REMOTE_SYNC_UNSUPPORTED: 'aucun webhook géré à distance',
  PANEL_AUTHORITY: 'administrée par la plateforme — aucune initialisation locale requise',
  NO_STARTUP_ACTION: 'aucune action de démarrage requise',
  CREDENTIALS_NOT_CONFIGURED: 'identifiants requis non renseignés — non configurée',
  NOT_REGISTERED: 'absente du registre local',
});

const phrase = (code) => PHRASES[String(code || '').toUpperCase()] || String(code || '');

/** Les credentials d'un mode, lus indifféremment sur un `Map` ou un objet nu. */
function lireCredential(doc, mode, cle) {
  const creds = doc?.modes?.[mode]?.credentials;
  if (!creds) return null;
  return (creds instanceof Map ? creds.get(cle) : creds[cle]) ?? null;
}

/**
 * LES CAPACITÉS DÉCLARÉES d'un fournisseur — lues au REGISTRE, jamais devinées.
 *
 * ── POURQUOI CE DÉTOUR ─────────────────────────────────────────────────────
 *
 * Quand la réconciliation n'a rendu AUCUN résultat — délai dépassé, driver qui
 * a levé — on ne sait pas de quoi elle aurait parlé. Inventer une capacité
 * « webhook » générique produirait une clé de reprise différente de celle que
 * le démarrage suivant emploierait (`payment`), et le même geste finirait
 * inscrit DEUX fois : deux lignes dégradées pour un seul webhook, et un
 * décompte de reprises qui ment.
 *
 * On énumère donc les catégories que le registre déclare : la clé est la même,
 * quel que soit le chemin par lequel l'incident est arrivé.
 */
function capacitesDeclarees(provider) {
  const cles = Object.keys(MANAGED_WEBHOOKS[provider] ?? {});
  return cles.length > 0 ? cles : ['webhook'];
}

/** Les fournisseurs qui possèdent un webhook géré à distance, par code. */
function providersWebhook() {
  const table = new Map();
  for (const p of integrationWebhookProviders()) {
    if (typeof p.supportsWebhooks === 'function' && p.supportsWebhooks()) {
      table.set(p.providerCode(), p);
    }
  }
  return table;
}

/**
 * TRADUIT le constat d'UNE réconciliation de webhook en état de démarrage.
 *
 * C'est la seule fonction du projet autorisée à décider qu'un webhook est
 * « prêt ». Elle exige une PREUVE dans les deux cas favorables : soit le
 * fournisseur distant a été corrigé, soit il a été RELU et trouvé conforme.
 * Une ligne en base ne prouve ni l'un ni l'autre.
 */
export function statusFromWebhookResult(resultat) {
  if (!resultat) {
    return {
      status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
      reason: 'RECONCILIATION_NOT_RUN',
      detail: phrase('RECONCILIATION_NOT_RUN'),
      retryable: true,
    };
  }
  if (resultat.skipped) {
    const espece = classerMotif(resultat.reason);
    if (espece === 'DEFINITIF') {
      return {
        status: INTEGRATED_API_STARTUP.NOT_REQUIRED,
        reason: resultat.reason,
        detail: phrase(resultat.reason),
        retryable: false,
        gated: false,
      };
    }
    if (espece === 'ARME') {
      /**
       * ARMÉ — c'est le remplaçant EXACT de l'ancien « réconciliation sautée ».
       *
       * Même constat, mais il ne meurt plus dans le journal : un travail est
       * inscrit, `/readyz` le nomme, et l'arrivée de la dépendance le déclenche
       * sans qu'aucun redémarrage soit nécessaire.
       */
      return {
        status: INTEGRATED_API_STARTUP.DEFERRED,
        reason: resultat.reason,
        detail: phrase(resultat.reason),
        retryable: true,
        gated: true,
      };
    }
    return {
      status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
      reason: resultat.reason || 'SKIPPED',
      detail: phrase(resultat.reason),
      retryable: true,
      gated: false,
    };
  }
  if (resultat.ok) {
    const corrige = Boolean(resultat.created || resultat.updated || resultat.adopted);
    return {
      status: corrige ? INTEGRATED_API_STARTUP.READY_RECONCILED : INTEGRATED_API_STARTUP.READY,
      proof: corrige
        ? `webhook distant ${resultat.created ? 'créé' : resultat.updated ? 'corrigé' : 'adopté'} et vérifié`
        : 'webhook distant relu et trouvé conforme',
      retryable: false,
    };
  }
  return {
    status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
    reason: resultat.error?.code || 'RECONCILIATION_FAILED',
    detail: resultat.error?.message || 'réconciliation distante impossible',
    retryable: true,
  };
}

/** La clé STABLE d'une reprise — même geste, même clé, jamais deux travaux. */
export function webhookJobKey(provider, capability, mode) {
  return `webhook:${provider}:${capability}:${mode}`;
}

/**
 * Inscrit la reprise d'UN webhook. Le travail rejoue exactement le geste du
 * démarrage — même orchestrateur, même idempotence — et met à jour le rapport
 * pour que `/readyz` cesse d'annoncer un incident résolu.
 */
function inscrireRepriseWebhook({ provider, capability, mode, reason, detail, gated = false }) {
  const key = webhookJobKey(provider, capability, mode);
  registerStartupJob({
    key,
    provider,
    capability,
    label: `${provider}/${capability} (${mode})`,
    reason,
    detail,
    gated,
    run: async () => {
      const { ensureProviderWebhooks } = await import('../webhooks/webhookOrchestrator.service.js');
      const rapport = await ensureProviderWebhooks(provider, mode);
      if (rapport?.error) {
        const verdict = {
          ok: false,
          /**
           * Une panne au niveau du driver n'est jamais « en attente d'une
           * dépendance » : elle se retente. On le DIT, pour qu'un travail
           * jusqu'ici armé bascule en reprise ordinaire et reçoive une échéance.
           */
          gated: false,
          reason: rapport.error.code,
          detail: rapport.error.message || '',
        };
        updateIntegratedApi(provider, capability, {
          status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
          reason: verdict.reason,
          detail: verdict.detail,
        });
        return verdict;
      }
      const resultat = (rapport?.results || []).find((r) => r.category === capability)
        ?? (rapport?.results || [])[0]
        ?? null;
      const etat = statusFromWebhookResult(resultat);
      updateIntegratedApi(provider, capability, {
        status: etat.status,
        reason: etat.reason || '',
        detail: etat.detail || '',
        proof: etat.proof || '',
      });
      if (etat.status === INTEGRATED_API_STARTUP.READY
        || etat.status === INTEGRATED_API_STARTUP.READY_RECONCILED) {
        return { ok: true, detail: etat.proof };
      }
      // Toujours armé : la dépendance n'est pas encore là, on attend l'événement.
      if (etat.status === INTEGRATED_API_STARTUP.DEFERRED) {
        return { ok: false, gated: true, reason: etat.reason, detail: etat.detail };
      }
      // Plus rien n'est dû : on retire le travail au lieu de le reprendre pour rien.
      if (etat.status === INTEGRATED_API_STARTUP.NOT_REQUIRED) {
        return { ok: false, done: true, reason: etat.reason, detail: etat.detail };
      }
      /**
       * La dépendance est là, mais le geste a échoué : ce n'est plus une
       * attente, c'est une reprise. Le drapeau le dit, et le gestionnaire
       * reclasse le travail — sans quoi un projet appairé dont la première
       * tentative tombe sur un 503 resterait armé jusqu'au redémarrage.
       */
      return { ok: false, gated: false, reason: etat.reason, detail: etat.detail };
    },
  });
  return key;
}

/**
 * L'AUDIT DE DÉMARRAGE DE TOUTES LES INTEGRATED APIs.
 *
 * @param {object} args
 * @param {'TEST'|'PROD'} args.mode       le monde fournisseur réconcilié
 * @param {object|null} args.webhookReport rapport `ensureAllWebhooks` (null = non exécuté / expiré)
 * @param {string} [args.reconciliationFailure] motif quand le rapport est absent
 * @returns {Promise<{entries: object[], retries: string[]}>}
 */
export async function auditIntegratedApiStartup({
  mode, webhookReport = null, reconciliationFailure = 'RECONCILIATION_NOT_RUN',
}) {
  const webhookables = providersWebhook();
  const parProvider = new Map(
    (webhookReport?.providers || []).map((p) => [p.provider, p])
  );

  const entries = [];
  const retries = [];

  for (const definition of activeProviders()) {
    const provider = definition.provider;

    let doc = null;
    try {
      doc = await IntegratedApi.findOne({ provider }).lean();
    } catch {
      doc = null;
    }

    /* ── 1. Le fournisseur est-il seulement inscrit et allumé ? ───────────── */

    if (!doc) {
      entries.push(recordIntegratedApi({
        provider,
        status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
        reason: 'NOT_REGISTERED',
        detail: phrase('NOT_REGISTERED'),
      }));
      continue;
    }
    if (!doc.enabled) {
      entries.push(recordIntegratedApi({
        provider,
        status: INTEGRATED_API_STARTUP.DISABLED,
        reason: 'PROVIDER_DISABLED',
        detail: phrase('PROVIDER_DISABLED'),
      }));
      continue;
    }

    /* ── 2. Ses identifiants requis sont-ils présents ? ───────────────────── */

    const requis = requiredFieldKeys(provider);
    const manquants = requis.filter((cle) => !lireCredential(doc, mode, cle));

    /**
     * ── CE QUI EST CONNU LOCALEMENT SE TRANCHE LOCALEMENT ────────────────────
     *
     * Un fournisseur dont les identifiants requis manquent n'a RIEN à faire au
     * démarrage : ni webhook, ni appel. On le dit ici, avant même de regarder
     * le rapport de réconciliation.
     *
     * L'ordre compte. En le laissant plus bas, l'état de Brevo dépendait de ce
     * que le rapport avait répondu — et lorsque celui-ci manquait (délai
     * dépassé), un fournisseur volontairement non configuré se retrouvait
     * « dégradé, reprise programmée ». On aurait retenté cinq fois d'installer
     * le webhook d'un compte qui n'existe pas.
     */
    if (requis.length > 0 && manquants.length > 0) {
      entries.push(recordIntegratedApi({
        provider,
        status: INTEGRATED_API_STARTUP.NOT_REQUIRED,
        reason: 'CREDENTIALS_NOT_CONFIGURED',
        detail: `${phrase('CREDENTIALS_NOT_CONFIGURED')} (${manquants.join(', ')})`,
      }));
      continue;
    }

    /* ── 3. A-t-il un webhook géré, et qu'en dit la réconciliation ? ──────── */

    const pilote = webhookables.get(provider);
    if (pilote) {
      const rapportProvider = parProvider.get(provider) ?? null;

      // Panne au niveau du provider entier (le driver a levé) : chaque capacité
      // déclarée reçoit son constat, sous la MÊME clé que les autres chemins.
      if (rapportProvider?.error) {
        for (const capability of capacitesDeclarees(provider)) {
          const key = inscrireRepriseWebhook({
            provider, capability, mode,
            reason: rapportProvider.error.code,
            detail: rapportProvider.error.message,
          });
          retries.push(key);
          entries.push(recordIntegratedApi({
            provider,
            capability,
            status: INTEGRATED_API_STARTUP.DEGRADED_RETRYING,
            reason: rapportProvider.error.code,
            detail: rapportProvider.error.message || 'réconciliation impossible',
            retryKey: key,
          }));
        }
        continue;
      }

      /**
       * Le rapport est ABSENT (délai dépassé, orchestrateur non lancé) : on ne
       * sait rien, et « ne rien savoir » ne s'écrit pas `[ ok ]`. On énumère
       * alors les catégories déclarées au registre pour ne perdre aucun geste.
       */
      const resultats = rapportProvider?.results?.length
        ? rapportProvider.results
        : capacitesDeclarees(provider).map((category) => ({
          category, skipped: true, reason: reconciliationFailure,
        }));

      for (const resultat of resultats) {
        const capability = resultat.category || 'webhook';
        const etat = statusFromWebhookResult(resultat);
        let key = null;
        if (etat.retryable) {
          key = inscrireRepriseWebhook({
            provider, capability, mode, reason: etat.reason, detail: etat.detail, gated: etat.gated,
          });
          // Seules les reprises NON armées reçoivent une échéance : les autres
          // attendent leur événement, et l'appelant n'a rien à programmer.
          if (!etat.gated) retries.push(key);
        }
        entries.push(recordIntegratedApi({
          provider,
          capability,
          status: etat.status,
          reason: etat.reason || '',
          detail: etat.detail || '',
          proof: etat.proof || '',
          retryKey: key,
        }));
      }
      continue;
    }

    /* ── 4. Aucun webhook géré : que reste-t-il à devoir ? ────────────────── */

    if (isPanelAuthority(provider)) {
      /**
       * ADMINISTRÉE PAR LA PLATEFORME — et c'est un état PRÊT, pas un manque.
       *
       * Vérifier ici sa disponibilité réelle exigerait un aller-retour vers le
       * Panel par fournisseur, à chaque démarrage, pour une information qui
       * sera de toute façon revérifiée au premier usage métier. On dit donc ce
       * qu'on sait — rien n'est dû localement — plutôt que d'inventer un `ok`.
       */
      entries.push(recordIntegratedApi({
        provider,
        status: INTEGRATED_API_STARTUP.NOT_REQUIRED,
        reason: 'PANEL_AUTHORITY',
        detail: phrase('PANEL_AUTHORITY'),
      }));
      continue;
    }

    if (requis.length === 0) {
      entries.push(recordIntegratedApi({
        provider,
        status: INTEGRATED_API_STARTUP.NOT_REQUIRED,
        reason: 'NO_STARTUP_ACTION',
        detail: phrase('NO_STARTUP_ACTION'),
      }));
      continue;
    }

    entries.push(recordIntegratedApi({
      provider,
      status: INTEGRATED_API_STARTUP.READY,
      proof: `identifiants requis présents et déchiffrables (${requis.join(', ')})`,
    }));
  }

  return { entries, retries };
}

/**
 * REJOUE les réconciliations restées dues — appelé quand une dépendance
 * structurante apparaît (appairage du Panel restauré ou établi).
 *
 * Exporté séparément pour que `config/bootstrap.js` puisse le brancher sur
 * l'observateur d'appairage sans importer le gestionnaire de reprises.
 */
export async function replayStartupReconciliations(trigger = 'panel-paired') {
  const { runPendingStartupJobs } = await import('./startupReconciliation.service.js');
  return runPendingStartupJobs({ trigger });
}

export default {
  auditIntegratedApiStartup,
  statusFromWebhookResult,
  webhookJobKey,
  replayStartupReconciliations,
};
