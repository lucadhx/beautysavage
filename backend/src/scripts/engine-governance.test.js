/**
 * GOUVERNANCE DES MOTEURS — versionnement, introspection, compatibilité,
 * migrations, et génération Nginx pilotée par le profil.
 *
 * Ces tests ne touchent ni réseau, ni base, ni serveur : ils vérifient le
 * CONTRAT des moteurs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeEngine, hasCapability, isProfileSupported, isEngineCompatible,
  validateManifest, compareVersions, parseVersion, REQUIRED_MANIFEST_FIELDS,
} from '../deployment-engine/engineInfo.js';
import {
  MIGRATIONS, migrationsBetween, planMigration, runMigrations, renderMigrationReport,
} from '../deployment-engine/migrations/index.js';
import { planSites, renderNginxConfig, renderNginxHttpOnly, servedHosts } from '../deployment-engine/nginx.js';
import { parseTargetUrl } from '../deployment-engine/url.js';
import { APPS } from '../deployment-engine/config/project.profile.js';
// Catalogue canonique du moteur — référence du miroir de l'interface.
import { CANONICAL_ORDER, CANONICAL_STEPS } from '../deployment-engine/steps.js';

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
};
const section = (t) => console.log(`\n${t}`);

const engineDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'deployment-engine',
);

section('Introspection : « qui suis-je ? »');
{
  const info = describeEngine();
  check('le moteur se nomme', info.engine === 'deployment-engine');
  check('le moteur connaît sa version', /^\d+\.\d+\.\d+$/.test(info.version));
  check('version d’API du moteur déclarée', typeof info.engineApiVersion === 'string');
  check('version de contrat déclarée', /^\d+\.\d+\.\d+$/.test(info.contractVersion));
  check('version minimale compatible déclarée', /^\d+\.\d+\.\d+$/.test(info.minimumCompatibleVersion));
  check('version de layout déclarée', typeof info.layoutVersion === 'string');
  check('date de publication déclarée', /^\d{4}-\d{2}-\d{2}$/.test(info.releaseDate));
  check('le moteur sait quel profil il exécute', typeof info.activeProfile === 'string' && info.activeProfile.length > 0);
}

section('Introspection : « quelles capacités ai-je ? »');
{
  const info = describeEngine();
  check('capacités déclarées', Array.isArray(info.capabilities) && info.capabilities.length > 0);
  for (const capability of ['preflight', 'releases', 'nginx', 'rollback', 'health-check', 'backup-restore']) {
    check(`capacité « ${capability} » déclarée`, hasCapability(capability));
  }
  check('capacité inconnue : non déclarée', !hasCapability('teleportation'));
  check('les nouveautés 2E sont déclarées',
    hasCapability('nginx-profile-driven') && hasCapability('rollback-auto-restore')
    && hasCapability('engine-introspection') && hasCapability('engine-migrations'));
}

section('Introspection : « avec quoi suis-je compatible ? »');
{
  const info = describeEngine();
  check('le profil actif est supporté', isProfileSupported());
  check('profil inconnu : non supporté', !isProfileSupported('profil-inexistant'));

  check('même version : compatible', isEngineCompatible(info.version).compatible);
  check('version minimale : compatible', isEngineCompatible(info.minimumCompatibleVersion).compatible);
  check('majeure différente : incompatible',
    isEngineCompatible('2.0.0').reason === 'MAJOR_MISMATCH');
  check('version plus récente que le moteur : refusée',
    isEngineCompatible('1.99.0').reason === 'TOO_RECENT');
  check('version invalide : refusée', isEngineCompatible('pas-une-version').reason === 'VERSION_INVALID');
}

section('Versions sémantiques');
{
  check('parse correct', JSON.stringify(parseVersion('1.2.3')) === JSON.stringify({ major: 1, minor: 2, patch: 3 }));
  check('parse refuse une valeur libre', parseVersion('1.2') === null);
  check('comparaison ordonnée', compareVersions('1.0.0', '1.1.0') === -1
    && compareVersions('1.1.0', '1.0.0') === 1
    && compareVersions('1.1.0', '1.1.0') === 0);
  check('comparaison invalide → null', compareVersions('x', '1.0.0') === null);
}

section('Manifeste : jamais un moteur sans version');
{
  const manifestPath = path.join(engineDir, 'engine.manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = validateManifest(manifest);
  check(`manifeste valide${result.errors.length ? ` — ${result.errors.join(', ')}` : ''}`, result.valid);
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    check(`champ obligatoire présent : ${field}`, manifest[field] !== undefined);
  }
  check('historique de versions tenu', Array.isArray(manifest.history) && manifest.history.length > 0);

  // Un manifeste amputé doit être refusé, champ par champ.
  for (const field of ['version', 'engineApiVersion', 'minimumCompatibleVersion']) {
    const broken = { ...manifest };
    delete broken[field];
    check(`manifeste sans ${field} : refusé`, !validateManifest(broken).valid);
  }
  check('version non semver : refusée', !validateManifest({ ...manifest, version: '1.0' }).valid);
  check('minimum > version : refusé',
    !validateManifest({ ...manifest, minimumCompatibleVersion: '9.0.0' }).valid);

  // Le moteur de duplication a lui aussi son manifeste.
  const dupPath = path.resolve(engineDir, '..', 'duplication-engine', 'engine.manifest.json');
  const dup = JSON.parse(fs.readFileSync(dupPath, 'utf8'));
  check('le moteur de duplication est versionné', validateManifest(dup).valid);
  check('les deux moteurs partagent la même majeure',
    parseVersion(dup.version).major === parseVersion(manifest.version).major);
}

section('Migrations : détection et sélection');
{
  check('catalogue non vide', MIGRATIONS.length > 0);
  check('chaque migration est complètement décrite', MIGRATIONS.every((m) =>
    m.id && m.from && m.to && m.title && m.description && typeof m.detect === 'function'));

  const between = migrationsBetween('1.0.0', '1.1.0');
  check('migrations 1.0.0 → 1.1.0 sélectionnées', between.length === MIGRATIONS.length);
  check('aucune migration si déjà à jour', migrationsBetween('1.1.0', '1.1.0').length === 0);
  check('aucune migration vers une version antérieure', migrationsBetween('1.1.0', '1.0.0').length === 0);
}

section('Migrations : un projet À JOUR n’a rien à faire');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'engine.manifest.json'), 'utf8'));
  const context = {
    profile: { APPS },
    manifest,
    engineFiles: fs.readdirSync(engineDir),
  };
  const plan = planMigration({ fromVersion: '1.0.0', toVersion: '1.1.0', context });
  check('toutes les migrations sont détectées comme appliquées',
    plan.pending.length === 0);
  check('rien ne bloque', plan.blocked === false);

  const report = runMigrations({ fromVersion: '1.0.0', toVersion: '1.1.0', context });
  check('exécution sans échec', report.ok === true);
  check('tout est marqué « déjà appliquée »', report.skipped.length === MIGRATIONS.length);
  check('aucune migration appliquée inutilement', report.applied.length === 0);
  check('rapport lisible produit', renderMigrationReport(report).includes('Moteur à jour'));
}

section('Migrations : un projet ANCIEN reçoit un plan précis');
{
  // Projet fictif embarquant un moteur 1.0.0 : profil sans nginxRole,
  // manifeste minimal, pas de rollback.js.
  const oldContext = {
    profile: { APPS: [{ id: 'vitrine', role: 'web' }, { id: 'backend', role: 'server' }] },
    manifest: { engine: 'deployment-engine', version: '1.0.0', contractVersion: '1.1.0' },
    engineFiles: ['DeploymentEngine.js', 'pipeline.js', 'nginx.js'],
  };
  const plan = planMigration({ fromVersion: '1.0.0', toVersion: '1.1.0', context: oldContext });
  check('les trois migrations sont en attente', plan.pending.length === 3);
  check('le plan est bloquant (migrations requises)', plan.blocked === true);
  check('chaque attente est motivée', plan.pending.every((m) => typeof m.reason === 'string' && m.reason.length > 0));

  const report = runMigrations({ fromVersion: '1.0.0', toVersion: '1.1.0', context: oldContext });
  check('la migration automatique du manifeste s’applique',
    report.applied.some((r) => r.id === 'extended-engine-manifest'));
  check('le manifeste migré porte les nouveaux champs',
    report.context.manifest.engineApiVersion !== undefined
    && report.context.manifest.minimumCompatibleVersion !== undefined
    && Array.isArray(report.context.manifest.breakingChanges));
  check('la version d’origine n’est PAS écrasée', report.context.manifest.version === '1.0.0');
  check('les migrations non automatiques sont signalées comme manuelles',
    report.manual.length === 2);
  check('…avec leurs étapes concrètes',
    report.manual.every((m) => m.manualSteps.length > 0));
  check('le rapport distingue automatique et manuel',
    renderMigrationReport(report).includes('[applied]')
    && renderMigrationReport(report).includes('[manual]'));
  check('aucune erreur', report.failed.length === 0);
}

section('Migrations : le profil du projet n’est JAMAIS réécrit aveuglément');
{
  const profile = { APPS: [{ id: 'vitrine', role: 'web', nginxRole: 'web', custom: 'valeur-du-client' }] };
  const before = JSON.stringify(profile);
  runMigrations({
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    context: { profile, manifest: { version: '1.0.0' }, engineFiles: [] },
  });
  check('le profil fourni reste intact', JSON.stringify(profile) === before);
  check('la migration du profil n’a pas d’application automatique',
    MIGRATIONS.find((m) => m.id === 'nginx-profile-driven').apply === undefined);
}

section('Nginx : entièrement piloté par le profil');
{
  const target = parseTargetUrl('https://demo.ly-solution.com');
  const roots = Object.fromEntries(APPS.map((a) => [a.id, `/var/www/site/${a.dir}`]));
  const sites = planSites(target, { roots, backendPort: 5001 });

  const webApps = APPS.filter((a) => a.nginxRole === 'web' || a.role === 'web');
  const subApps = APPS.filter((a) => a.nginxRole === 'web-subdomain' || a.role === 'web-sub');
  check('un site par application front + un hôte API',
    sites.length === webApps.length + subApps.length + 1);
  check('le backend ne produit PAS de bloc serveur',
    !sites.some((s) => APPS.find((a) => a.id === s.id)?.role === 'server'));
  check('l’application principale est servie sur l’hôte',
    sites.some((s) => s.host === target.host && s.kind === 'static'));
  check('les applications de sous-domaine sont dérivées',
    subApps.every((a) => sites.some((s) => s.host === `${a.subdomain}.${target.host}`)));
  check('l’hôte API est un proxy pur',
    sites.some((s) => s.host === `api.${target.host}` && s.kind === 'proxy' && s.root === null));
  check('chaque site statique a une racine', sites.filter((s) => s.kind === 'static').every((s) => s.root));
  check('chaque site a un certificat', sites.every((s) => s.cert?.fullchain && s.cert?.privkey));
  check('un hôte dérivé a un certificat DÉDIÉ',
    sites.filter((s) => s.host !== target.host).every((s) => s.cert.shared === false));
  check('hôtes servis, sans doublon',
    servedHosts(target, { roots, backendPort: 5001 }).length === sites.length);

  const conf = renderNginxConfig(target, { roots, backendPort: 5001 });
  check('un bloc server par site + la redirection HTTP',
    (conf.match(/^server \{/gm) || []).length === sites.length + 1);
  check('redirection HTTP → HTTPS présente', conf.includes('return 301 https://$host$request_uri'));
  check('politique de cache correcte', conf.includes('Cache-Control "no-cache"') && conf.includes('public, immutable'));
  check('bannière de génération', conf.startsWith('# Généré par DeploymentEngine'));

  // ── SURFACE DE PONT PROXIFIÉE ────────────────────────────────────────────
  // `/bridge/` n'avait aucun bloc : les appels des projets (bootstrap
  // d'appairage, heartbeats, synchronisation) retombaient dans le repli SPA
  // `try_files … /index.html`, servis par le module statique d'nginx — qui
  // accepte GET/HEAD et refuse le reste. Un `POST /bridge/v1/pairings`
  // recevait donc un 405 Not Allowed d'nginx, sans jamais atteindre Express.
  const spa = conf.split(/^server \{/m).find((b) => b.includes('try_files'));
  check('la surface de pont est proxifiée', /location \/bridge\/ \{/.test(spa));
  check('…vers le MÊME backend que /api/',
    (spa.match(/proxy_pass http:\/\/127\.0\.0\.1:5001;/g) || []).length >= 2);
  check('…avec les mêmes en-têtes que /api/ (Host, X-Real-IP, X-Forwarded-*)',
    (spa.match(/proxy_set_header X-Forwarded-Proto \$scheme;/g) || []).length >= 2);
  // nginx choisit le préfixe le plus LONG, pas le premier : l'ordre ne change
  // rien pour lui. Il change ce qu'on lit — et c'est la lecture qui avait
  // laissé croire que tout partait au backend.
  check('le bloc /bridge/ précède le repli SPA',
    spa.indexOf('location /bridge/') < spa.indexOf('location / {'));
  check('le repli SPA existe toujours', spa.includes('try_files $uri $uri/ /index.html'));

  const http = renderNginxHttpOnly(target, { roots, backendPort: 5001 });
  check('phase HTTP : aucun certificat référencé', !http.includes('ssl_certificate'));
  check('phase HTTP : challenge ACME servi pour chaque hôte',
    (http.match(/acme-challenge/g) || []).length === sites.length);
}

section('Nginx : le moteur ne connaît AUCUN nom d’application');
{
  const source = fs.readFileSync(path.join(engineDir, 'nginx.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Une seule tolérance : `opts.managerRoot`, paramètre d'entrée conservé pour
  // les appelants antérieurs à la Phase 2E. Il est lu, jamais interprété.
  const withoutLegacyParam = source.replace(/opts\.managerRoot/g, 'opts.legacySubRoot');
  for (const forbidden of ['manager', 'vitrine', 'frontend', 'panel']) {
    const occurrences = (withoutLegacyParam.match(new RegExp(forbidden, 'gi')) || []).length;
    check(`aucun « ${forbidden} » codé en dur dans le générateur${occurrences ? ` (${occurrences})` : ''}`,
      occurrences === 0);
  }
  check('le générateur lit le profil', source.includes("from './config/project.profile.js'"));
}

/* ══════════════════════════════════════════════════════════════════════════
   GOUVERNANCE DES ÉTAPES DE DÉPLOIEMENT — une seule définition, partout.

   ══ CE QUE CE CONTRÔLE VÉRIFIAIT, ET POURQUOI IL A CHANGÉ DE NATURE ════════

   Il vérifiait que le MIROIR manuel de l'interface (`friendly.ts`) restait
   fidèle au catalogue du moteur : aucune étape inconnue, aucune étape critique
   oubliée. C'était le bon contrôle pour la mauvaise architecture — il
   surveillait une recopie au lieu de la supprimer, et la recopie a fini par
   dériver malgré lui (le moteur avait renommé `dns.manager` en `dns.apps`,
   l'écran affichait une ligne qui ne recevait plus d'événement).

   Le miroir n'existe plus. Le contrôle ne compare donc plus deux listes : il
   vérifie qu'il n'en reste qu'UNE, et que tout le reste en dérive.
   ══════════════════════════════════════════════════════════════════════════ */
