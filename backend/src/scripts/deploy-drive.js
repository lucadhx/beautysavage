#!/usr/bin/env node
// PILOTE LE MOTEUR OFFICIEL DE DÉPLOIEMENT DE CE PROJET, depuis une console.
//
// ── CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────────────
//
// L'écran « Déploiement » du Manager fait quatre gestes : il ouvre une session
// de mot de passe SSH, vérifie les prérequis locaux, construit l'environnement
// distant, puis appelle `engine.deployWithReport()` en relayant ses événements.
// Ce script fait les mêmes quatre gestes, avec les mêmes fonctions.
//
// Il ne réimplémente AUCUNE étape du pipeline : ni upload, ni build, ni bascule,
// ni nginx, ni PM2, ni contrôle de santé, ni ouverture SSH. Un script qui
// « déploierait presque comme le moteur » finirait par en diverger, et le
// premier écart se découvrirait en production.
//
// Usage :
//   node src/scripts/deploy-drive.js --list
//   node src/scripts/deploy-drive.js --create-target --name "…" --url https://… --env TEST --ssh-host <ip>
//   node src/scripts/deploy-drive.js --network --target <id>        (les 3 URL publiques, AVANT de déployer)
//   node src/scripts/deploy-drive.js --target <id> [--preflight]

import process from 'node:process';

import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { DeploymentTarget } from '../models/DeploymentTarget.model.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { buildRemoteEnv, describeRemoteEnv } from '../deployment-engine/deployEnv.js';
import * as vault from '../deployment-engine/passwordVault.js';
import * as runs from '../services/deploymentRun.service.js';
import { syncRuntimeNetworkConfiguration, deriveNetworkUrls } from '../deployment-engine/runtimeConfig.js';
import { planTopology } from '../deployment-engine/topology.js';
import profile from '../deployment-engine/config/project.profile.js';
import { resolveDnsProvider } from '../integrations/hostinger/dnsProviderResolution.js';
import { cliCapabilityInvoker } from './lib/cliBridge.js';
import * as ports from '../services/deployment/portRegistry.service.js';
import * as targets from '../services/deploymentTarget.service.js';
import { pm2AppName } from '../deployment-engine/pm2.js';
import { SshTransport } from '../deployment-engine/transport/SshTransport.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);
const ACTEUR = 'deploy-drive@console';

