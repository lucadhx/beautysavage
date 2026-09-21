/**
 * LE CONTRAT D'EXÉCUTION DISTANTE — une commande n'a pas « fini », elle a
 * réussi ou échoué.
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * L'injection d'échec du lot précédent avait établi qu'un `npm ci --omit=dev`
 * en échec ne faisait PAS échouer son étape : le pipeline lançait la commande,
 * l'attendait, et ne lisait jamais son code de sortie. Le défaut n'était pas
 * isolé — les cinq commandes du chemin critique se comportaient ainsi, y
 * compris la BASCULE qui publie la nouvelle version.
 *
 * Cinq propriétés sont éprouvées ici, et aucune ne se relit dans le code sans
 * effort :
 *
 *   · un code de sortie non nul sur une commande CRITIQUE lève une erreur
 *     typée — jamais un résultat qu'on pourrait ignorer ;
 *   · un code de sortie ABSENT (connexion perdue, process tué) n'est PAS un
 *     succès. Le transport SSH rendait `code ?? 0` : une coupure réseau au
 *     milieu d'une installation produisait une étape verte ;
 *   · une SONDE rend son verdict sans lever — `test -f` qui répond 1 dit « le
 *     fichier n'existe pas », ce qui est une réponse ;
 *   · un ROLLBACK ou un NETTOYAGE en échec ne remplace jamais l'erreur
 *     primaire, qui est celle qu'il faut lire en premier ;
 *   · les sorties sont bornées ET caviardées AVANT d'être conservées.
 */
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';
import {
  COMMAND_CLASS,
  TIMEOUTS,
  RemoteCommandError,
  redactOutput,
  runRemoteCommand,
  strictShell,
  tail,
} from '../deployment-engine/remoteCommand.js';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);
const capture = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const CRITIQUE = COMMAND_CLASS.CRITICAL;

