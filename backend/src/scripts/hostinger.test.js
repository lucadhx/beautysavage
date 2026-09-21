/* Tests du DNS de déploiement — zones (PSL), idempotence, moteur, et le CHEMIN.
 *
 * Aucun appel réseau réel, aucune vraie clé. Runner autonome.
 *
 * Depuis le lot L9.2, ce projet ne possède plus de client Hostinger : il demande
 * un verbe à la plateforme. Ce fichier éprouve donc ce qui lui reste — la
 * résolution de zone, l'idempotence de `ensureDns`, la phase DNS du moteur — et
 * surtout qu'AUCUN chemin local ne peut revenir.
 */
import { resolveZone, findBestManagedZone, relativeName } from '../deployment-engine/dns/zoneResolver.js';
import { ensureDnsRecord } from '../deployment-engine/dns/ensureDns.js';
import { MockDnsProvider } from '../deployment-engine/dns/MockDnsProvider.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { createRedactor } from '../deployment-engine/report/sanitize.js';
import { ValidationError } from '../deployment-engine/errors.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
async function threws(fn, code) { try { await fn(); return false; } catch (e) { return code ? e.code === code : true; } }

const IP = '195.35.0.211';
const FAKE_KEY = 'hstg_FAKE_SECRET_TOKEN_9x8y7z';

/*
 * `mockFetch` a disparu avec le client qu'il simulait. Un simulateur de
 * fournisseur n'a plus de sens ici : le seul interlocuteur de ce projet est la
 * plateforme, et c'est elle qu'on simule — par `invoke`, quelques lignes plus
 * bas.
 */