async function main() {
  await connectDatabase();

  if (has('list')) {
    for (const t of await DeploymentTarget.find({}).lean()) {
      console.log(`${t._id}  ${String(t.environment).padEnd(4)}  ${String(t.host).padEnd(34)}  ssh=${t.sshUser}@${t.sshHost}:${t.sshPort ?? 22}  port=${t.backendPort}`);
    }
    await disconnectDatabase();
    return;
  }

  /**
   * ══ CRÉER LA DESTINATION — le geste qui n'avait PAS de porte en console ═══
   *
   * Le guide de fabrication dit « Créez la destination, puis déployez », et ne
   * donne de commande que pour la seconde moitié de la phrase. La première se
   * faisait donc à l'écran, en DEV — c'est-à-dire APRÈS l'activation du premier
   * compte, laquelle passe par un courriel envoyé par le Panel, lequel exige
   * l'appairage. Un projet neuf ne pouvait pas franchir cette étape sans un
   * humain devant un navigateur, alors que tout le reste de la fabrique s'exécute.
   *
   * C'est exactement le manque que ce pilote existe pour combler côté
   * déploiement — et pour la même raison : ce qui n'a pas de porte officielle
   * se fait par un script hors dépôt et hors garde.
   *
   * Il n'y a AUCUNE logique ici. `createTarget` est le service que le
   * contrôleur HTTP appelle, avec les mêmes règles : environnement exigé,
   * unicité de l'hôte, unicité de la destination active, port réservé au
   * registre. Un pilote qui « créerait presque comme l'écran » finirait par en
   * diverger.
   *
   * Usage :
   *   node src/scripts/deploy-drive.js --create-target \
   *     --name "Demo Inter Racing Kart" \
   *     --url https://demo-irk-karting.ly-solution.com \
   *     --env TEST --ssh-host 195.35.0.211 [--ssh-user root] [--remote-root /var/www]
   */
  if (has('create-target')) {
    const manquants = [['--name', arg('name')], ['--url', arg('url')], ['--env', arg('env')]]
      .filter(([, v]) => !v).map(([k]) => k);
    if (manquants.length) {
      console.error(`✗ Création refusée — information(s) manquante(s) : ${manquants.join(', ')}.`);
      await disconnectDatabase();
      process.exitCode = 2;
      return;
    }
    const cree = await targets.createTarget({
      name: arg('name'),
      url: arg('url'),
      environment: arg('env'),
      dbName: arg('db-name') || null,
      remoteRoot: arg('remote-root') || undefined,
      sshHost: arg('ssh-host') || null,
      sshUser: arg('ssh-user') || undefined,
    });
    console.log('\n✓ DESTINATION CRÉÉE');
    console.log(`  id          : ${cree.id}`);
    console.log(`  hôte        : ${cree.host} (${cree.environment})`);
    console.log(`  serveur     : ${cree.sshUser}@${cree.sshHost ?? '—'}`);
    console.log(`  port réservé: ${cree.backendPort}`);
    console.log(`  racine      : ${cree.remoteRoot}\n`);
    console.log('  Suite : --target <id> --preflight, puis --target <id>.\n');
    await disconnectDatabase();
    return;
  }

  /**
   * ══ ANNONCER LES TROIS URL PUBLIQUES — §6 du guide, AVANT le déploiement ══
   *
   * Le guide est catégorique : « la destination active est ANNONCÉE PAR LE
   * PROJET d'après SA configuration réseau », et un projet qui n'annonce que
   * `localhost` se voit refuser son propre domaine par la capacité DNS du
   * Panel (`CAPABILITY_RESOURCE_NOT_OWNED`). Le DNS redevient alors manuel —
   * exactement ce qui est arrivé au premier projet client.
   *
   * Or l'écran qui écrit ces trois URL est en DEV, donc derrière un compte
   * activé par courriel, donc derrière l'appairage. §6 vient AVANT §7 dans le
   * guide : au moment où il faut l'exécuter, l'écran n'est pas atteignable.
   *
   * Ce geste écrit par le MOTEUR, jamais à la main : `deriveNetworkUrls` et
   * `syncRuntimeNetworkConfiguration` sont les deux fonctions que le pipeline
   * appelle à l'étape `runtime_config`. Les hôtes viennent de `planTopology`,
   * donc du profil du projet — le sous-domaine du manager n'est pas épelé ici.
   *
   * Usage :
   *   node src/scripts/deploy-drive.js --network --target <id>
   */
  if (has('network')) {
    const id = arg('target');
    if (!id) throw new Error('--target requis');
    const cible = await DeploymentTarget.findById(id);
    if (!cible) throw new Error(`Destination inconnue : ${id}`);

    const topo = planTopology({ host: cible.host, remoteRoot: cible.remoteRoot, profile });
    const urls = deriveNetworkUrls({ siteHost: cible.host, apiHost: topo.apiHost, topology: topo });
    /**
     * LA BASE DE LA DESTINATION, LUE DANS LE `.env` — pas dans `config`.
     *
     * `config.dbName` ne porte que la base de l'ENV COURANT du processus :
     * piloter une destination PROD depuis un backend en TEST écrirait dans la
     * mauvaise base. Le pipeline lit `remoteEnv.DB_TEST` / `remoteEnv.DB_PROD`
     * pour la même raison ; ici, la source est le `.env` local, qui porte les
     * deux noms.
     */
    const dbName = String(cible.environment).toUpperCase() === 'PROD'
      ? process.env.DB_PROD
      : process.env.DB_TEST;
    if (!dbName) throw new Error(`Base introuvable pour l'environnement ${cible.environment} (DB_TEST/DB_PROD absents du .env).`);

    console.log(`\n▸ CONFIGURATION RÉSEAU — « ${cible.name} » (${cible.environment}) · base ${dbName}`);
    for (const [k, v] of Object.entries(urls)) console.log(`  ${k.padEnd(12)} ${v}`);

    const res = await syncRuntimeNetworkConfiguration({
      mongoUri: config.mongoUri, dbName, urls, requirePublic: true,
    });
    console.log(`\n✓ ${res.created ? 'créée' : 'mise à jour'} — relue et vérifiée.`);
    console.log('  Le projet annoncera cette destination à son prochain battement vers le Panel.\n');
    await disconnectDatabase();
    return;
  }

  const targetId = arg('target');
  if (!targetId) throw new Error('--target requis');
  const password = process.env.VPS_PASS;
  if (!password) throw new Error('VPS_PASS absent de l’environnement : le moteur exige un mot de passe SSH.');

  const target = await DeploymentTarget.findById(targetId);
  if (!target) throw new Error(`Destination inconnue : ${targetId}`);
  const operationType = has('preflight') ? 'PRECHECK' : 'DEPLOYMENT';

  console.log(`\n▸ ${operationType} — « ${target.name} » (${target.environment}) · ${target.host}`);
  console.log(`  ssh ${target.sshUser}@${target.sshHost}:${target.sshPort ?? 22} · base ${config.dbName}`);

  const engine = new DeploymentEngine();

  /** Prérequis locaux — mêmes contrôles que l'écran, notamment « source propre ». */
  const local = await engine.checkLocalPrerequisites({ env: target.environment });
  if (!local.ok) {
    console.error('\n✗ prérequis locaux non remplis :');
    for (const c of local.failedChecks ?? []) console.error(`  · ${c.id}${c.detail ? ` — ${c.detail}` : ''}`);
    await disconnectDatabase();
    process.exitCode = 1;
    return;
  }

  const built = buildRemoteEnv(target, { env: target.environment });
  const resume = describeRemoteEnv(built);
  console.log(`  environnement distant : ${resume?.count ?? Object.keys(built.remoteEnv ?? {}).length} variable(s)`);

  /**
   * ══ LE DNS AUTOMATIQUE N'ÉTAIT PAS CÂBLÉ ICI, ET PERSONNE NE LE VOYAIT ════
   *
   * Le contrôleur résout le fournisseur DNS par la capacité `dns.*` du Panel,
   * puis le passe au moteur. Ce pilote ne le faisait pas : il n'a jamais eu de
   * client de capacités, donc chaque déploiement en ligne de commande partait
   * en `DNS_PATH_NONE` — « gestion automatique du domaine non configurée » —
   * et exigeait une vérification DNS manuelle.
   *
   * L'avertissement était visible à chaque exécution, et se lisait comme une
   * propriété de l'environnement plutôt que comme un manque de l'outil. C'est
   * précisément la forme que prend un geste manuel qui s'installe : personne ne
   * le décide, tout le monde s'y habitue.
   *
   * Le pilote configure donc le pont exactement comme le serveur, et pose la
   * même question au même endroit. Si le projet n'est pas appairé, la réponse
   * est la même qu'avant — un motif nommé, jamais un contournement.
   */
  const invoke = await cliCapabilityInvoker();
  const dns = await resolveDnsProvider({
    siteHost: target.host,
    runId: null,
    invoke,
  }).catch((err) => ({
    available: false, path: 'NONE', provider: null,
    reason: `PANEL_UNAVAILABLE:${err?.code ?? 'ERROR'}`,
  }));
  console.log(`  DNS : ${dns.path === 'PANEL_CAPABILITY' ? 'automatique (capacité Panel)' : `manuel — ${dns.reason ?? 'sans motif'}`}`);

  const version = await engine.getVersion().catch(() => null);
  const run = await runs.createRun({ target, user: ACTEUR, version, operationType });
  const runId = String(run._id);
  console.log(`  run ${runId}\n`);

  const { sessionId } = vault.openSession({
    host: target.sshHost,
    username: target.sshUser,
    password,
  });

  /**
   * ══ LE PORT, VÉRIFIÉ CONTRE LA MACHINE AVANT D'ÉCRIRE QUOI QUE CE SOIT ════
   *
   * Une destination créée depuis un écran n'a pas de session SSH : sa
   * réservation est faite sur la seule base, et le registre d'un projet NEUF
   * est vide. Il ignore donc tout ce qui tourne déjà sur le serveur PARTAGÉ.
   *
   * Le deuxième projet déployé sur une machine échouait ainsi en
   * `PM2_PORT_COLLISION` — après avoir écrit son Nginx et obtenu son
   * certificat. Ici, une session existe déjà : on pose la question AVANT, et
   * l'on corrige avant que le port n'entre dans une configuration.
   */
  const portTransport = new SshTransport({
    host: target.sshHost, username: target.sshUser, password,
  });
  try {
    const verdict = await ports.ensureUsablePort({
      target,
      transport: portTransport,
      expectedPm2Name: pm2AppName(target.host),
    });
    if (verdict.moved) {
      target.backendPort = verdict.port;
      await target.save?.();
      console.log(`  PORT : ${verdict.from} occupé — réattribué à ${verdict.port} (${verdict.reason})`);
      built.remoteEnv.PORT = String(verdict.port);
    } else {
      console.log(`  PORT : ${verdict.port} retenu${verdict.reason ? ` (${verdict.reason})` : ''}`);
    }
  } catch (err) {
    console.log(`  PORT : vérification impossible (${err?.message ?? err}) — le moteur tranchera avant démarrage.`);
  } finally {
    await portTransport.close?.().catch?.(() => null);
  }

  let resultat = null;
  try {
    resultat = await engine.deployWithReport({
      url: target.url,
      sessionId,
      user: ACTEUR,
      deploymentRunId: runId,
      /**
       * ── `options` N'EST PAS FACULTATIF, ET LE SERVEUR L'A PROUVÉ ──────────
       *
       * La première version de ce script l'omettait. Le pipeline est allé
       * jusqu'à `nginx.configure` avant d'écrire un `proxy_pass
       * http://127.0.0.1:undefined` : `backendPort` voyage par ici, comme le
       * reste de la configuration de destination.
       *
       * Le moteur a refusé sa propre configuration (`nginx -t`), désactivé le
       * site qu'il venait d'écrire et arrêté le déploiement AVANT toute
       * bascule — le service en ligne n'a jamais été touché. C'est exactement
       * le comportement attendu d'un pipeline qui vérifie ce qu'il produit ;
       * l'erreur était dans l'appelant, pas dans le moteur.
       *
       * Ces champs sont donc recopiés de l'écran, un par un. Ce qui manque ici
       * ne manque nulle part ailleurs : c'est le seul endroit où la destination
       * entre dans le moteur.
       */
      options: {
        targetId: String(target._id),
        targetName: target.name,
        operationType,
        preflightOnly: operationType === 'PRECHECK',
        remoteRoot: target.remoteRoot,
        backendPort: target.backendPort,
        env: target.environment,
        email: target.email ?? undefined,
        remoteEnv: built.remoteEnv,
        /** Le DNS, administré par la capacité du Panel — jamais par une clé locale. */
        dnsProvider: dns.available ? dns.provider : null,
        dnsSecret: null,
        dnsTtl: 300,
        dnsNotConfiguredReason: dns.available ? null : dns.reason,
        dnsPath: dns.path ?? 'NONE',
        dnsResolutionOpts: { timeoutMs: 30_000, minIntervalMs: 3_000, maxIntervalMs: 10_000 },
        sshHost: target.sshHost,
        sshUser: target.sshUser,
        /** Écrit les URLs HTTPS dans la base de la destination après bascule. */
        runtimeConfigSync: syncRuntimeNetworkConfiguration,

        /**
         * ══ LES MÉDIAS N'ÉTAIENT PAS CÂBLÉS ICI NON PLUS ═══════════════════
         *
         * Même défaut que le DNS, et découvert de la même façon : en fabriquant
         * un vrai projet. Le pipeline demande deux capacités à son appelant —
         * `adoptApplicationMedia` et `publishApplicationMedia` — et le
         * contrôleur HTTP les fournit. Ce pilote ne les fournissait pas.
         *
         * Or l'étape absente n'est pas signalée : le pipeline la déclare
         * « neutre, jamais bloquante » et rend `{ skipped: true }`. Les deux
         * lignes s'affichaient donc en VERT, `media.publish ✓`, sur un
         * déploiement qui n'avait rien publié.
         *
         * Ce que cela produisait : les fichiers arrivaient quand même sur le
         * serveur, portés par la copie du dossier `uploads` — un effet de bord
         * que le moteur qualifie lui-même de « tenté au mieux » depuis qu'il a
         * gagné `uploadFile`, précisément parce que cette copie ne peut PAS
         * porter la preuve. Les médias restaient donc `LOCAL_ONLY` en base :
         * servis, mais jamais constatés. Un projet dont on retire ensuite la
         * destination, ou dont on réconcilie les médias, part alors d'un état
         * qui décrit l'inverse de la réalité.
         *
         * Les deux capacités sont donc injectées, dans le même ordre et avec
         * les mêmes services que la route.
         */
        adoptApplicationMedia: operationType === 'PRECHECK' ? undefined : async ({ transport, backendDir, host }) => {
          const { runRemoteProjectMediaAdoption } = await import('../services/media/projectMediaAdoption.service.js');
          const issue = await runRemoteProjectMediaAdoption({ transport, backendDir });
          if (!issue.ok) {
            const { DeploymentError } = await import('../deployment-engine/errors.js');
            throw new DeploymentError(issue.code, issue.message, {
              step: 'project_media_adopt',
              details: { conflicts: issue.report?.conflicts?.slice(0, 10) ?? null, tail: issue.report ? null : issue.tail },
            });
          }
          const r = issue.report;
          if (r.created || r.attached) console.log(`     ${r.created} média(s) décrit(s), ${r.attached} fiche(s) raccrochée(s) sur ${host}.`);
          if (r.missing?.length) console.log(`     ! ${r.missing.length} référence(s) de fiche sans fichier.`);
          return r;
        },

        publishApplicationMedia: operationType === 'PRECHECK' ? undefined : async ({ transport, sharedUploads, host }) => {
          const { publishProjectMediaOnDestination } = await import('../services/media/projectMedia.service.js');
          const r = await publishProjectMediaOnDestination({
            transport, sharedUploads, host, environment: target.environment,
          });
          if (r.transferred.length || r.published) {
            console.log(`     ${r.transferred.length} média(s) transféré(s), ${r.published} publié(s) sur ${host}.`);
          }
          if (r.missing.length) console.log(`     ! ${r.missing.length} média(s) introuvables : ils restent locaux.`);
          return r;
        },
      },
      onEvent: (evt) => {
        if (evt.type === 'step.started') console.log(`  · ${evt.stepId}…`);
        else if (evt.type === 'step.succeeded') console.log(`  ✓ ${evt.stepId}${evt.message ? ` — ${evt.message}` : ''}`);
        else if (evt.type === 'step.warning') console.log(`  ! ${evt.stepId}${evt.message ? ` — ${evt.message}` : ''}`);
        else if (evt.type === 'step.skipped') console.log(`  – ${evt.stepId} (ignorée)`);
        else if (evt.type === 'step.failed') console.error(`  ✗ ${evt.stepId}${evt.message ? ` — ${evt.message}` : ''}`);
        else if (evt.type === 'deployment.failed') console.error(`  ✗ ${evt.errorCode ?? ''} ${evt.message ?? ''}`);
      },
    });
  } catch (err) {
    console.error(`\n✗ ${operationType} interrompu : ${err?.code ?? ''} ${err?.message ?? err}`);
    await runs.finalizeRun(runId, { ok: false, status: 'error', errorCode: err?.code ?? 'DRIVE_FAILED', message: String(err?.message ?? err) }).catch(() => null);
    vault.closeSession(sessionId);
    await disconnectDatabase();
    process.exitCode = 1;
    return;
  } finally {
    vault.closeSession(sessionId);
  }

  await runs.finalizeRun(runId, resultat).catch((e) => console.warn(`  (journal non clos : ${e?.message})`));

  const ok = resultat?.ok !== false;
  console.log(`\n${ok ? '✓' : '✗'} ${operationType} — ${resultat?.status ?? (ok ? 'ok' : 'error')}`);
  if (!ok) console.log(`  cause : ${resultat?.errorCode ?? ''} ${resultat?.message ?? ''}`);

  await disconnectDatabase();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (err) => {
  console.error(`✗ ${err?.message ?? err}`);
  await disconnectDatabase().catch(() => null);
  process.exitCode = 1;
});