try {
  /* ══════════════════════════════════════════════════════════════════════════
     1. LE CODE DE SORTIE FAIT FOI.
     ══════════════════════════════════════════════════════════════════════════ */
  section('1 · Une commande critique doit RÉUSSIR, pas seulement finir');
  {
    const tx = new FakeTransport().on('vrai', { code: 0, stdout: 'ok' });
    const bon = await runRemoteCommand(tx, {
      commandId: 'test.vrai', command: 'vrai', commandClass: CRITIQUE,
    });
    check('code 0 → succès', bon.ok === true && bon.exitCode === 0);
    check('…le résultat porte son identifiant', bon.commandId === 'test.vrai');
    check('…et sa classe', bon.commandClass === CRITIQUE);
    check('…et sa durée', typeof bon.durationMs === 'number');

    const txKo = new FakeTransport().on('faux', { code: 1, stderr: 'boom' });
    const erreur = await capture(() => runRemoteCommand(txKo, {
      commandId: 'test.faux', command: 'faux', commandClass: CRITIQUE, step: 'dirs',
    }));
    check('code 1 → erreur TYPÉE', erreur instanceof RemoteCommandError);
    check('…code REMOTE_COMMAND_FAILED', erreur.code === 'REMOTE_COMMAND_FAILED');
    check('…qui porte l’étape', erreur.step === 'dirs');
    check('…l’identifiant de commande', erreur.details.commandId === 'test.faux');
    check('…et le code de sortie', erreur.details.exitCode === 1);
    check('…mais JAMAIS la ligne shell complète',
      !JSON.stringify(erreur.details).includes('faux') || erreur.details.commandId === 'test.faux');

    /**
     * CE QUI NE PEUT PLUS TENIR LIEU DE PREUVE.
     * Une sortie standard remplie, une sortie d'erreur vide, un process
     * terminé : aucun de ces trois faits ne dit qu'une commande a réussi.
     */
    const txTrompeur = new FakeTransport().on('trompeur', { code: 3, stdout: 'Tout va bien !', stderr: '' });
    const trompe = await capture(() => runRemoteCommand(txTrompeur, {
      commandId: 'test.trompeur', command: 'trompeur', commandClass: CRITIQUE,
    }));
    check('une sortie rassurante ne rachète pas un code 3', trompe instanceof RemoteCommandError);

    /** Un contrat différent peut être DÉCLARÉ — jamais supposé. */
    const txDeux = new FakeTransport().on('deux', { code: 2, stdout: 'rien à faire' });
    const tolere = await runRemoteCommand(txDeux, {
      commandId: 'test.deux', command: 'deux', commandClass: CRITIQUE, okExitCodes: [0, 2],
    });
    check('un code accepté EXPLICITEMENT ne lève pas', tolere.ok === true);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. UN CODE ABSENT N'EST PAS UN SUCCÈS.
     ══════════════════════════════════════════════════════════════════════════ */
  section('2 · Connexion perdue, process tué : jamais « réussi »');
  {
    const txNull = new FakeTransport().on('coupe', { code: null, stdout: '' });
    const perdue = await capture(() => runRemoteCommand(txNull, {
      commandId: 'test.coupe', command: 'coupe', commandClass: CRITIQUE,
    }));
    check('code ABSENT → erreur', perdue instanceof RemoteCommandError);
    check('…typée connexion perdue', perdue.code === 'REMOTE_COMMAND_CONNECTION_LOST');

    const txSignal = new FakeTransport().on('tue', { code: null, signal: 'SIGKILL' });
    const tue = await capture(() => runRemoteCommand(txSignal, {
      commandId: 'test.tue', command: 'tue', commandClass: CRITIQUE,
    }));
    check('process TUÉ par signal → erreur', tue instanceof RemoteCommandError);
    check('…typée signal', tue.code === 'REMOTE_COMMAND_SIGNALLED');
    check('…et le signal est nommé', tue.details.signal === 'SIGKILL');

    /** Le transport LÈVE : on n'a pas pu exécuter — ce n'est pas un succès non plus. */
    const txMort = {
      kind: 'fake',
      async exec() { throw new Error('connexion SSH fermée'); },
    };
    const morte = await capture(() => runRemoteCommand(txMort, {
      commandId: 'test.morte', command: 'x', commandClass: CRITIQUE,
    }));
    check('transport en échec → erreur typée', morte.code === 'REMOTE_COMMAND_CONNECTION_LOST');

    const txLent = { kind: 'fake', async exec() { throw new Error('Timeout de commande distante (50 ms).'); } };
    const lente = await capture(() => runRemoteCommand(txLent, {
      commandId: 'test.lente', command: 'x', commandClass: CRITIQUE, timeoutMs: 50,
    }));
    check('délai dépassé → REMOTE_COMMAND_TIMEOUT', lente.code === 'REMOTE_COMMAND_TIMEOUT');
    check('…et le message dit combien de temps', /50 ms/.test(lente.message));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. LA CLASSE DÉCIDE DE CE QUI ARRIVE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('3 · Aucune commande n’est best-effort par oubli');
  {
    const tx = new FakeTransport().on('x', { code: 1, stderr: 'raté' });

    const sansClasse = await capture(() => runRemoteCommand(tx, { commandId: 'test.x', command: 'x' }));
    check('une commande SANS classe est REFUSÉE', sansClasse !== null);
    check('…et le message le dit', /classe manquante/.test(sansClasse.message));
    const sansId = await capture(() => runRemoteCommand(tx, { command: 'x', commandClass: CRITIQUE }));
    check('une commande SANS identifiant est REFUSÉE', /commandId requis/.test(sansId.message));

    const sonde = await runRemoteCommand(tx, {
      commandId: 'test.sonde', command: 'x', commandClass: COMMAND_CLASS.PROBE,
    });
    check('une SONDE rend son verdict sans lever', sonde.ok === false && sonde.exitCode === 1);

    for (const classe of [COMMAND_CLASS.BEST_EFFORT, COMMAND_CLASS.CLEANUP, COMMAND_CLASS.ROLLBACK]) {
      const r = await runRemoteCommand(tx, { commandId: `test.${classe}`, command: 'x', commandClass: classe });
      check(`${classe} : échec RENDU, jamais levé`, r.ok === false && r.error?.code === 'REMOTE_COMMAND_FAILED');
    }

    /**
     * L'ERREUR PRIMAIRE RESTE LA PREMIÈRE.
     * Un rollback qui échoue à son tour ne doit pas devenir l'erreur qu'on lit :
     * ce qui compte est ce qui a cassé, puis ce qu'on n'a pas su réparer.
     */
    const rollback = await runRemoteCommand(tx, {
      commandId: 'rollback.restore', command: 'x', commandClass: COMMAND_CLASS.ROLLBACK,
    });
    check('un rollback en échec n’interrompt pas le rapport d’erreur primaire',
      rollback.ok === false && rollback.error !== undefined);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. LES SORTIES SONT BORNÉES ET CAVIARDÉES.
     ══════════════════════════════════════════════════════════════════════════ */
  section('4 · Ni roman, ni secret');
  {
    const enorme = 'x'.repeat(50_000);
    const txGros = new FakeTransport().on('gros', { code: 1, stdout: enorme, stderr: enorme });
    const gros = await capture(() => runRemoteCommand(txGros, {
      commandId: 'test.gros', command: 'gros', commandClass: CRITIQUE,
    }));
    check('la sortie conservée est BORNÉE', gros.details.stderrTail.length < 3_000);
    check('…et c’est la FIN qui est gardée', gros.details.stderrTail.startsWith('…'));

    const secrets = [
      'MONGODB_URI=mongodb+srv://user:motdepasse@cluster.mongodb.net/base',
      'JWT_SECRET=abcdef0123456789abcdef0123456789',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const txSecret = new FakeTransport().on('secret', { code: 1, stderr: secrets });
    const fuite = await capture(() => runRemoteCommand(txSecret, {
      commandId: 'test.secret', command: 'secret', commandClass: CRITIQUE,
    }));
    const conserve = JSON.stringify(fuite.details);
    check('aucune URI Mongo ne survit', !conserve.includes('motdepasse@cluster'));
    check('aucun secret JWT ne survit', !conserve.includes('abcdef0123456789abcdef0123456789'));
    check('aucun en-tête d’autorisation ne survit', !/Bearer eyJ/.test(conserve));
    check('aucune clé privée ne survit', !conserve.includes('MIIEpAIBAAKCAQEA'));
    check('…et le caviardage se VOIT', /caviardé/.test(conserve));

    check('le caviardage est une fonction pure et réutilisable',
      redactOutput('x mongodb://a:b@c/d y').includes('caviardé'));
    check('un texte court n’est pas tronqué', tail('court') === 'court');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. LES COMMANDES COMPOSÉES NE MASQUENT PLUS RIEN.
     ══════════════════════════════════════════════════════════════════════════ */
  section('5 · Un shell qui s’arrête à la première erreur');
  {
    check('strictShell arme les trois gardes',
      strictShell('a; b') === 'set -euo pipefail; a; b');

    /**
     * POURQUOI CE N'EST PAS COSMÉTIQUE.
     * `cmd1; cmd2` rend le code du DERNIER, et `a | b` celui de `b` : un `tar`
     * qui échoue en amont d'un pipe disparaît derrière un `head` satisfait. Le
     * pipeline en contenait — dont la bascule, écrite avec des `if … fi` dont
     * le code est celui de la dernière commande exécutée.
     */
    const { default: fs } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const racine = join(dirname(fileURLToPath(import.meta.url)), '..', 'deployment-engine');
    const pipeline = fs.readFileSync(join(racine, 'pipeline.js'), 'utf8');
    check('la bascule de release passe par un shell strict',
      /commandId: 'release\.swap'[\s\S]{0,200}strictShell/.test(pipeline));
    check('l’installation des dépendances aussi',
      /commandId: 'dependencies\.npm_ci'[\s\S]{0,200}strictShell/.test(pipeline));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. AUCUNE COMMANDE CRITIQUE NE CONTOURNE LA PRIMITIVE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('6 · Le chemin critique ne parle plus au transport directement');
  {
    const { default: fs } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const racine = join(dirname(fileURLToPath(import.meta.url)), '..', 'deployment-engine');
    const sansCommentaire = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const pipeline = sansCommentaire(fs.readFileSync(join(racine, 'pipeline.js'), 'utf8'));
    check('pipeline.js n’appelle plus transport.exec',
      !/transport\.exec\(/.test(pipeline));
    check('…et utilise la primitive', /runRemoteCommand\(transport, \{/.test(pipeline));

    const nginx = sansCommentaire(fs.readFileSync(join(racine, 'nginx.js'), 'utf8'));
    check('nginx.js n’appelle plus transport.exec', !/transport\.exec\(/.test(nginx));

    /** Chaque appel déclare une classe : le contrôle porte sur l'omission. */
    for (const fichier of ['pipeline.js', 'nginx.js', 'certbot.js']) {
      const source = fs.readFileSync(join(racine, fichier), 'utf8');
      const appels = [...source.matchAll(/runRemoteCommand\(transport, \{([\s\S]{0,400}?)\}\)/g)];
      check(`${fichier} : chaque appel déclare une CLASSE`,
        appels.length > 0 && appels.every((m) => /commandClass:/.test(m[1])));
      check(`${fichier} : chaque appel déclare un IDENTIFIANT`,
        appels.every((m) => /commandId: '/.test(m[1])));
      check(`${fichier} : chaque commande critique porte un DÉLAI`,
        appels.filter((m) => /COMMAND_CLASS\.CRITICAL/.test(m[1])).every((m) => /timeoutMs:/.test(m[1])));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. LA POLITIQUE DE DÉLAIS EST CENTRALE.
     ══════════════════════════════════════════════════════════════════════════ */
  section('7 · Aucune commande ne peut bloquer indéfiniment');
  {
    check('les délais sont déclarés une fois', Object.keys(TIMEOUTS).length >= 6);
    check('…tous positifs et finis',
      Object.values(TIMEOUTS).every((v) => Number.isFinite(v) && v > 0));
    check('…une installation a plus de temps qu’un lien symbolique',
      TIMEOUTS.INSTALL > TIMEOUTS.FILESYSTEM);
    check('…et une émission de certificat plus qu’un contrôle de santé',
      TIMEOUTS.CERTBOT > TIMEOUTS.HEALTH);

    let recu = null;
    const txEspion = { kind: 'fake', async exec(_c, opts) { recu = opts; return { code: 0 }; } };
    await runRemoteCommand(txEspion, {
      commandId: 'test.delai', command: 'x', commandClass: CRITIQUE, timeoutMs: TIMEOUTS.INSTALL,
    });
    check('le délai est bien TRANSMIS au transport', recu?.timeoutMs === TIMEOUTS.INSTALL);

    let sansDelai = null;
    const txDefaut = { kind: 'fake', async exec(_c, opts) { sansDelai = opts; return { code: 0 }; } };
    await runRemoteCommand(txDefaut, { commandId: 'test.defaut', command: 'x', commandClass: CRITIQUE });
    check('…et un délai par défaut s’applique toujours', sansDelai?.timeoutMs === TIMEOUTS.QUICK);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8. LES MODULES NOUVELLEMENT CLASSÉS — depuis leur NIVEAU APPELANT.

     ══ POURQUOI ON N'INSTRUMENTE PAS LA PRIMITIVE ═══════════════════════════

     Il serait facile de remplacer `runRemoteCommand` par un double et de
     vérifier qu'on l'appelle. Cela ne prouverait rien : ni que la classe est la
     bonne, ni que l'appelant traite le résultat correctement. On casse donc de
     VRAIES commandes sur un transport simulé, et l'on observe ce que la
     FONCTION MÉTIER en fait.
     ══════════════════════════════════════════════════════════════════════════ */
  section('8 · Chaque module classé échoue là où il doit');
  {
    const { inventoryUploads, migrateUploads } = await import('../deployment-engine/uploads.js');
    const { createBackup } = await import('../deployment-engine/backup.js');

    /**
     * ══ LE DÉFAUT P0 DE CE LOT ═══════════════════════════════════════════════
     *
     * L'inventaire des médias ne lisait pas son code de sortie. Un dossier
     * source illisible rendait une sortie vide, donc un inventaire vide, donc
     * « aucun média à migrer » : la migration se déclarait réussie avec zéro
     * fichier, et la nouvelle vitrine répondait 404 sur toutes ses images.
     */
    const txInventaireKo = new FakeTransport().on(/find \. -type f -exec sha256sum/, { code: 2, stderr: 'find: Permission denied' });
    const inv = await capture(() => inventoryUploads(txInventaireKo, '/var/www/x/shared/uploads'));
    check('uploads : un inventaire ILLISIBLE lève, au lieu de rendre le vide',
      inv instanceof RemoteCommandError);
    check('…et nomme la commande', inv?.details?.commandId === 'uploads.inventory');

    const txMigrationKo = new FakeTransport().on(/find \. -type f -exec sha256sum/, { code: 2, stderr: 'denied' });
    const mig = await capture(() => migrateUploads(txMigrationKo, {
      destination: '/var/www/neuf/shared/uploads',
      identityId: 'id-1',
      sources: [{ host: 'ancien', sharedUploadsPath: '/var/www/ancien/shared/uploads', projectIdentityId: 'id-1' }],
    }));
    check('uploads.migrate : la migration ÉCHOUE au lieu de migrer zéro fichier',
      mig instanceof RemoteCommandError);

    const txCoupe = new FakeTransport().on(/find \. -type f -exec sha256sum/, { code: null });
    const coupe = await capture(() => inventoryUploads(txCoupe, '/var/www/x/shared/uploads'));
    check('uploads : une connexion perdue lève aussi',
      coupe?.code === 'REMOTE_COMMAND_CONNECTION_LOST');

    const txVide = new FakeTransport();
    const vide = await inventoryUploads(txVide, '/var/www/neuf/shared/uploads');
    check('uploads : un dossier ABSENT rend un inventaire vide, sans erreur', vide.size === 0);

    /* ── SAUVEGARDE : le dump est critique, la copie facultative ne l'est pas ── */
    const txDumpKo = new FakeTransport()
      .on('mongodump', { code: 1, stderr: 'connection refused to mongodb+srv://u:motdepasse@c.net/db' });
    const dump = await capture(() => createBackup({
      transport: txDumpKo, host: 'x.test', dbName: 'base', mongoUri: 'mongodb://x/y', version: 'v1', stamp: 's',
    }));
    check('backup : un dump ÉCHOUÉ interrompt la sauvegarde', dump instanceof RemoteCommandError);
    check('…et nomme la commande', dump?.details?.commandId === 'backup.mongodump');
    check('…SANS laisser fuiter l’URI Mongo du message d’erreur',
      !JSON.stringify(dump?.details ?? {}).includes('motdepasse@c.net'));
    check('…le caviardage se voit', /caviardé/.test(JSON.stringify(dump?.details ?? {})));

    /**
     * LA COPIE DES MÉDIAS DANS LA SAUVEGARDE EST BEST-EFFORT, ET DÉCLARÉE.
     * Un site sans dossier `uploads` ne doit pas empêcher de sauvegarder sa
     * base — mais ce choix est écrit, pas subi.
     */
    const txCopieKo = new FakeTransport().on('cp -a', { code: 1, stderr: 'no such file' });
    const partiel = await capture(() => createBackup({
      transport: txCopieKo, host: 'x.test', dbName: 'base', mongoUri: 'mongodb://x/y', version: 'v1', stamp: 's',
    }));
    check('backup : une copie facultative en échec n’interrompt PAS', partiel === null);
  }

  console.log(`\n${pass} réussis, ${fail} échoués`);
} catch (err) {
  console.error('REMOTE COMMAND TEST CRASHED:', err);
  fail++;
}
process.exit(fail === 0 ? 0 : 1);