section('Déploiement : une seule définition d’étape, et tout en dérive');
{
  const registre = await import('../deployment-engine/steps.js');
  const {
    CANONICAL_STEPS: ETAPES, STEP_STATUS_VALUES, RUN_MODES, isKnownStep,
    stepsForMode, describeDeploymentSteps, RAW_TO_CANONICAL,
  } = registre;

  const racineProjet = path.resolve(engineDir, '..', '..', '..');
  const lire = (...segments) => fs.readFileSync(path.join(racineProjet, ...segments), 'utf8');
  const sansCommentaire = (source) => source
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  /* ── LE REGISTRE EST COHÉRENT AVEC LUI-MÊME ───────────────────────────── */
  const ids = ETAPES.map((s) => s.id);
  check('déploiement : aucun identifiant d’étape en double', new Set(ids).size === ids.length);
  const ordres = ETAPES.map((s) => s.order);
  check('déploiement : aucun ordre en double', new Set(ordres).size === ordres.length);
  check('déploiement : l’ordre est MONOTONE',
    ordres.every((o, i) => i === 0 || o > ordres[i - 1]));
  check('déploiement : chaque étape porte libellé, icône, groupe et modes',
    ETAPES.every((s) => s.label && s.icon && s.group && Array.isArray(s.modes) && s.modes.length > 0));
  check('déploiement : l’ordre canonique dérive de la liste',
    CANONICAL_ORDER.join('|') === ids.join('|'));

  /**
   * ══ LA FRONTIÈRE DE PUBLICATION EST UNIQUE, ET ELLE A ÉTÉ DÉPLACÉE ════════
   *
   * Elle était posée sur l'activation HTTPS, et cette assertion l'y retenait.
   * C'était vrai d'une PREMIÈRE mise en ligne — le certificat ouvre alors le
   * site au public — et faux de tous les redéploiements, qui sont l'immense
   * majorité : Nginx sert déjà la racine du site, et la bascule de release
   * change instantanément ce que voit un visiteur, bien avant qu'on ne touche
   * au certificat ou aux services.
   *
   * Une frontière ne peut pas être « la moyenne » de deux cas. On la place au
   * PLUS TÔT — au premier geste qui, dans un cas au moins, rend la nouvelle
   * version observable. Le reste du lot en dépend : c'est cette ligne qui
   * décide de ce qu'on refuse de faire sans journal durable.
   *
   * L'activation publique du tout premier déploiement n'est pas perdue pour
   * autant : elle porte son propre marqueur, `publicActivation`.
   */
  const frontieres = ETAPES.filter((s) => s.publicationBoundary);
  check('déploiement : une seule frontière de publication', frontieres.length === 1);
  check('déploiement : elle vient APRÈS la construction de la version',
    frontieres[0].order > ETAPES.find((s) => s.id === 'artifact.build').order);
  check('déploiement : et AVANT la configuration du routage web',
    frontieres[0].order < ETAPES.find((s) => s.id === 'nginx.configure').order);
  check('déploiement : l’activation publique reste marquée séparément',
    ETAPES.filter((s) => s.publicActivation).length === 1
    && ETAPES.find((s) => s.publicActivation).order > frontieres[0].order);

  /* ── LE MOTEUR N'ÉMET QUE CE QUE LE REGISTRE DÉCLARE ──────────────────── */
  const moteur = lire('backend', 'src', 'deployment-engine', 'DeploymentEngine.js');
  const emises = [...moteur.matchAll(/emitStep\(\s*'([a-z.]+)'/g)].map((m) => m[1]);
  const inconnues = [...new Set(emises)].filter((id) => !isKnownStep(id));
  check('déploiement : toute étape ÉMISE existe dans le registre', inconnues.length === 0);
  if (inconnues.length) console.error(`    → inconnues : ${inconnues.join(', ')}`);

  /**
   * LA TABLE DE TRADUCTION N'INTRODUIT AUCUNE ÉTAPE.
   *
   * Le pipeline distant nomme ses opérations par ce qu'elles FONT (`dirs`,
   * `certbot`, `reload`) et plusieurs composent une seule étape visible. C'est
   * une traduction, pas une seconde liste — encore faut-il que ses cibles
   * soient toutes déclarées.
   */
  const ciblesTraduites = [...new Set(Object.values(RAW_TO_CANONICAL))];
  check('déploiement : la table de traduction ne vise que des étapes déclarées',
    ciblesTraduites.every((id) => isKnownStep(id)));

  /**
   * TOUTE ÉTAPE OBLIGATOIRE EST ATTEIGNABLE.
   *
   * Une étape requise que le moteur n'émet jamais bloquerait chaque
   * déploiement sur « étape obligatoire non aboutie » — un verrou posé sur
   * soi-même. Les étapes du pipeline distant passent par la table de
   * traduction : on les compte comme émises.
   */
  const emisesOuTraduites = new Set([...emises, ...ciblesTraduites]);
  const jamaisEmises = ETAPES.filter((s) => s.required).map((s) => s.id)
    .filter((id) => !emisesOuTraduites.has(id));
  check('déploiement : toute étape REQUISE est réellement atteignable', jamaisEmises.length === 0);
  if (jamaisEmises.length) console.error(`    → jamais émises : ${jamaisEmises.join(', ')}`);

  check('déploiement : toutes les émissions passent par le traceur',
    /createDeploymentStepTracker\(/.test(sansCommentaire(moteur))
    && /tracker\.record\(stepId, status\)/.test(sansCommentaire(moteur)));

  /* ── LES MODES SONT DÉCLARÉS, PAS DEVINÉS PAR L'ÉCRAN ─────────────────── */
  const preflight = stepsForMode(RUN_MODES.PRECHECK).map((s) => s.id);
  const deploiement = stepsForMode(RUN_MODES.DEPLOYMENT).map((s) => s.id);
  check('déploiement : le préflight est un SOUS-ENSEMBLE strict du déploiement',
    preflight.length < deploiement.length && preflight.every((id) => deploiement.includes(id)));
  check('déploiement : le préflight s’arrête avant la préparation de la version',
    !preflight.includes('artifact.build') && !preflight.includes('artifact.upload'));
  check('déploiement : il conserve tout de même sa finalisation',
    preflight.includes('deployment.finalize'));

  /* ── L'INTERFACE NE TIENT AUCUNE LISTE PARALLÈLE ──────────────────────── */
  const friendly = lire('manager', 'src', 'pages', 'dev', 'deployment', 'friendly.ts');
  const friendlyNu = sansCommentaire(friendly);
  check('déploiement : « friendly.ts » ne déclare plus aucune étape',
    !/CHECKLIST_STEPS|PRECHECK_STEPS|PIPELINE_ORDER|PIPELINE_PHASES/.test(friendlyNu));
  check('déploiement : …ni aucun identifiant canonique',
    ![...friendlyNu.matchAll(/'([a-z]+\.[a-z]+)'/g)].map((m) => m[1]).some((id) => isKnownStep(id)));
  check('déploiement : …ni aucun ordre parallèle',
    !/_ORDER\s*[:=]/.test(friendlyNu));

  const derivation = lire('manager', 'src', 'pages', 'dev', 'deployment', 'deploymentChecklist.ts');
  check('déploiement : la dérivation ne contient aucune liste d’étapes',
    !/=\s*\[\s*\{\s*id:/.test(derivation));
  check('déploiement : …et n’embarque AUCUN repli figé',
    !/fallback|FALLBACK/.test(sansCommentaire(derivation)));

  /*
   * `DeployRunning.tsx` n'est plus la vue metier : il a ete reduit a un
   * LANCEUR, et la checklist vit desormais dans `DeploymentFollowUp.tsx`, qui
   * observe le run persiste cote backend. La regle verrouillee ici — l'ecran
   * derive ses etapes du CONTRAT, il n'en code aucune — est inchangee ; seul
   * le fichier qui la porte a change.
   */
  for (const ecran of ['DeploymentFollowUp.tsx', 'PreflightExperience.tsx']) {
    const source = lire('manager', 'src', 'pages', 'dev', 'deployment', ecran);
    check(`déploiement : « ${ecran} » dérive sa checklist du contrat`,
      /checklistFor\(contract,/.test(source) && /useDeploymentStepContract\(\)/.test(source));
    check(`déploiement : « ${ecran} » ne code aucune étape en dur`,
      ![...sansCommentaire(source).matchAll(/'([a-z]+\.[a-z]+)'/g)].map((m) => m[1])
        .some((id) => isKnownStep(id)));
  }

  /* ── LE VOCABULAIRE DES ÉTATS EST UNIQUE ──────────────────────────────── */
  const ui = lire('manager', 'src', 'pages', 'dev', 'deployment', 'ui.tsx');
  const union = ui.match(/StepState\s*=\s*([^;]+);/)?.[1] || '';
  const valeursUi = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  check('déploiement : l’union TypeScript des états reproduit EXACTEMENT le registre',
    valeursUi.join('|') === [...STEP_STATUS_VALUES].sort().join('|'));

  /* ── LA PROJECTION PUBLIQUE N'EXPOSE QUE LA DÉFINITION ────────────────── */
  const projection = describeDeploymentSteps();
  const champsAutorises = ['id', 'order', 'label', 'precheckLabel', 'icon', 'group', 'modes',
    'required', 'blocking', 'visible', 'conditional', 'publicationBoundary', 'publicActivation'];
  check('déploiement : la projection couvre toutes les étapes', projection.length === ETAPES.length);
  check('déploiement : …et n’expose aucun champ non déclaré',
    projection.every((s) => Object.keys(s).every((k) => champsAutorises.includes(k))));
  check('déploiement : …aucune commande, aucun chemin, aucun diagnostic',
    !/\/(var|etc|home)\/|sudo |certbot |pm2 /.test(JSON.stringify(projection)));

  check('déploiement : l’identifiant obsolète « dns.manager » n’existe nulle part',
    !isKnownStep('dns.manager') && !/'dns\.manager'/.test(friendly));
}

/* ══════════════════════════════════════════════════════════════════════════
   GOUVERNANCE DES PHASES DE DUPLICATION — une seule définition, partout.

   ══ CE QUE CETTE SECTION EMPÊCHE ═══════════════════════════════════════════

   Une phase de duplication était définie à trois endroits — le moteur qui
   l'émettait, `friendly.ts` qui en tenait l'ordre et les libellés, et
   l'assistant qui reconstruisait ses identifiants d'instance. Le contrôle
   précédent comparait ces identifiants à l'ordre canonique du moteur de
   DÉPLOIEMENT : une autre architecture, d'où un échec permanent que personne
   ne pouvait corriger sans mentir.

   Les contrôles ci-dessous ne comparent plus des listes entre elles : ils
   vérifient qu'il n'en existe plus qu'UNE, et que tout le reste en dérive.
   ══════════════════════════════════════════════════════════════════════════ */
section('Duplication : une seule définition de phase, et tout en dérive');
{
  const registre = await import('../duplication-engine/config/duplication.phases.js');
  const { DUPLICATION_PHASES, DUPLICATION_PHASE_ORDER, PHASE_STATUS_VALUES, isKnownPhase } = registre;

  const racineProjet = path.resolve(engineDir, '..', '..', '..');
  const lire = (...segments) => fs.readFileSync(path.join(racineProjet, ...segments), 'utf8');
  const sansCommentaire = (source) => source
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  /* ── LE REGISTRE EST COHÉRENT AVEC LUI-MÊME ───────────────────────────── */
  const ids = DUPLICATION_PHASES.map((p) => p.id);
  check('duplication : aucun identifiant de phase en double', new Set(ids).size === ids.length);
  const ordres = DUPLICATION_PHASES.map((p) => p.order);
  check('duplication : aucun ordre en double', new Set(ordres).size === ordres.length);
  check('duplication : chaque phase porte un libellé',
    DUPLICATION_PHASES.every((p) => typeof p.label === 'string' && p.label.length > 2));
  check('duplication : l’ordre canonique est TRIÉ',
    DUPLICATION_PHASE_ORDER.join('|') === [...DUPLICATION_PHASES]
      .sort((a, b) => a.order - b.order).map((p) => p.id).join('|'));
  check('duplication : « first_admin » est un citoyen ORDINAIRE du registre',
    isKnownPhase('first_admin') && DUPLICATION_PHASES.find((p) => p.id === 'first_admin').required);

  /* ── LE MOTEUR N'ÉMET QUE CE QUE LE REGISTRE DÉCLARE ──────────────────── */
  const moteur = lire('backend', 'src', 'duplication-engine', 'duplication.js');
  const moteurNu = sansCommentaire(moteur);
  const emises = [...moteur.matchAll(/tracker\.(?:phase|skip)\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  const inconnues = [...new Set(emises)].filter((id) => !isKnownPhase(id));
  check('duplication : toute phase ÉMISE existe dans le registre', inconnues.length === 0);
  if (inconnues.length) console.error(`    → inconnues : ${inconnues.join(', ')}`);

  /**
   * TOUTE PHASE OBLIGATOIRE EST ATTEIGNABLE.
   *
   * Une phase déclarée requise que le moteur n'émet jamais bloquerait chaque
   * duplication sur « phase obligatoire non aboutie » — un verrou posé sur
   * soi-même. Le contrôle refuse donc une déclaration sans émission aussi
   * fermement qu'une émission sans déclaration.
   */
  const requises = DUPLICATION_PHASES.filter((p) => p.required).map((p) => p.id);
  const jamaisEmises = requises.filter((id) => !emises.includes(id));
  check('duplication : toute phase REQUISE est réellement émise', jamaisEmises.length === 0);
  if (jamaisEmises.length) console.error(`    → jamais émises : ${jamaisEmises.join(', ')}`);

  /**
   * PLUS AUCUNE ÉMISSION DIRECTE. Le pipeline appelait `onPhase({ phase: '…' })`
   * avec une chaîne libre : rien ne vérifiait quoi que ce soit. Tout passe
   * désormais par le traceur, qui refuse au point d'émission.
   */
  check('duplication : aucune émission directe qui contournerait le traceur',
    !/onPhase\(\{\s*phase\s*:/.test(moteurNu));

  /* ── LE MANAGER NE TIENT AUCUNE LISTE PARALLÈLE ───────────────────────── */
  const friendly = lire('manager', 'src', 'pages', 'dev', 'deployment', 'friendly.ts');
  check('duplication : « friendly.ts » ne déclare plus de phases de duplication',
    !/DUPLICATION_PHASES/.test(sansCommentaire(friendly)));

  const assistant = lire('manager', 'src', 'pages', 'dev', 'deployment', 'DuplicateAssistant.tsx');
  const assistantNu = sansCommentaire(assistant);
  check('duplication : l’assistant ne reconstruit plus d’identifiant de phase',
    !/phaseEventToStepId|mapPhaseStatus/.test(assistantNu));
  /**
   * LES NOMS DE SOUS-PROJETS NE SONT PLUS ÉCRITS EN DUR.
   *
   * `backend`, `manager`, `vitrine` figuraient dans l'interface comme s'ils
   * étaient garantis. Le moteur les DÉCOUVRE : un projet sans vitrine affichait
   * une ligne éternellement en attente sur une duplication réussie.
   */
  check('duplication : aucun sous-projet Node codé en dur dans l’assistant',
    !/'(backend|manager|vitrine)'/.test(assistantNu));
  check('duplication : la checklist est DÉRIVÉE du contrat',
    assistant.includes('buildChecklist(contract, events)'));
  check('duplication : le contrat est DEMANDÉ au backend',
    assistant.includes('api.deployment.duplicationPhases()'));

  const derivation = lire('manager', 'src', 'pages', 'dev', 'deployment', 'duplicationChecklist.ts');
  check('duplication : la dérivation ne contient aucune liste de phases',
    !/=\s*\[\s*\{\s*id:/.test(derivation));

  /* ── LE VOCABULAIRE DES ÉTATS EST UNIQUE ──────────────────────────────── */
  const types = lire('manager', 'src', 'types', 'index.ts');
  const union = types.match(/DuplicationPhaseStatus\s*=\s*([^;]+);/)?.[1] || '';
  const valeursUi = [...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  check('duplication : l’union TypeScript des états reproduit EXACTEMENT le registre',
    valeursUi.join('|') === [...PHASE_STATUS_VALUES].sort().join('|'));
  check('duplication : le mot « failed » a disparu des deux côtés',
    !/'failed'/.test(moteurNu) && !/'failed'/.test(assistantNu));

  /* ── L'API EXPOSE LE REGISTRE, ET RIEN D'AUTRE ────────────────────────── */
  const projection = registre.describeDuplicationPhases();
  check('duplication : la projection publique couvre toutes les phases',
    projection.length === DUPLICATION_PHASES.length);
  check('duplication : …et n’expose aucun champ non déclaré',
    projection.every((p) => Object.keys(p).every(
      (k) => ['id', 'order', 'label', 'icon', 'group', 'dynamic', 'required', 'blocking'].includes(k))));
}

/* ══════════════════════════════════════════════════════════════════════════
   LE CONTRAT D'EXÉCUTION DISTANTE — aucune commande critique en roue libre.

   ══ CE QUE CETTE SECTION EMPÊCHE ═══════════════════════════════════════════

   Un utilitaire `execOrThrow` existait dans `Transport.js`. Il n'avait AUCUN
   appelant — écrit une fois, jamais adopté. C'est le sort d'une primitive
   facultative : pendant ce temps, les cinq commandes du chemin critique du
   pipeline étaient lancées et jamais vérifiées, dont la BASCULE qui publie la
   nouvelle version et le `npm ci` dont l'échec passait inaperçu.

   Les contrôles ci-dessous rendent la primitive OBLIGATOIRE là où elle compte,
   et vérifient que chaque appel déclare ce qu'il est.
   ══════════════════════════════════════════════════════════════════════════ */
section('Commandes distantes : classées, bornées, jamais en roue libre');
{
  const contrat = await import('../deployment-engine/remoteCommand.js');
  const { COMMAND_CLASS, TIMEOUTS } = contrat;

  const lireMoteur = (f) => fs.readFileSync(path.join(engineDir, f), 'utf8');
  const nu = (source) => source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  check('les cinq classes de commande sont déclarées',
    ['CRITICAL', 'BEST_EFFORT', 'PROBE', 'CLEANUP', 'ROLLBACK'].every((c) => COMMAND_CLASS[c] === c));
  check('la politique de délais est centrale et finie',
    Object.values(TIMEOUTS).every((v) => Number.isFinite(v) && v > 0));

  /* ── LE CHEMIN CRITIQUE NE PARLE PLUS AU TRANSPORT DIRECTEMENT ─────────── */
  for (const fichier of ['pipeline.js', 'nginx.js', 'certbot.js']) {
    const source = nu(lireMoteur(fichier));
    check(`${fichier} : aucun appel direct à transport.exec`, !/transport\.exec\(/.test(source));
    check(`${fichier} : passe par la primitive`, /runRemoteCommand\(/.test(source));
  }

  /* ── CHAQUE APPEL DÉCLARE CE QU'IL EST ────────────────────────────────── */
  for (const fichier of ['pipeline.js', 'nginx.js', 'certbot.js']) {
    const source = lireMoteur(fichier);
    const appels = [...source.matchAll(/runRemoteCommand\(transport, \{([\s\S]{0,500}?)\}\)/g)].map((m) => m[1]);
    check(`${fichier} : chaque commande porte un IDENTIFIANT stable`,
      appels.length > 0 && appels.every((a) => /commandId: '[a-z]+\.[a-z_]+'/.test(a)));
    check(`${fichier} : chaque commande porte une CLASSE`,
      appels.every((a) => /commandClass: COMMAND_CLASS\./.test(a)));
    check(`${fichier} : chaque commande CRITIQUE porte un DÉLAI`,
      appels.filter((a) => /COMMAND_CLASS\.CRITICAL/.test(a)).every((a) => /timeoutMs: TIMEOUTS\./.test(a)));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ZÉRO APPEL DIRECT — la garde est GLOBALE, sans liste blanche.

     ══ POURQUOI PAS UNE LISTE DE FICHIERS AUTORISÉS ══════════════════════════

     La version précédente de ce contrôle ne surveillait que trois fichiers du
     chemin critique. C'était un progrès et une invitation : tout ce qui n'était
     pas surveillé restait libre, et cinquante appels y sont restés — dont
     l'inventaire des médias, dont l'échec silencieux faisait migrer ZÉRO
     fichier en se déclarant réussi.

     Une liste blanche par fichier aurait le même défaut : elle grandit chaque
     fois qu'on n'a pas le temps. La règle est donc sans exception applicative —
     seule l'implémentation du contrat et celle du transport peuvent parler à
     `transport.exec`.
     ══════════════════════════════════════════════════════════════════════════ */
  {
    const AUTORISES = new Set(['remoteCommand.js']);
    const fautifs = [];
    const parcourir = (dir, prefixe = '') => {
      for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
        const complet = path.join(dir, entree.name);
        const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name;
        if (entree.isDirectory()) {
          // `transport/` EST l'implémentation du transport : c'est le seul
          // endroit où `exec` désigne autre chose qu'un appel applicatif.
          if (entree.name === 'transport') continue;
          parcourir(complet, relatif);
        } else if (/\.js$/.test(entree.name) && !AUTORISES.has(relatif)) {
          const source = nu(fs.readFileSync(complet, 'utf8'));
          if (/(transport|tx)\.exec\(/.test(source)) fautifs.push(relatif);
        }
      }
    };
    parcourir(engineDir);
    check('AUCUN appel applicatif direct à transport.exec dans tout le moteur',
      fautifs.length === 0);
    if (fautifs.length) console.error(`    → contournements : ${fautifs.join(', ')}`);
  }

  /**
   * LA PRIMITIVE MORTE A DISPARU.
   *
   * `execOrThrow` prétendait tenir ce rôle sans jamais être appelée. La laisser
   * offrirait une seconde façon de faire — la mauvaise, puisque personne ne
   * l'avait adoptée.
   */
  check('l’ancienne primitive facultative n’existe plus',
    !/export async function execOrThrow/.test(nu(lireMoteur('transport/Transport.js'))));

  /**
   * LE TRANSPORT NE FABRIQUE PLUS DE FAUX SUCCÈS.
   *
   * `code: exitCode ?? 0` transformait une connexion coupée en réussite. C'est
   * le défaut le plus grave de l'inventaire, et il n'était visible nulle part
   * ailleurs qu'ici.
   */
  const ssh = nu(lireMoteur('transport/SshTransport.js'));
  check('le transport SSH ne remplace plus un code absent par 0',
    !/code:\s*exitCode\s*\?\?/.test(ssh));
  check('…il rend explicitement null', /exitCode === undefined \|\| exitCode === null \? null/.test(ssh));
  check('…et transmet le signal', /signal:/.test(ssh));

  /* ── LES PIÈGES DE SHELL SONT CLASSÉS, PAS TOLÉRÉS EN SILENCE ──────────── */
  const appelsPipeline = [...lireMoteur('pipeline.js')
    .matchAll(/runRemoteCommand\(transport, \{([\s\S]{0,500}?)\}\)/g)].map((m) => m[1]);
  const critiques = appelsPipeline.filter((a) => /COMMAND_CLASS\.CRITICAL/.test(a));
  const composees = critiques.filter((a) => /;|\|\|/.test(String(a.split('commandClass')[0])));
  check('toute commande critique COMPOSÉE passe par un shell strict',
    composees.length > 0 && composees.every((a) => /strictShell\(/.test(a)));
  check('aucune commande critique ne masque son échec par « || true » ou « 2>/dev/null »',
    critiques.every((a) => !/\|\| true|2>\/dev\/null/.test(a)));

  /* ── LE CAVIARDAGE EXISTE ET S'APPLIQUE ───────────────────────────────── */
  check('le caviardage retire une URI Mongo',
    !contrat.redactOutput('erreur: mongodb+srv://u:p@c.net/x').includes('u:p@c.net'));
  check('…un secret d’environnement', !contrat.redactOutput('JWT_SECRET=abcdef123456').includes('abcdef123456'));
  check('…et une clé privée',
    !contrat.redactOutput('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----').includes('AAAA'));
  check('les sorties conservées sont bornées', contrat.tail('y'.repeat(10_000)).length < 2_100);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