try {
  /* ---------------------- 1. Résolution de zone (PSL) ---------------------- */
  check('zone : demo-sbauto.lycarz.com -> lycarz.com / demo-sbauto', (() => { const z = resolveZone('demo-sbauto.lycarz.com'); return z.zone === 'lycarz.com' && z.relativeName === 'demo-sbauto'; })());
  check('zone : manager.demo-sbauto.lycarz.com -> lycarz.com / manager.demo-sbauto', (() => { const z = resolveZone('manager.demo-sbauto.lycarz.com'); return z.zone === 'lycarz.com' && z.relativeName === 'manager.demo-sbauto'; })());
  check('zone : exemple.co.uk -> exemple.co.uk / @ (PSL multi-niveau)', (() => { const z = resolveZone('exemple.co.uk'); return z.zone === 'exemple.co.uk' && z.relativeName === '@'; })());
  check('zone : www.client.fr -> client.fr / www', (() => { const z = resolveZone('www.client.fr'); return z.zone === 'client.fr' && z.relativeName === 'www'; })());
  check('zone : IP directe refusée', await threws(() => resolveZone('195.35.0.211')));
  check('zone : localhost refusé', await threws(() => resolveZone('localhost')));
  check('zone : hostname invalide refusé', await threws(() => resolveZone('')));
  check('zone : la plus spécifique parmi zones gérées', (() => { const b = findBestManagedZone('a.b.lycarz.com', ['lycarz.com', 'b.lycarz.com']); return b.zone === 'b.lycarz.com' && b.relativeName === 'a'; })());
  check('zone : nom relatif @ pour apex', relativeName('lycarz.com', 'lycarz.com') === '@');

  /* ------- 2 & 3. LE CLIENT ET LE PROVIDER LOCAUX ONT ÉTÉ SUPPRIMÉS (L9.2) -------
   *
   * Ces deux sections éprouvaient `HostingerClient` (mapping 401/403/404/429/5xx,
   * retry sur GET, aucun retry sur PUT) et `HostingerDnsProvider` (verifyCredentials,
   * listRecords, findBestZone). Les deux modules n'existent plus dans ce projet :
   * il ne parle plus à Hostinger, il demande un verbe à la plateforme.
   *
   * Ces invariants n'ont pas disparu, ils ont CHANGÉ DE DÉPÔT. Ils sont éprouvés
   * là où le code vit désormais — Panel, `tests/hostinger-control-plane.test.js`,
   * sections « TIMEOUT_SAFE » et « WRITE_AUDITED » — sur le transport réel du
   * Panel. Les garder ici aurait exigé de garder le client : un test ne doit pas
   * être la raison de survie du code qu'il teste.
   */

  /* ---------------------- 4. ensureDnsRecord (idempotent, conflits, wildcard) ---------------------- */
  const mkProvider = (records) => new MockDnsProvider({ zones: ['lycarz.com'], records: { 'lycarz.com': records } });
  // create
  let p = mkProvider([]);
  let r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP, ttl: 300 });
  check('ensureDns : création si absent', r.action === 'create' && p.mutations.length === 1);
  // already_correct
  p = mkProvider([{ name: 'demo-sbauto', type: 'A', contents: [IP] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP });
  check('ensureDns : idempotent (already_correct, aucune mutation)', r.action === 'none' && r.reason === 'already_correct' && p.mutations.length === 0);
  // wrong IP -> conflict (no overwrite)
  p = mkProvider([{ name: 'demo-sbauto', type: 'A', contents: ['9.9.9.9'] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP });
  check('ensureDns : IP différente -> conflit bloquant (jamais écrasé)', r.action === 'conflict' && r.reason === 'WRONG_IP' && p.mutations.length === 0);
  check('ensureDns : conflit expose ancienne/nouvelle valeur', r.previous[0] === '9.9.9.9' && r.expectedIp === IP);
  // CNAME conflict
  p = mkProvider([{ name: 'demo-sbauto', type: 'CNAME', contents: ['autre.tld.'] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP });
  check('ensureDns : CNAME -> conflit', r.action === 'conflict' && r.reason === 'CNAME_CONFLICT');
  // multiple A conflict
  p = mkProvider([{ name: 'demo-sbauto', type: 'A', contents: [IP, '9.9.9.9'] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP });
  check('ensureDns : A multiples -> conflit', r.action === 'conflict' && r.reason === 'MULTIPLE_A');
  // wildcard covers
  p = mkProvider([{ name: '*', type: 'A', contents: [IP] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP });
  check('ensureDns : wildcard couvre -> pas de création', r.action === 'wildcard_covers' && p.mutations.length === 0);
  // overwrite allowed
  p = mkProvider([{ name: 'demo-sbauto', type: 'A', contents: ['9.9.9.9'] }]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP, allowOverwrite: true });
  check('ensureDns : correction si autorisée', r.action === 'update' && p.mutations.length === 1);
  // dryRun (plan, no mutation)
  p = mkProvider([]);
  r = await ensureDnsRecord({ provider: p, zone: 'lycarz.com', relativeName: 'demo-sbauto', expectedIp: IP, dryRun: true });
  check('ensureDns : dryRun planifie sans muter', r.action === 'create' && r.planned === true && p.mutations.length === 0);

  /* ---------------------- 5. Redaction : la clé n'apparaît jamais ---------------------- */
  const red = createRedactor([FAKE_KEY]);
  check('redaction : Authorization Bearer masqué', red.redactString(`Authorization: Bearer ${FAKE_KEY}`).includes('[REDACTED') && !red.redactString(`Authorization: Bearer ${FAKE_KEY}`).includes(FAKE_KEY));
  check('redaction : clé exacte masquée partout', !red.redactString(`token=${FAKE_KEY} dans une commande`).includes(FAKE_KEY));

  /* ---------------------- 6. Phase DNS dans le moteur (checklist + rapport) ---------------------- */
  const FAST = { minIntervalMs: 1, maxIntervalMs: 1, timeoutMs: 1000 };
  const healthyVps = () =>
    new FakeTransport()
      .on('id -un', { stdout: 'deploy' })
      .on('command -v nginx', { stdout: 'OK' }).on('command -v node', { stdout: 'OK' }).on('command -v pm2', { stdout: 'OK' })
      .on('command -v certbot', { stdout: 'OK' }).on('command -v mongod', { stdout: 'OK' })
      .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
      .on('test -w /var/www', { stdout: 'WRITABLE' }).on(/df -Pk/, { stdout: '2000000' })
      .on(/cat \/etc\/nginx\/sites-available/, { stdout: '__NONE__' }).on('fullchain.pem', { stdout: 'OK' });
  const engine = () => new DeploymentEngine({ wildcardBases: ['ly-solution.com'] });
  const runPk = (tx, url, dnsProvider, extra = {}) =>
    engine().deployWithReport({
      url, transport: tx, options: { preflightOnly: true, backendPort: 5001, sshHost: '195.35.0.211', sshUser: 'root', version: 'x', dnsExpectedIp: IP, dnsResolutionOpts: FAST, dnsProvider, dnsSecret: FAKE_KEY, ...extra },
    });

  // Cas PRINCIPAL : demo-sbauto.lycarz.com -> zone lycarz.com, création vitrine + Manager.
  const mainProv = new MockDnsProvider({ zones: ['lycarz.com'], records: { 'lycarz.com': [] }, resolution: { 'demo-sbauto.lycarz.com': IP, 'manager.demo-sbauto.lycarz.com': IP } });
  const main = await runPk(healthyVps(), 'https://demo-sbauto.lycarz.com', mainProv);
  const sids = main.steps.map((s) => s.id);
  check('moteur : zone lycarz.com détectée', main.structuredReport.hostinger.zone === 'lycarz.com');
  check('moteur : checklist DNS live (zone/provider/read/site/apps/verify)', ['dns.zone', 'dns.provider', 'dns.read', 'dns.site', 'dns.apps', 'dns.verify'].every((s) => sids.includes(s)));
  check('moteur : vitrine ET Manager créés', mainProv.mutations.some((m) => m.name === 'demo-sbauto') && mainProv.mutations.some((m) => m.name === 'manager.demo-sbauto'));
  check('moteur : deux actions dans le rapport Hostinger', (main.structuredReport.hostinger.actions || []).length === 2);
  check('moteur : résolution publique des deux hôtes', main.structuredReport.hostinger.resolution.site.pointsToVps && main.structuredReport.hostinger.resolution.manager.pointsToVps);
  check('moteur : préflight réussi', main.ok === true);
  check('moteur : AUCUNE clé API dans le rapport', !JSON.stringify(main.structuredReport).includes(FAKE_KEY) && !main.markdownReport.includes(FAKE_KEY));
  check('moteur : section Hostinger dans le markdown', main.markdownReport.includes('## Hostinger / DNS provider') && main.markdownReport.includes('lycarz.com'));

  // Ordre sûr : SSH KO -> AUCUN DNS créé (pas de mutation avant SSH OK).
  const sshKo = new FakeTransport({ defaultResponse: { code: 1, stdout: '', stderr: 'Permission denied' } });
  const provNoMut = new MockDnsProvider({ zones: ['lycarz.com'], records: { 'lycarz.com': [] }, resolution: { 'demo-sbauto.lycarz.com': IP } });
  const sshFail = await runPk(sshKo, 'https://demo-sbauto.lycarz.com', provNoMut);
  check('moteur : SSH KO -> échec ssh.connect', sshFail.ok === false && sshFail.finalStepId === 'ssh.connect');
  check('moteur : SSH KO -> AUCUNE mutation DNS (ordre sûr)', provNoMut.mutations.length === 0);

  // Conflit détecté AVANT toute mutation et avant SSH.
  const conflictProv = new MockDnsProvider({ zones: ['lycarz.com'], records: { 'lycarz.com': [{ name: 'demo-sbauto', type: 'A', contents: ['9.9.9.9'] }] } });
  const conflict = await runPk(healthyVps(), 'https://demo-sbauto.lycarz.com', conflictProv);
  check('moteur : conflit -> échec à dns.read', conflict.ok === false && conflict.finalStepId === 'dns.read');
  check('moteur : conflit -> aucune mutation', conflictProv.mutations.length === 0);
  check('moteur : conflit -> needsConfirmation dans errorSummary', conflict.errorSummary?.needsConfirmation === true || conflict.errorSummary?.conflict != null);

  // Credentials invalides -> échec dns.provider, aucune mutation.
  const badProv = new MockDnsProvider({ zones: ['lycarz.com'], credentialsOk: false });
  const badCreds = await runPk(healthyVps(), 'https://demo-sbauto.lycarz.com', badProv);
  check('moteur : credentials KO -> échec dns.provider', badCreds.ok === false && badCreds.finalStepId === 'dns.provider');

  // Non configuré -> étapes DNS sautées + avertissement, pas de blocage (repli).
  const notConfigured = await runPk(healthyVps(), 'https://sbauto06.ly-solution.com', null, { dnsProvider: null, dnsNotConfiguredReason: 'NOT_CONFIGURED' });
  const ncSteps = new Map(notConfigured.steps.map((s) => [s.id, s.status]));
  check('moteur : non configuré -> dns.provider en avertissement', ncSteps.get('dns.provider') === 'warning');
  check('moteur : non configuré -> dns.zone/site/manager sautés', ncSteps.get('dns.zone') === 'skipped' && ncSteps.get('dns.site') === 'skipped');
  check('moteur : non configuré -> préflight non bloqué (sous-domaine wildcard)', notConfigured.ok === true);

  /* ═══════════════════════════════════════════════════════════════════════
     L9.2 — IL N'Y A PLUS DE CHEMIN LOCAL. C'EST L'INVARIANT DU LOT.
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('\n  L9.2 — cutover final : aucun chemin Hostinger local');
  {
    const { resolveDnsProvider, DNS_PATH } = await import('../integrations/hostinger/dnsProviderResolution.js');

    check('le vocabulaire des chemins ne contient plus LOCAL',
      Object.values(DNS_PATH).join(',') === 'PANEL_CAPABILITY,NONE');

    /** Une plateforme qui refuse avec le code donné, sans jamais rien appeler. */
    const panelQuiRefuse = (code) => async () => {
      const err = new Error(`refus simulé ${code}`);
      err.code = code;
      throw err;
    };

    /**
     * TOUS LES REFUS FERMENT LE CHEMIN — y compris les deux qui l'ouvraient
     * encore en L9.1 (`CAPABILITY_UNKNOWN`, `CAPABILITY_NOT_AVAILABLE`).
     *
     * Leur fenêtre existait pour le déploiement progressif, et son critère de
     * retrait était « un déploiement réel passé par PANEL_CAPABILITY ». Le
     * déploiement du 2026-08-11 sur demo-sbauto06.ly-solution.com l'a rempli.
     */
    const TOUS = [
      'CAPABILITY_UNKNOWN', 'CAPABILITY_NOT_AVAILABLE',
      'CAPABILITY_RESOURCE_NOT_OWNED', 'CAPABILITY_NOT_GRANTED',
      'CAPABILITY_PROJECT_SCOPE_MISMATCH', 'CAPABILITY_INPUT_INVALID',
      'CAPABILITY_CREDENTIALS_MISSING', 'CAPABILITY_TIMEOUT',
      'CAPABILITY_PROVIDER_UNAVAILABLE', 'PANEL_UNREACHABLE', 'BRIDGE_NOT_PAIRED',
    ];
    for (const code of TOUS) {
      const r = await resolveDnsProvider({ siteHost: 'demo.lycarz.com', invoke: panelQuiRefuse(code) });
      check(`AUCUN repli — ${code}`,
        r.path === DNS_PATH.NONE && r.available === false && r.provider === null);
      check(`…et le motif le nomme — ${code}`, r.reason === `PANEL_UNAVAILABLE:${code}`);
    }

    // Plateforme absente : un projet non appairé n'a plus AUCUN chemin DNS. Le
    // dire est la seule réponse honnête — lui faire écrire avec une clé locale
    // serait exactement le contournement que ce lot supprime.
    const sansPanel = await resolveDnsProvider({ siteHost: 'demo.lycarz.com', invoke: null });
    check('sans plateforme appairée : aucun DNS automatique',
      sansPanel.path === DNS_PATH.NONE && sansPanel.reason === 'PANEL_UNAVAILABLE:PANEL_NOT_PAIRED');
    check('…et aucun secret local n’est rendu', !('apiToken' in sansPanel));

    /** LE CHEMIN NOMINAL — une plateforme qui répond fait retenir sa voie. */
    const panelQuiRepond = async (code) => {
      if (code === 'dns.zone.resolve') {
        return { result: { hostname: 'demo.lycarz.com', zone: 'lycarz.com', relativeName: 'demo', source: 'managed' } };
      }
      return { result: { zone: 'lycarz.com', records: [{ name: '*', type: 'A', ttl: 300, contents: [IP], disabled: false }] } };
    };
    const nominal = await resolveDnsProvider({ siteHost: 'demo.lycarz.com', invoke: panelQuiRepond });
    check('chemin nominal : la voie de la plateforme est retenue',
      nominal.path === DNS_PATH.PANEL && nominal.available === true);
    check('…et le rapport NOMME le chemin', nominal.provider?.name === 'hostinger (via Panel)');

    /* ── LE DIAGNOSTIC PASSE PAR LE MÊME PLAN DE CONTRÔLE ─────────────────── */
    const { diagnoseDnsAutomation, DNS_DIAGNOSTIC } = await import(
      '../integrations/hostinger/dnsControlPlaneDiagnostic.js'
    );

    const okDiag = await diagnoseDnsAutomation({ hostname: 'demo.lycarz.com', invoke: panelQuiRepond });
    check('diagnostic : disponible quand la plateforme répond',
      okDiag.code === DNS_DIAGNOSTIC.OK && okDiag.available === true);
    check('…il nomme la zone et sa provenance',
      okDiag.zone === 'lycarz.com' && okDiag.zoneSource === 'managed');
    check('…et signale la wildcard qui couvre déjà l’hôte', okDiag.wildcard === true);
    check('…l’autorité annoncée est la PLATEFORME', okDiag.authority === 'PANEL');

    // Chaque cause a son état : « pas de clé chez eux » et « pas le droit » ne se
    // réparent pas au même endroit, et un message unique enverrait au mauvais.
    const ETATS = [
      ['BRIDGE_NOT_PAIRED', DNS_DIAGNOSTIC.PANEL_NOT_PAIRED],
      ['PANEL_UNREACHABLE', DNS_DIAGNOSTIC.PANEL_UNREACHABLE],
      ['CAPABILITY_UNKNOWN', DNS_DIAGNOSTIC.CAPABILITY_MISSING],
      // Le refus d'appartenance porte désormais son vrai nom ; l'ancien code
      // reste traduit pour les Panels plus anciens du parc.
      ['CAPABILITY_RESOURCE_NOT_OWNED', DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED],
      ['CAPABILITY_NOT_GRANTED', DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED],
      ['CAPABILITY_CREDENTIALS_MISSING', DNS_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING],
      ['CAPABILITY_TIMEOUT', DNS_DIAGNOSTIC.PROVIDER_TIMEOUT],
      ['CAPABILITY_PROVIDER_UNAVAILABLE', DNS_DIAGNOSTIC.PROVIDER_UNAVAILABLE],
    ];
    for (const [code, attendu] of ETATS) {
      const d2 = await diagnoseDnsAutomation({ hostname: 'demo.lycarz.com', invoke: panelQuiRefuse(code) });
      check(`diagnostic : ${code} → ${attendu}`, d2.code === attendu && d2.available === false);
      check(`…et rien de ce qu’il rend ne ressemble à un secret — ${code}`,
        !/Bearer|apiToken|hstg_/i.test(JSON.stringify(d2)));
    }

    const nonAppaire = await diagnoseDnsAutomation({ hostname: 'demo.lycarz.com', invoke: null });
    check('diagnostic : sans plateforme, il le DIT au lieu de tester une clé locale',
      nonAppaire.code === DNS_DIAGNOSTIC.PANEL_NOT_PAIRED);

    // Une zone déduite (psl) n'est pas une zone gérée : l'écriture échouerait.
    const psl = await diagnoseDnsAutomation({
      hostname: 'demo.client-tiers.fr',
      invoke: async () => ({ result: { zone: 'client-tiers.fr', relativeName: 'demo', source: 'psl' } }),
    });
    check('diagnostic : une zone non gérée est annoncée AVANT le déploiement',
      psl.code === DNS_DIAGNOSTIC.ZONE_NOT_MANAGED && psl.available === false);

    /* ── L'INVARIANT ARCHITECTURAL ─────────────────────────────────────────
       Plus aucun chemin local, et rien pour en refaire un. C'est ce contrôle
       qui empêche la régression silencieuse : il échoue le jour où quelqu'un
       réintroduit un client Hostinger « le temps de dépanner ». */
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const fichiers = [];
    (function parcourir(dossier) {
      for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
        const complet = path.join(dossier, entree.name);
        if (entree.isDirectory()) { parcourir(complet); continue; }
        if (!entree.name.endsWith('.js') || entree.name.includes('.test.')) continue;
        if (complet.includes(`${path.sep}scripts${path.sep}`)) continue;
        fichiers.push(complet);
      }
    }(racine));

    const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const lus = fichiers.map((f) => [
      path.relative(racine, f).replace(/\\/g, '/'),
      sansCommentaires(fs.readFileSync(f, 'utf8')),
    ]);

    // 1. Aucun module ne reconstruit un client Hostinger.
    const clients = lus.filter(([, src]) => /HostingerClient|HostingerDnsProvider|resolveHostingerProvider/.test(src));
    check(`HOSTINGER_LOCAL_RUNTIME_CALLS = 0 — aucun client local (${clients.map(([f]) => f).join(', ') || 'aucun'})`,
      clients.length === 0);

    // 2. Aucun module ne parle à l'API Hostinger, quel que soit le nom qu'on
    //    donnerait à son client : c'est l'ADRESSE du fournisseur qui est interdite.
    const hotes = lus.filter(([, src]) => /hostinger\.com|api\/dns\/v1|api\/domains\/v1/.test(src));
    check(`aucune adresse de l’API Hostinger dans le runtime (${hotes.map(([f]) => f).join(', ') || 'aucune'})`,
      hotes.length === 0);

    // 3. Aucun module ne lit un credential Hostinger local.
    const credentials = lus.filter(([f, src]) =>
      /HOSTINGER/.test(src) && /apiToken/.test(src) && !f.startsWith('utils/integratedApiCatalog'));
    check(`aucun credential Hostinger lu par le runtime (${credentials.map(([f]) => f).join(', ') || 'aucun'})`,
      credentials.length === 0);

    // 4. Le catalogue n'expose plus de champ à saisir, et le dit.
    const { INTEGRATED_API_CATALOG, isPanelAuthority } = await import('../utils/integratedApiCatalog.js');
    check('le catalogue déclare Hostinger administré par la plateforme',
      isPanelAuthority('HOSTINGER') === true);
    check('…et n’expose plus AUCUN champ de saisie',
      INTEGRATED_API_CATALOG.HOSTINGER.fields.length === 0);

    // 5. Le contrôleur de déploiement ne connaît plus le fournisseur.
    const controleur = sansCommentaires(fs.readFileSync(path.join(racine, 'controllers/deployment.controller.js'), 'utf8'));
    check('le contrôleur de déploiement n’instancie AUCUN provider local',
      !/HostingerDnsProvider|HostingerClient|resolveHostingerProvider/.test(controleur));
    check('…et ne journalise plus de chemin local', !/DNS_PATH_LOCAL/.test(controleur));
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('HOSTINGER TEST CRASHED:', err);
  fail++;
} finally {
  process.exit(fail === 0 ? 0 : 1);
}

// util (import used indirectly)
void FakeTransport;
void DeploymentEngine;
void ValidationError;
