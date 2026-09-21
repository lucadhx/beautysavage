import net from 'node:net';
import { execSync } from 'node:child_process';

/**
 * RECYCLAGE D'UN PORT LOCAL — « occupé » n'est pas une raison de ne pas démarrer.
 *
 * ══ LE PROBLÈME, ET IL EST QUOTIDIEN ════════════════════════════════════════
 *
 * Un `node --watch` orphelin, un terminal fermé sans Ctrl-C, un redémarrage qui
 * se chevauche : le port reste tenu par un processus qui n'est plus surveillé
 * par personne. Le démarrage suivant échouait en `EADDRINUSE`, et il fallait
 * aller chercher le PID à la main — plusieurs fois par jour.
 *
 * `scripts/dev-canonical.mjs` savait déjà le faire, mais seulement pour les
 * TROIS ports canoniques codés en dur, et seulement quand on passe par lui. Un
 * projet dont le `.env` porte un autre port, ou un `npm run dev:app` lancé
 * directement, retombaient sur l'échec. La logique vit donc ici, et les deux
 * entrées s'en servent.
 *
 * ══ CE QUI EMPÊCHE CE MODULE D'ÊTRE DANGEREUX ═══════════════════════════════
 *
 * Tuer le détenteur d'un port est un geste violent, et sur un serveur partagé
 * il peut couper le site d'un AUTRE client : le registre de ports de ce projet
 * a déjà constaté un port revendiqué ici et détenu là-bas par
 * `panel-panel.ly-solution.com`. Deux verrous, et ils sont indépendants :
 *
 *   1. `isRecyclable()` refuse dès que CE processus est supervisé (PM2). Un
 *      backend déployé tourne toujours sous PM2 ; il ne recyclera donc jamais
 *      rien. C'est le verrou principal.
 *   2. `recyclePort()` refuse de tuer un processus dont la ligne de commande
 *      trahit une SUPERVISION. On ne prend jamais un port à un service que
 *      quelqu'un a chargé de rester en vie — même lancé à la main sur le VPS
 *      pour déboguer, ce module ne peut pas couper la production.
 *
 * ⚠️ `ENV=PROD` n'est PAS un verrou valable, et c'est délibéré : `ENV` désigne
 * le monde des DONNÉES (base TEST ou PROD), pas le mode d'exécution. Un projet
 * en `ENV=TEST` est déployé sur le même serveur qu'un projet en PROD — s'en
 * servir comme garde-fou laisserait passer exactement le cas dangereux.
 */

/**
 * LES DEUX PILES IP, ET C'EST TOUT L'ENJEU.
 *
 * ══ LE DÉFAUT QUE CE DÉTAIL A PRODUIT ═══════════════════════════════════════
 *
 * Cette fonction ne testait que `127.0.0.1`. Or un serveur de développement
 * Vite laissé orphelin écoute souvent sur `[::1]` SEULEMENT — la boucle locale
 * IPv6. Invisible depuis IPv4, il était déclaré « port libre », le recyclage
 * ne regardait même pas quels processus écoutaient, et le nouveau serveur
 * prenait `0.0.0.0:6062` à côté de lui.
 *
 * Deux serveurs sur le même port, donc. Et comme `localhost` se résout en
 * `::1` AVANT `127.0.0.1` sous Windows, le navigateur atteignait le
 * SURVIVANT : on lançait le dev d'IRK et `localhost:6062` affichait le site
 * de Karting de l'Étang. Constaté tel quel :
 *
 *     127.0.0.1:6062  → Inter Racing Kart      (le serveur qu'on vient de lancer)
 *     [::1]:6062      → Karting de l'Étang     (l'orphelin de la session d'avant)
 *     localhost:6062  → Karting de l'Étang     (donc : le mauvais projet)
 *
 * Le port est occupé dès qu'UNE des deux piles répond. On interroge donc les
 * deux, et « libre » veut enfin dire libre.
 */
function ecouteSur(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(600, () => { socket.destroy(); resolve(false); });
  });
}

/** Le port accepte-t-il une connexion — sur l'une OU l'autre pile ? */
export async function portInUse(port) {
  const [v4, v6] = await Promise.all([
    ecouteSur('127.0.0.1', port),
    ecouteSur('::1', port),
  ]);
  return v4 || v6;
}

/** PIDs en LISTEN sur un port local (Windows `netstat` / POSIX `lsof`). */
export function pidsListeningOn(port) {
  try {
    if (process.platform === 'win32') {
      /**
       * `-p tcp` NE MONTRE QUE L'IPv4 — et c'est la moitié du défaut.
       *
       * Sous Windows, le protocole d'une socket IPv6 s'appelle `TCPv6` : le
       * filtre `-p tcp` l'exclut. Un serveur écoutant sur `[::1]` n'apparaissait
       * donc dans AUCUNE ligne, et le recyclage n'avait aucun PID à terminer —
       * même une fois `portInUse` corrigé pour le détecter.
       *
       * On liste tout et l'on filtre sur la colonne de protocole : `TCP` comme
       * `TCPv6`. `netstat` sans `-p` reste peu coûteux (quelques dizaines de
       * millisecondes) et il est déjà appelé une fois par port, au démarrage.
       */
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const m = line.trim().split(/\s+/); // TCP|TCPv6  addr:port  remote  LISTENING  pid
        if (m.length < 5 || !/^TCP/i.test(m[0])) continue;
        /*
          `endsWith(':port')` et non une comparaison de suffixe nu : sans les
          deux-points, le port 62 matcherait « 6062 ». L'adresse IPv6 porte ses
          propres deux-points (`[::1]:6062`), mais le DERNIER groupe reste le
          port — c'est bien lui qu'on compare.
        */
        if (m[1] && m[1].endsWith(`:${port}`)) pids.add(Number(m[4]));
      }
      // Les PID <= 4 sont le noyau et le processus « System » : jamais les nôtres.
      return [...pids].filter((pid) => Number.isFinite(pid) && pid > 4);
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.split(/\s+/).map(Number).filter((pid) => Number.isFinite(pid) && pid > 1);
  } catch {
    // `netstat`/`lsof` absent ou muet : on ne sait pas, donc on ne tue rien.
    return [];
  }
}

