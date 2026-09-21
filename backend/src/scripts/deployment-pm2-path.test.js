/**
 * PM2 DOIT EXÉCUTER LE FICHIER QU'ON VIENT DE DÉPLOYER.
 *
 * ── LE DÉFAUT, CONSTATÉ EN PRODUCTION ───────────────────────────────────────
 * L'étape de redémarrage faisait `cd <backendDir> && pm2 reload <name>`. Le
 * `cd` n'a AUCUN effet sur le fichier relancé : PM2 exécute le chemin qu'il a
 * mémorisé au tout premier `pm2 start`. Si ce chemin n'est plus celui où le
 * déploiement écrit, chaque déploiement suivant relance éternellement l'ancien
 * code.
 *
 * Et en silence : le rechargement rend 0, l'ancien backend répond, donc le
 * contrôle de service ET la vérification publique passent. Seul le frontend est
 * réellement mis à jour — nginx sert ses fichiers directement.
 *
 * Résultat mesuré sur le Panel déployé : `version.json` annonçait le commit du
 * jour, pendant que `POST /api/uploads/image` répondait « Route inconnue » —
 * une route pourtant montée depuis plusieurs commits. Deux déploiements verts
 * consécutifs n'y avaient rien changé.
 *
 * Ces contrôles rejouent exactement cette situation.
 */
let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { restartBackend, readPm2Location, pm2AppName } = await import('../deployment-engine/pm2.js');

const BACKEND = '/var/www/panel.ly-solution.com/backend';
const ATTENDU = `${BACKEND}/src/server.js`;

/**
 * VPS simulé. `enregistre` est le chemin que PM2 a mémorisé ; `null` signifie
 * qu'aucun process de ce nom n'existe.
 */
const NOM_PM2 = pm2AppName('panel.ly-solution.com');