/** Ligne de commande du processus — la transparence AVANT de le terminer. */
export function describePid(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: 'utf8' },
      ).trim();
      return out || '(processus inconnu)';
    }
    return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' }).trim() || '(processus inconnu)';
  } catch {
    return '(processus inconnu)';
  }
}

/**
 * CE PROCESSUS EST-IL SUPERVISÉ ? — la marque d'un service, pas d'une session.
 *
 * PM2 injecte `pm_id` dans l'environnement de ses enfants, et c'est ainsi que
 * le backend déployé tourne (`pm2 start src/server.js --name …`). Sa présence
 * suffit à dire « je suis un service » — et un service ne recycle rien.
 */
export function isSupervised(env = process.env) {
  return env.pm_id !== undefined || env.PM2_HOME !== undefined || env.pm2_env !== undefined;
}

/** La ligne de commande d'un tiers trahit-elle une supervision ? */
function looksSupervised(commande) {
  return /\bpm2\b|ProcessContainerFork|systemd|supervisord/i.test(commande);
}

/**
 * LE RECYCLAGE EST-IL AUTORISÉ ICI ?
 *
 * Par défaut oui en local, non sous supervision. `DEV_PORT_RECYCLE=off` coupe
 * la fonction sans toucher au code — pour la machine de quelqu'un qui préfère
 * l'échec franc.
 */
export function isRecyclable(env = process.env) {
  const reglage = String(env.DEV_PORT_RECYCLE ?? '').trim().toLowerCase();
  if (['0', 'off', 'false', 'no', 'non'].includes(reglage)) {
    return { allowed: false, reason: 'DEV_PORT_RECYCLE=off' };
  }
  if (isSupervised(env)) {
    return { allowed: false, reason: 'processus supervisé (PM2)' };
  }
  return { allowed: true, reason: null };
}

/**
 * LIBÈRE LE PORT, ou explique pourquoi il ne l'a pas fait.
 *
 * Ne LÈVE jamais : l'appelant décide quoi faire d'un échec, et sur le chemin de
 * démarrage la bonne réaction est de dire la vraie cause, pas d'en ajouter une.
 *
 * @returns {Promise<{freed: boolean, killed: {pid:number,command:string}[], reason: string|null}>}
 */
export async function recyclePort(port, { log = () => {}, timeoutMs = 8_000 } = {}) {
  const autorisation = isRecyclable();
  if (!autorisation.allowed) {
    return { freed: false, killed: [], reason: autorisation.reason };
  }
  if (!(await portInUse(port))) {
    return { freed: true, killed: [], reason: null };
  }

  const killed = [];
  let protege = null;

  for (const pid of pidsListeningOn(port)) {
    // Se tuer soi-même transformerait un port occupé en processus disparu.
    if (pid === process.pid) continue;

    const commande = describePid(pid);
    if (looksSupervised(commande)) {
      protege = `PID ${pid} est supervisé — ${commande.slice(0, 120)}`;
      log(`  ✗ Port ${port} : PID ${pid} est un service supervisé, il n’est pas terminé.`);
      continue;
    }

    log(`  ♻ Port ${port} occupé par un reliquat (PID ${pid}) — terminé automatiquement.`);
    log(`    ${commande.slice(0, 120)}`);
    try {
      // `/T` sous Windows : l'arborescence entière, car `node --watch` tient le
      // port depuis un enfant que tuer seul laisserait le parent le rouvrir.
      if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      killed.push({ pid, command: commande });
    } catch {
      // Déjà mort, ou emporté par l'arborescence d'un précédent : sans intérêt.
    }
  }

  /**
   * LA MORT DU PROCESSUS N'EST PAS LA LIBÉRATION DU PORT.
   *
   * Le noyau garde la socket quelques instants (fermeture des connexions en
   * cours, TIME_WAIT sur certaines configurations). Réécouter tout de suite
   * échouerait encore en `EADDRINUSE` — pour une raison qui n'existe déjà plus.
   */
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite && (await portInUse(port))) {
    await new Promise((r) => setTimeout(r, 250));
  }

  const libre = !(await portInUse(port));
  return {
    freed: libre,
    killed,
    reason: libre ? null : (protege ?? 'le port est resté occupé après terminaison'),
  };
}

export default { portInUse, pidsListeningOn, describePid, isSupervised, isRecyclable, recyclePort };