function faireVps({ enregistre, nom = NOM_PM2, echoue = false }) {
  const commandes = [];
  let courant = enregistre;
  return {
    commandes,
    // Transport SIMULÉ : le moteur n'attend pas qu'un process fictif « vive ».
    kind: 'fake',
    get chemin() { return courant; },
    async exec(cmd) {
      commandes.push(cmd);
      if (cmd.includes('pm2 jlist')) {
        // Statut, PID, redémarrages et port : le moteur exige désormais la
        // preuve qu'un service est EN LIGNE et stable, pas seulement qu'il
        // exécute le bon fichier — un process qui boucle a le bon chemin.
        const liste = courant === null ? [] : [{
          name: nom,
          pid: 4242,
          pm2_env: {
            pm_exec_path: courant,
            pm_cwd: courant.replace('/src/server.js', ''),
            status: 'online',
            restart_time: 0,
            env: { PORT: '4100' },
          },
        }];
        return { code: 0, stdout: JSON.stringify(liste), stderr: '' };
      }
      if (echoue) return { code: 1, stdout: '', stderr: 'pm2 a échoué' };
      // `delete` oublie le chemin ; `start` en enregistre un neuf ; `reload`
      // ne change RIEN — c'est tout le défaut.
      if (cmd.includes('pm2 delete')) courant = null;
      if (cmd.includes('pm2 start')) {
        const m = cmd.match(/cd (\S+) &&/);
        courant = `${m[1]}/src/server.js`;
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

const lancer = (vps) => restartBackend(vps, {
  host: 'panel.ly-solution.com', backendDir: BACKEND, port: 4100, env: 'TEST',
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1. LECTURE DU CHEMIN MÉMORISÉ PAR PM2');
{
  const jlist = JSON.stringify([{ name: 'a', pm2_env: { pm_exec_path: '/x/src/server.js', pm_cwd: '/x' } }]);
  check('le chemin est lu depuis pm2_env', readPm2Location(jlist, 'a')?.execPath === '/x/src/server.js');
  check('…le dossier aussi', readPm2Location(jlist, 'a')?.cwd === '/x');
  check('un process absent rend null', readPm2Location(jlist, 'inconnu') === null);
  check('une sortie illisible rend null', readPm2Location('pas du json', 'a') === null);
  check('une liste vide rend null', readPm2Location('[]', 'a') === null);

  // Certaines versions de PM2 posent les champs à la racine.
  const plat = JSON.stringify([{ name: 'a', pm_exec_path: '/y/src/server.js' }]);
  check('l’ancienne forme est acceptée aussi', readPm2Location(plat, 'a')?.execPath === '/y/src/server.js');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. PREMIER DÉPLOIEMENT — le process n’existe pas encore');
{
  const vps = faireVps({ enregistre: null });
  const r = await lancer(vps);
  check('il est CRÉÉ', r.action === 'start');
  check('…sur le dossier déployé', vps.chemin === ATTENDU);
  check('…et aucune suppression inutile', !vps.commandes.some((c) => c.includes('pm2 delete')));
  check('la liste est persistée', vps.commandes.some((c) => c === 'pm2 save'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. REDÉPLOIEMENT NORMAL — même chemin, rechargement sans coupure');
{
  const vps = faireVps({ enregistre: ATTENDU });
  const r = await lancer(vps);
  check('il est RECHARGÉ', r.action === 'reload');
  check('…sans être supprimé', !vps.commandes.some((c) => c.includes('pm2 delete')));
  check('…le chemin reste le bon', vps.chemin === ATTENDU);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. LE DÉFAUT DE PRODUCTION — PM2 pointe ailleurs');
{
  // Le process avait été créé quand le projet vivait sous un autre domaine.
  const ANCIEN = '/var/www/panel.lycarz.com/backend/src/server.js';
  const vps = faireVps({ enregistre: ANCIEN });
  const r = await lancer(vps);

  check('le process est RECRÉÉ, pas rechargé', r.action === 'recreate');
  check('…l’ancien chemin est signalé', r.previousPath === ANCIEN);
  check('…la définition est effacée d’abord', vps.commandes.some((c) => c.includes('pm2 delete')));
  check('…puis recréée sur le dossier déployé',
    vps.commandes.some((c) => c.includes('pm2 start') && c.includes(BACKEND)));
  check('PM2 exécute enfin le fichier déployé', vps.chemin === ATTENDU);

  // Ce qu'il ne faut SURTOUT pas faire : un simple reload.
  check('aucun rechargement à l’aveugle',
    !vps.commandes.some((c) => c.includes('pm2 reload')));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. PREUVE APRÈS COUP — on relit PM2, on ne croit pas le code de sortie');
{
  /**
   * VPS qui accepte tout et ne change jamais rien : exactement ce que faisait
   * `pm2 reload` sur un chemin périmé. Le code de sortie vaut 0, et pourtant
   * l'ancien fichier tourne toujours.
   */
  const menteur = {
    commandes: [],
    async exec(cmd) {
      this.commandes.push(cmd);
      if (cmd.includes('pm2 jlist')) {
        return {
          code: 0,
          stdout: JSON.stringify([{ name: NOM_PM2, pm2_env: { pm_exec_path: '/ailleurs/src/server.js', pm_cwd: '/ailleurs' } }]),
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };

  let err = null;
  await lancer(menteur).catch((e) => { err = e; });
  check('un redémarrage qui n’a rien changé est REFUSÉ', err?.code === 'PM2_STALE_PATH');
  check('…en nommant le fichier attendu', err?.details?.expected === ATTENDU);
  check('…et celui réellement exécuté', err?.details?.running === '/ailleurs/src/server.js');
  check('…la liste n’est pas persistée sur un état faux',
    !menteur.commandes.some((c) => c === 'pm2 save'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. ÉCHEC FRANC DE PM2 — toujours signalé');
{
  const vps = faireVps({ enregistre: ATTENDU, echoue: true });
  let err = null;
  await lancer(vps).catch((e) => { err = e; });
  check('un code de sortie non nul est refusé', err?.code === 'PM2_RESTART_FAILED');
  check('…en disant quelle action a échoué', err?.details?.action === 'reload');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. LE MOTEUR EST MIRRORÉ — la règle vaut des deux côtés');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const ici = await fs.readFile(path.join(racine, 'src/deployment-engine/pm2.js'), 'utf8');

  const autre = path.resolve(racine, '../../Panel/backend/src/deployment-engine/pm2.js');
  let miroir = null;
  try { miroir = await fs.readFile(autre, 'utf8'); } catch { /* dépôt voisin absent */ }

  if (miroir === null) {
    check('dépôt voisin absent — contrôle ignoré (atelier)', true);
  } else {
    const norm = (s) => s.replace(/\r\n/g, '\n');
    check('les deux moteurs sont identiques', norm(miroir) === norm(ici));
    check('…et le miroir vérifie aussi le chemin', /PM2_STALE_PATH/.test(miroir));
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
