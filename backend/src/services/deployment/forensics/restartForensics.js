/**
 * ══ POURQUOI LE BACKEND REDÉMARRE-T-IL PENDANT UNE CONNEXION SERVEUR ? ══════
 *
 * ── L'INCIDENT ─────────────────────────────────────────────────────────────
 *
 * En développement, le backend tourne sous `node --watch src/server.js`. Au clic
 * « Suivant » de l'étape « Connexion au serveur », il redémarrait : les appels
 * en vol mouraient en `ECONNRESET`, et l'écran annonçait un échec de connexion
 * là où rien n'avait échoué.
 *
 * ══ CE QUE LA V1 A MANQUÉ, ET POURQUOI ══════════════════════════════════════
 *
 * La V1 a bien capté le redémarrage — et rapporté `filesChanged=0`. Elle
 * surveillait `backend/src`, sur la prémisse que c'était « le seul dossier dont
 * une modification relance le service ».
 *
 * La MESURE (Node v22.19.0, win32) invalide cette prémisse. Le critère de
 * redémarrage n'est pas l'emplacement, c'est l'APPARTENANCE AU GRAPHE DE
 * MODULES CHARGÉ :
 *
 *     fichier importé, où qu'il soit     →  Restarting        (mesuré)
 *     `node_modules` réellement chargé   →  Restarting        (mesuré)
 *     fichier sous `src` jamais importé  →  RIEN              (mesuré)
 *     package.json, .env, logs/, uploads →  RIEN              (mesuré)
 *
 * La V1 regardait donc 182 fichiers inertes et IGNORAIT les 879 fichiers de
 * `node_modules` que ce process charge vraiment. Son `filesChanged=0` était
 * exact et sans valeur : elle ne pouvait pas voir l'écriture qu'elle cherchait.
 *
 * ══ CE QUE FAIT CETTE V2 ════════════════════════════════════════════════════
 *
 *   · elle CONSTRUIT le graphe réellement chargé (`moduleGraph.js`) ;
 *   · elle surveille les racines de ce graphe — chemins RÉELS, jonctions
 *     comprises — et filtre chaque événement par appartenance au graphe ;
 *   · elle photographie chaque fichier chargé (date, taille, inode, empreinte
 *     de contenu hors `node_modules`) ;
 *   · elle JOURNALISE CHAQUE CHANGEMENT IMMÉDIATEMENT, pour qu'une écriture
 *     annulée avant le redémarrage laisse quand même une trace ;
 *   · elle corrèle avec l'horodatage du « Restarting » que le lanceur de
 *     développement capture sur le process PARENT (`scripts/dev-watch.js`), le
 *     seul endroit où ce message existe.
 *
 * Elle s'arme TOUTE SEULE au début de l'étape incriminée. Aucune commande à
 * lancer, aucun fichier à ouvrir : l'exploitant copie sa console.
 *
 * ── CE QU'ELLE NE FAIT PAS ─────────────────────────────────────────────────
 *
 * Elle n'OBSERVE que. Elle ne remplace aucun gestionnaire de signal — en
 * ajouter un sur `SIGTERM`/`SIGINT` supprimerait la terminaison par défaut de
 * Node, donc changerait le comportement qu'on prétend mesurer. Elle n'écrit
 * QUE sous `backend/logs/`, dont la mesure établit qu'il ne déclenche aucun
 * redémarrage — un traceur qui provoquerait l'événement qu'il observe serait
 * pire qu'inutile.
 *
 * Elle ne s'active jamais en production, et n'attend aucun drapeau manuel.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import config from '../../../config/env.js';
/**
 * ══ CE QUE CE MODULE N'IMPORTE PLUS, ET POURQUOI ÇA COMPTE ═════════════════
 *
 * `construireGrapheCharge`, `racinesDeSurveillance` et `observerImportsDynamiques`
 * ne sont plus importés. Ce n'est pas du ménage : tant que la fonction est à
 * portée d'un appel, l'armement peut redevenir un balayage sans que personne ne
 * le remarque en relecture. Ne plus les importer rend la régression VISIBLE —
 * il faudrait rajouter une ligne d'import pour la commettre.
 *
 * Seules restent deux constantes de chemin et un formateur de chemin relatif,
 * qui ne touchent pas le disque.
 */
import { BACKEND, REPO, SRC } from './moduleGraph.js';

/** `backend/logs/…` — HORS du graphe de modules, donc inoffensif à écrire. */
const DOSSIER_TRACE = path.resolve(BACKEND, 'logs/deployment-forensics');
const FICHIER_TRACE = path.join(DOSSIER_TRACE, 'connexion-serveur.jsonl');
/** Écrit par le LANCEUR (process parent), lu ici. Voir `scripts/dev-watch.js`. */
export const FICHIER_WATCH = path.join(DOSSIER_TRACE, 'watch-parent.jsonl');

/** Durée d'observation autour du clic. Assez pour un redémarrage, pas plus. */
const FENETRE_MS = 25_000;
/**
 * RÉPIT APRÈS L'ISSUE — le run réel s'est interrompu JUSTE après la sonde SSH.
 *
 * La V1 désarmait à `CONNECTED` / `SSH_REFUSED`, c'est-à-dire potentiellement
 * quelques millisecondes avant le redémarrage qu'elle cherchait. On garde ce
 * désarmement — laisser 25 secondes de surveillance permanente serait du bruit
 * — mais on lui ajoute un court répit pendant lequel la trace reste vivante.
 */
const REPIT_APRES_ISSUE_MS = 2_000;
/** Au-delà, une trace non close appartient à une session oubliée, pas à la nôtre. */
const RECUPERATION_MAX_MS = 5 * 60 * 1000;

/**
 * DEV UNIQUEMENT — et sans drapeau à poser.
 *
 * Une surveillance récursive du système de fichiers n'a rien à faire en
 * production : coût inutile, et bruit dans des journaux qui servent à autre
 * chose. `ENV=TEST` est le monde de développement de ce projet.
 */
export function estActivable() {
  return config.env !== 'PROD';
}

let sessionActive = null;
let sequence = 0;

/**
 * ══ CE QUE L'ENFANT DIT AU PARENT (V3) ═════════════════════════════════════
 *
 * ── POURQUOI CE CANAL EXISTE, ET CE QU'IL N'EST PAS ────────────────────────
 *
 * Le V3 déplace l'attribution du redémarrage vers le lanceur, qui SURVIT à
 * l'événement. Mais le parent ignore tout du métier : il ne sait pas qu'un clic
 * « Suivant » vient d'ouvrir une étape « Connexion au serveur ». Sans ce canal,
 * il journaliserait un redémarrage orphelin, sans pouvoir le rattacher — ou,
 * pire, l'y rattacherait à tort.
 *
 * L'enfant lui envoie donc UNE seule chose, et RIEN d'autre :
 *
 *   SESSION_ARMED / DISARMED   le contexte métier, pour la corrélation.
 *
 * ── CE QU'IL N'ENVOIE PLUS, ET POURQUOI C'EST MIEUX ────────────────────────
 *
 * Il publiait aussi son GRAPHE — qu'il devait donc construire, en lisant tout
 * le projet, au clic. Or le parent tient déjà le sien de NODE LUI-MÊME
 * (`watch:require` / `watch:import`) : une source autoritaire, gratuite, et
 * disponible dès le premier boot. L'enfant reconstruisait, au pire moment, ce
 * que le parent savait déjà.
 *
 * ── POURQUOI `process.send` EST SANS RISQUE ICI ────────────────────────────
 *
 * MESURE : sous `node --watch`, le serveur dispose DÉJÀ d'un canal IPC — le
 * mode surveillance lui en donne un pour ses propres annonces `watch:require`.
 * Émettre dessus n'ajoute donc aucune capacité au processus observé, et n'en
 * change pas le comportement. Si personne n'écoute (lancement par `dev:raw`,
 * ou exécution directe), l'envoi est silencieusement sans effet.
 *
 * Aucun secret ne transite : un identifiant de session, une étape, des chemins.
 */
function direAuParent(charge) {
  try {
    if (typeof process.send === 'function' && process.connected) {
      process.send({ forensics: charge });
      return true;
    }
  } catch { /* le parent est parti : ce n'est pas une erreur de l'application */ }
  return false;
}

const horodatage = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  + `:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;

/**
 * ══ AUCUN SECRET N'ENTRE DANS UNE TRACE DE DIAGNOSTIC ══════════════════════
 *
 * Une trace se copie-colle dans un ticket, un chat, un e-mail. Elle voyage donc
 * plus loin que les journaux du serveur, et doit être PLUS prudente qu'eux.
 * On masque par motif ET par valeur connue : un mot de passe SSH n'a aucune
 * forme reconnaissable, seule l'origine le désigne — d'où l'interdiction, en
 * amont, de lui faire traverser cette frontière.
 */
export function caviarder(texte) {
  if (typeof texte !== 'string' || !texte) return texte;
  let out = texte;
  out = out.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, 'mongodb://«caviardé»');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1«caviardé»');
  out = out.replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,})\b/g, '«jwt-caviardé»');
  out = out.replace(/\b(sk|pk|whsec|xkeysib|rk)[_-][A-Za-z0-9_-]{6,}/gi, '«clé-caviardée»');
  out = out.replace(
    /("?\b(password|motdepasse|mot_de_passe|secret|token|apiKey|api_key|authorization)\b"?\s*[:=]\s*)("?)[^\s",}]+\3/gi,
    '$1«caviardé»',
  );
  return out;
}

/** Un hôte reste diagnostiquable sans être publié en clair. */
const masquerHote = (h) => {
  const s = String(h ?? '');
  if (!s) return '(absent)';
  const parts = s.split('.');
  if (parts.length >= 3) return `${parts[0].slice(0, 2)}***.${parts.slice(-2).join('.')}`;
  return `${s.slice(0, 2)}***`;
};

/** Écrit la ligne en console ET dans le fichier de reprise. Ne lève jamais. */
function emettre(categorie, message, extra = {}) {
  sequence += 1;
  const at = new Date();
  const ligne = `[DEPLOY-FORENSICS #${String(sequence).padStart(3, '0')} ${horodatage(at)}] ${categorie} ${caviarder(message)}`;
  // eslint-disable-next-line no-console
  console.log(ligne);
  try {
    fs.appendFileSync(
      FICHIER_TRACE,
      `${JSON.stringify({ seq: sequence, at: at.toISOString(), atMs: at.getTime(), categorie, message: caviarder(message), ...extra })}\n`,
    );
  } catch { /* une trace qui échoue ne casse jamais l'opération observée */ }
  return ligne;
}

/* -------------------------------------------------------------------------- */
/*  PAS DE PHOTOGRAPHIE ICI — ET C'EST LE CŒUR DU CORRECTIF                   */
/* -------------------------------------------------------------------------- */
/*
 * `photographier()`, `photographierGraphe()` et `comparerPhotos()` vivaient ici.
 * Ils ont été RETIRÉS, pas déplacés : le lanceur possède déjà les siens, posés à
 * froid au démarrage de `npm run dev` et maintenus depuis.
 *
 * Les garder « au cas où » aurait laissé la tentation à portée de main — et un
 * jour quelqu'un les rappellerait depuis l'armement, pour « juste vérifier un
 * détail ». L'absence est la seule garantie qui ne dépend de personne.
 *
 * Ce module ne lit plus AUCUN fichier du projet. Il écrit une ligne de journal
 * sous `backend/logs/`, dont la mesure établit qu'elle ne relance rien.
 */

/* -------------------------------------------------------------------------- */
/*  ARMEMENT                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ARME LA TRACE — appelé au tout début de l'étape « Connexion au serveur ».
 *
 * Idempotent : deux clics rapprochés ne créent pas deux surveillants (ce qui
 * fuirait des descripteurs de fichiers à chaque essai).
 */
export function armerTraceConnexion({ etape = 'CONNECTION_SERVER', targetId = null } = {}) {
  if (!estActivable() || sessionActive) return null;

  try { fs.mkdirSync(DOSSIER_TRACE, { recursive: true }); } catch { /* voir plus bas */ }

  sequence = 0;
  const debut = Date.now();
  sessionActive = {
    debut, etape, targetId, http: [], clos: false, minuteur: null, repit: null,
    /** Identifie CETTE session pour le parent, qui lui rattachera un redémarrage. */
    sessionId: crypto.randomUUID(),
  };

  /**
   * ══ LES PID SONT NOMMÉS, PLUS JAMAIS « PARENT » (§11) ════════════════════
   *
   * Trois processus se superposent, et les journaux précédents les appelaient
   * tous « parent » à un moment ou à un autre — `ppid` ici, `pidParent` là,
   * `childOld` dans le verdict. Relire un incident demandait de deviner lequel
   * était lequel.
   *
   *     launcherPid    `npm run dev` → scripts/dev-watch.js — SURVIT à tout
   *     nodeWatchPid   le process `node --watch` — remplace ses enfants
   *     serverPid      CE process, celui qui meurt et renaît
   *
   * `nodeWatchPid` STABLE entre deux sessions = redémarrage de surveillance.
   * S'il change, ce n'est plus le surveillant qui relance : c'est une seconde
   * instance, et l'enquête est ailleurs.
   */
  emettre('ARMED', `étape=${etape} serverPid=${process.pid} nodeWatchPid=${process.ppid}`
    + ` env=${config.env}${targetId ? ` target=${targetId}` : ''}`
    + ` fenêtre=${FENETRE_MS / 1000}s répit=${REPIT_APRES_ISSUE_MS}ms`,
  { debut, serverPid: process.pid, nodeWatchPid: process.ppid });

  /**
   * ══ ON SE DÉCLARE AU PARENT AVANT DE FAIRE QUOI QUE CE SOIT (§12) ════════
   *
   * ── LE DÉFAUT QUE CETTE POSITION CORRIGE, PROUVÉ PAR LE JOURNAL ──────────
   *
   * Incident du 17/08 :
   *
   *     22:37:57.653  ARMED                    (dernière ligne écrite par l'enfant)
   *     22:37:57.663  CHANGE  …/startupReconciliation.service.js
   *     22:37:57.797  CHANGE  …/integratedApiStartup.service.js
   *     22:37:59.258  Restarting 'src/server.js'
   *
   * Après `ARMED`, l'enfant n'a plus RIEN écrit : ni `PARENT`, ni `GRAPH`, ni
   * `SNAPSHOT`. Il a été tué PENDANT la construction du graphe. Or la
   * publication au parent vivait APRÈS cette construction — elle n'est donc
   * jamais partie, et le parent a conclu « session métier=(aucune) » sur un
   * redémarrage qui appartenait bel et bien à une étape « Connexion au
   * serveur ».
   *
   * Le contexte part maintenant en PREMIER. Il ne coûte qu'un message, il n'a
   * besoin d'aucune lecture de fichier, et il est le seul élément dont le
   * parent a besoin pour rattacher correctement ce qui va suivre.
   *
   * Le graphe, lui, suit — et s'il n'arrive jamais, le parent gardera au moins
   * l'essentiel plutôt que rien.
   */
  const publie = direAuParent({
    type: 'SESSION_ARMED',
    sessionId: sessionActive.sessionId,
    etape, targetId, pid: process.pid, at: debut,
  });

  /**
   * ══ ET C'EST TOUT. L'ARMEMENT EST O(1) ══════════════════════════════════
   *
   * ── CE QUI SE TROUVAIT ICI, ET POURQUOI IL DEVAIT PARTIR ────────────────
   *
   *     construireGrapheCharge()   traversée statique : `readFileSync` sur
   *                                chaque source, pour en extraire les imports
   *     photographierGraphe()      relecture + hachage de chaque fichier projet
   *     racinesDeSurveillance()    `realpath` sur ~1200 entrées
   *     fs.watch × N               surveillances récursives posées à froid
   *
   * Soit, au clic « Suivant », plus de 1200 fichiers lus et hachés, et des
   * veilleurs créés au pire moment — juste avant l'opération qu'on observe.
   *
   * ── LE FAIT QUI A TRANCHÉ ───────────────────────────────────────────────
   *
   *     22:37:57.653  ARMED
   *     22:37:57.663  CHANGE  …/startupReconciliation.service.js   (+10 ms)
   *     22:37:57.797  CHANGE  …/integratedApiStartup.service.js    (+144 ms)
   *     22:37:59.258  Restarting 'src/server.js'
   *
   * Les deux fichiers n'ont JAMAIS changé : contenu, taille, mtime, ctime et
   * inode identiques, `LastWriteTime` une heure antérieure. Aucune écriture.
   * Mais les événements tombent dans la fenêtre exacte du balayage, et
   * `ARMED` est la dernière ligne que l'enfant ait écrite — il a été tué
   * PENDANT sa propre lecture.
   *
   * Cela ne démontre pas que le traceur explique les incidents ANTÉRIEURS à
   * son existence, et ce module ne le prétendra pas. Cela démontre qu'un
   * observateur qui déclenche 1200 lectures au clic modifie les conditions de
   * l'expérience — et un observateur qui perturbe ce qu'il mesure ne mesure
   * plus rien.
   *
   * ── CE QUI REND L'ATTRIBUTION POSSIBLE MALGRÉ CE RETRAIT ────────────────
   *
   * RIEN n'est perdu, parce que RIEN de tout cela n'appartenait à l'enfant :
   *
   *     le graphe          Node l'annonce au parent (`watch:require`/`import`)
   *     l'instantané       le parent le pose au démarrage de `npm run dev`
   *     les veilleurs      chauds depuis la même seconde, pas depuis le clic
   *     l'attribution      le parent survit au redémarrage, l'enfant non
   *
   * L'enfant ne reconstruit plus ce que le parent sait déjà. Il déclare son
   * contexte métier — la seule chose que le parent ne peut pas deviner — et
   * s'efface.
   */
  emettre('ARMED_O1', 'armement sans lecture : 0 fichier lu, 0 hachage, 0 veilleur posé '
    + '— le graphe, l’instantané et les veilleurs appartiennent au lanceur');

  /**
   * ON DIT CE QU'ON A FAIT, PAS CE QU'ON ESPÈRE.
   *
   * `process.send` existe sous `node --watch` MÊME SANS notre lanceur : le mode
   * surveillance en fournit un pour ses annonces internes. Un émetteur ne peut
   * donc pas savoir si quelqu'un l'écoute vraiment. Écrire « publié au
   * lanceur » serait affirmer plus que ce qui est établi — exactement le
   * travers qui a rendu les rapports précédents trompeurs. On nomme le geste ;
   * le journal du parent, lui, prouvera la réception.
   */
  emettre('PARENT', publie
    ? `contexte ÉMIS sur le canal IPC (session=${sessionActive.sessionId.slice(0, 8)}) — `
      + 'si `npm run dev` est en place, l’attribution d’un éventuel redémarrage '
      + 'se fera CÔTÉ PARENT, qui survit à l’événement'
    : 'aucun canal IPC (exécution directe) — l’attribution restera limitée à '
      + 'ce que cet enfant peut voir avant de mourir');

  /**
   * OBSERVATION DE LA FIN DU PROCESS.
   *
   * `exit` ne peut rien changer (aucun asynchrone n'y est possible) et
   * `uncaughtExceptionMonitor` est, par contrat Node, un observateur qui laisse
   * la terminaison se produire comme elle se serait produite.
   *
   * Leur SILENCE est un fait : un redémarrage du surveillant tue l'enfant par
   * signal, et `exit` ne se déclenche alors pas. Une trace interrompue SANS
   * ligne `PROCESS` désigne donc une mort par signal — pas un plantage.
   */
  sessionActive.surExit = (code) => {
    try { fs.appendFileSync(FICHIER_TRACE, `${JSON.stringify({ at: new Date().toISOString(), atMs: Date.now(), categorie: 'PROCESS', message: `exit code=${code}` })}\n`); } catch { /* rien */ }
  };
  sessionActive.surException = (err) => {
    emettre('PROCESS', `uncaughtException: ${caviarder(err?.message ?? String(err))}`);
  };
  process.on('exit', sessionActive.surExit);
  process.on('uncaughtExceptionMonitor', sessionActive.surException);

  sessionActive.minuteur = setTimeout(() => desarmerTrace('TIMEOUT'), FENETRE_MS);
  sessionActive.minuteur.unref?.();
  return sessionActive;
}

/*
 * `surChangement()` VIVAIT ICI — retiré avec les veilleurs qui l'appelaient.
 *
 * L'enfant ne surveille plus le systeme de fichiers : ses veilleurs naissaient
 * au clic, donc a froid, quelques millisecondes avant l'ecriture cherchee, et
 * mouraient avec lui. Ceux du lanceur observent depuis `npm run dev` et
 * survivent au redemarrage. Deux jeux de veilleurs pour une meme question, dont
 * un structurellement inferieur : on garde le bon.
 */

/** Note un appel HTTP pendant la fenêtre — chemin seul, jamais le corps. */
export function noterHttp(methode, chemin) {
  if (!sessionActive || sessionActive.clos) return;
  // La chaîne de requête peut porter un hôte : on garde les CLÉS, pas les valeurs.
  const [base, requete] = String(chemin).split('?');
  const cles = requete ? `?${requete.split('&').map((p) => p.split('=')[0]).join('&')}=…` : '';
  sessionActive.http.push({ at: Date.now(), methode, chemin: base });
  emettre('HTTP', `${methode} ${base}${cles} START`);
}

/** Note une étape de connexion SSH — hôte masqué, jamais de secret. */
export function noterSsh(evenement, { host = null, username = null, code = null } = {}) {
  if (!sessionActive || sessionActive.clos) return;
  emettre('SSH', `${evenement} host=${masquerHote(host)}`
    + `${username ? ` user=${username}` : ''}${code ? ` code=${code}` : ''}`);
}

/**
 * DEMANDE le désarmement — après un court répit.
 *
 * L'issue de la sonde SSH n'est pas la fin de l'histoire : le run réel s'est
 * interrompu JUSTE après elle. On laisse donc la surveillance vivre encore
 * `REPIT_APRES_ISSUE_MS`, puis on conclut. La raison est mémorisée dès
 * maintenant : c'est bien la sonde qui a terminé, même si le rapport sort deux
 * secondes plus tard.
 */
export function planifierDesarmement(raison = 'DONE') {
  const s = sessionActive;
  if (!s || s.clos || s.repit) return null;
  emettre('GRACE', `issue=${raison} — surveillance prolongée de ${REPIT_APRES_ISSUE_MS}ms`);
  s.repit = setTimeout(() => desarmerTrace(raison), REPIT_APRES_ISSUE_MS);
  s.repit.unref?.();
  return s.repit;
}

/**
 * DÉSARME ET CONCLUT — sans relire quoi que ce soit.
 *
 * ══ POURQUOI LE DIFF DE SECOURS A DISPARU ═══════════════════════════════════
 *
 * Il rephotographiait tout le graphe à la fermeture : une SECONDE rafale de
 * 1200 lectures, juste après l'opération observée. C'était le pendant exact du
 * balayage d'armement, avec le même défaut — un observateur qui agit sur ce
 * qu'il mesure.
 *
 * Et il n'apportait rien que le parent n'ait déjà : l'instantané de référence
 * est le sien, posé à froid au démarrage de `npm run dev`, et c'est LUI qui
 * compare après un redémarrage. L'enfant, lui, ne survit pas à l'événement —
 * un diff calculé par un process qui meurt n'a jamais été la bonne source.
 *
 * Ce qui reste ici est le CONTEXTE MÉTIER : l'étape, ses appels HTTP, ses
 * étapes SSH, son issue. C'est ce que le parent ne peut pas deviner, et c'est
 * tout ce que l'enfant a jamais été le mieux placé pour dire.
 */
export function desarmerTrace(raison = 'DONE') {
  if (!sessionActive || sessionActive.clos) return null;
  const s = sessionActive;
  s.clos = true;

  if (s.minuteur) clearTimeout(s.minuteur);
  if (s.repit) clearTimeout(s.repit);
  process.off('exit', s.surExit);
  process.off('uncaughtExceptionMonitor', s.surException);

  emettre('SUMMARY', `raison=${raison} durée=${Date.now() - s.debut}ms`
    + ` httpCalls=${s.http.length}`
    + ' — attribution d’un éventuel redémarrage : CÔTÉ LANCEUR (watch-parent.jsonl)');

  direAuParent({ type: 'SESSION_DISARMED', sessionId: s.sessionId, raison, at: Date.now() });

  try { fs.appendFileSync(FICHIER_TRACE, `${JSON.stringify({ at: new Date().toISOString(), atMs: Date.now(), categorie: 'CLOSED', raison })}\n`); } catch { /* rien */ }
  sessionActive = null;
  /**
   * `touches`/`candidat` restent dans le contrat, TOUJOURS VIDES.
   *
   * L'enfant n'attribue plus rien : il n'a ni instantané ni veilleur. Retirer
   * les champs casserait les appelants pour rien ; les rendre non vides serait
   * mentir. Le verdict vit dans `watch-parent.jsonl`.
   */
  return { touches: [], candidat: null, raison, evenements: [], http: s.http };
}

/* -------------------------------------------------------------------------- */
/*  REPRISE                                                                   */
/* -------------------------------------------------------------------------- */

/** Les lignes du journal parent, décodées. */
function lireJournalParent() {
  try {
    return fs.readFileSync(FICHIER_WATCH, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/** Les « Restarting » captés par le lanceur, dans la fenêtre demandée. */
function redemarragesDuParent(depuisMs) {
  return lireJournalParent().filter((l) => l.event === 'RESTARTING' && l.atMs >= depuisMs);
}

/**
 * Les mutations de dépendances observées autour d'un redémarrage.
 *
 * FENÊTRE LARGE À DESSEIN : la sentinelle échantillonne jusqu'à 500 ms après
 * l'événement, et l'événement lui-même précède le redémarrage. Une fenêtre
 * serrée laisserait le verdict hors du rapport qu'il explique.
 */
function mutationsDependances(autourDeMs, fenetre = 10_000) {
  return lireJournalParent().filter(
    (l) => l.event === 'NODE_MODULES_MUTATION' && Math.abs(l.atMs - autourDeMs) <= fenetre,
  );
}

/**
 * ══ L'ATTRIBUTION DU PARENT, RÉIMPRIMÉE DANS LA CONSOLE DE L'EXPLOITANT ════
 *
 * Le parent a fait le travail : il a vu « Restarting », comparé ses instantanés,
 * croisé deux sources d'événements et classé sa confiance. Mais il écrit dans un
 * fichier, et l'exploitant regarde la console du backend.
 *
 * Ce démarrage-ci va donc chercher le dernier verdict et le REJOUE. C'est ce qui
 * tient la promesse du lot : ne rien lancer, ne rien ouvrir, copier sa console.
 *
 * Rendue SÉPARÉMENT de la reprise de la session enfant, parce que les deux
 * répondent à des questions différentes — « qu'étais-je en train de faire » et
 * « qu'est-ce qui m'a tué ». Le V2 ne pouvait répondre qu'à la première.
 */
export function rejouerAttributionParent() {
  if (!estActivable()) return null;
  const lignes = lireJournalParent();
  const iVerdict = lignes.map((l) => l.event).lastIndexOf('WATCH_RESTART');
  if (iVerdict === -1) return null;
  /**
   * UN VERDICT DÉJÀ MONTRÉ NE SE REMONTRE PAS.
   *
   * Le serveur redémarre pour toutes sortes de raisons ordinaires — on édite du
   * code toute la journée. Réafficher le même verdict à chaque démarrage
   * noierait le seul qui compte, et donnerait à un incident d'hier l'apparence
   * d'un incident d'aujourd'hui.
   */
  if (lignes.map((l) => l.event).lastIndexOf('WATCH_RESTART_REPLAYED') > iVerdict) return null;
  const dernier = lignes[iVerdict];

  const dire = (m) => console.log(`[DEPLOY-FORENSICS][PARENT] ${m}`); // eslint-disable-line no-console
  // eslint-disable-next-line no-console
  console.log('\n[DEPLOY-FORENSICS][PARENT] ATTRIBUTION DU REDÉMARRAGE — établie par le '
    + 'lanceur, qui a survécu à l’événement :');

  dire(`WATCH_RESTART at=${dernier.at.slice(11, 23)} cible=${dernier.cible ?? '?'}`
    + ` childOld=${dernier.childOld ?? '?'} childNew=${process.pid}`
    + ` generation=${dernier.childGeneration ?? '?'}`);
  dire(`portée surveillée par Node : ${
    Array.isArray(dernier.watchScope) ? dernier.watchScope.join(', ') : (dernier.watchScope ?? '?')
  } — ${dernier.watchedFiles ?? '?'} fichier(s) susceptible(s) de relancer`
    + `${dernier.loadedFiles ? ` (sur ${dernier.loadedFiles} chargés)` : ''}`
    + ` | session métier=${dernier.connectionForensicsEtape ?? '(aucune)'}`
    + `${dernier.connectionForensicsSessionId ? ` (${String(dernier.connectionForensicsSessionId).slice(0, 8)})` : ''}`);

  const evenements = [...(dernier.eventsBefore ?? []), ...(dernier.eventsAfter ?? [])];
  const surveilles = evenements.filter((e) => e.surveille);
  dire(`FS_EVENTS=${evenements.length} (dont ${surveilles.length} sur un fichier surveillé)`
    + `${dernier.fsEventsOverflow ? ' ⚠ DÉBORDEMENT du tampon : des événements ont pu être perdus' : ''}`);
  for (const e of surveilles.slice(-12)) {
    dire(`  [${e.source}] ${e.type} ${e.path} zone=${e.zone}`
      + ` deltaMs=${dernier.atMs - e.at}`);
  }

  dire(`GRAPH_DIFF=${(dernier.graphDiff ?? []).length}`);
  for (const d of dernier.graphDiff ?? []) {
    dire(`  path=${d.path}`);
    dire(`    realpath=${d.realpath} zone=${d.zone} cause=${d.cause}`);
    dire(`    mtimeBefore=${d.mtimeBefore} mtimeAfter=${d.mtimeAfter}`);
    dire(`    sizeBefore=${d.sizeBefore} sizeAfter=${d.sizeAfter}`);
    dire(`    hashBefore=${d.hashBefore ?? '(non haché)'} hashAfter=${d.hashAfter ?? '(non haché)'}`);
  }

  for (const [fenetre, ecarts] of Object.entries(dernier.diffsParFenetre ?? {})) {
    dire(`  fenêtre ${fenetre} : ${ecarts.length ? ecarts.join(', ') : 'aucun écart'}`);
  }

  const procs = dernier.processusRecents ?? [];
  dire(`PROCESS=${procs.length}${procs.length ? '' : ' (aucun npm/node/git/éditeur/antivirus né dans la fenêtre ±2s)'}`);
  for (const p of procs) dire(`  ${p.nom} pid=${p.pid} ppid=${p.ppid} deltaMs=${dernier.atMs - p.at}`);

  /**
   * ══ LA SENTINELLE `node_modules` — LE VERDICT SUR LE CONTENU ═════════════
   *
   * Elle répond à la question que l'incident `ssh2` a laissée ouverte : le
   * fichier a-t-il RÉELLEMENT changé, ou seulement été touché ? Échantillonnée
   * à l'instant de l'événement puis à +5/+20/+50/+100/+500 ms, elle distingue
   * un contenu modifié, un aller-retour, et un simple accès.
   */
  for (const m of mutationsDependances(dernier.atMs)) {
    dire(`[NODE_MODULES_MUTATION] package=${m.package} file=${m.file}`);
    dire(`  verdict=${m.verdict}`);
    dire(`  hashBefore=${m.hashBefore ? m.hashBefore.slice(0, 16) : '(inconnu)'}`
      + ` hashDuring=${m.hashDuring ? m.hashDuring.slice(0, 16) : '(aucun écart)'}`
      + ` hashAfter=${m.hashAfter ? m.hashAfter.slice(0, 16) : '(illisible)'}`);
    dire(`  contentChanged=${m.contentChanged} restored=${m.restored} metadataOnly=${m.metadataOnly}`);
    for (const e of m.echantillons ?? []) {
      dire(`   +${String(e.at).padStart(3)}ms sha=${e.sha ?? '—'} mtime=${e.mtimeMs} ctime=${e.ctimeMs} size=${e.size}`);
    }
    dire(`  externalWriterSuspected=${m.externalWriterSuspected}`);
  }

  // eslint-disable-next-line no-console
  console.log('[DEPLOY-FORENSICS][PARENT][SUMMARY] '
    + 'NODE_RESTART=true '
    + `FS_EVENTS=${evenements.length} `
    + `GRAPH_DIFF=${(dernier.graphDiff ?? []).length} `
    + `likelyTrigger=${dernier.likelyTrigger ?? '(aucun)'} `
    + `confidence=${dernier.confidence ?? 'NONE'} `
    + `classification=${dernier.classification ?? 'UNKNOWN'} `
    + `WRITER=${dernier.writer ?? 'UNKNOWN_EXTERNAL'} `
    + `writerConfidence=${dernier.writerConfidence ?? 'NONE'}`
    + `${(dernier.writerEvidence ?? []).length ? ` — ${dernier.writerEvidence.join('; ')}` : ''}\n`);

  /**
   * ON NE RÉIMPRIME PAS EN BOUCLE. Le verdict est marqué consommé : un
   * redémarrage suivant écrira le sien, et c'est celui-là qu'on montrera.
   */
  try {
    fs.appendFileSync(FICHIER_WATCH, `${JSON.stringify({
      at: new Date().toISOString(), atMs: Date.now(), event: 'WATCH_RESTART_REPLAYED',
      source: 'child', pid: process.pid,
    })}\n`);
  } catch { /* rien */ }

  return dernier;
}

/**
 * ══ LA MOITIÉ DE LA TRACE QUI SURVIT AU REDÉMARRAGE ════════════════════════
 *
 * Si le process meurt pendant l'observation, la mémoire part avec lui — or
 * c'est EXACTEMENT le cas qu'on cherche à comprendre. Le démarrage suivant
 * relit donc le fichier, et réimprime ce qui a précédé la coupure. L'exploitant
 * n'ouvre aucun fichier : tout revient dans sa console.
 *
 * ── CE QUE LA V2 AJOUTE ICI ────────────────────────────────────────────────
 *
 * La corrélation avec le journal du PARENT. Le message « Restarting » n'existe
 * que dans la sortie du surveillant, que l'enfant ne peut pas lire : sans le
 * lanceur, la V1 ne pouvait qu'INFÉRER un redémarrage d'une session
 * interrompue — sans distinguer un redémarrage de surveillance d'un plantage
 * ou d'un `kill`. Avec lui, on horodate l'événement et l'on mesure, pour chaque
 * écriture observée, le délai qui l'en sépare.
 */
export function rejouerTraceInterrompue() {
  if (!estActivable()) return null;
  let brut;
  try { brut = fs.readFileSync(FICHIER_TRACE, 'utf8'); } catch { return null; }

  const lignes = brut.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  if (!lignes.length) return null;

  // Une session close a déjà tout dit : on ne réimprime que l'interrompue.
  const derniereClose = lignes.map((l) => l.categorie).lastIndexOf('CLOSED');
  const dernierArme = lignes.map((l) => l.categorie).lastIndexOf('ARMED');
  if (dernierArme === -1 || dernierArme < derniereClose) return null;

  const session = lignes.slice(dernierArme);
  const debutMs = session[0].atMs ?? new Date(session[0].at).getTime();
  const age = Date.now() - debutMs;
  if (age > RECUPERATION_MAX_MS) return null;

  const dire = (m) => console.log(`[DEPLOY-FORENSICS][RECOVERY] ${m}`); // eslint-disable-line no-console

  // eslint-disable-next-line no-console
  console.log('\n[DEPLOY-FORENSICS][RECOVERY] la session de diagnostic précédente a été '
    + 'INTERROMPUE. Voici ce qui l’a précédée :');
  for (const l of session) dire(`${l.at.slice(11, 23)} ${l.categorie} ${l.message ?? ''}`);

  /* ── EST-CE BIEN UN REDÉMARRAGE, ET NON UNE SECONDE INSTANCE ? ──────────── */
  /**
   * ══ CE QUE LES PID PROUVENT, ET QUE RIEN D'AUTRE NE PROUVE ════════════════
   *
   * Sous `node --watch`, le PARENT survit et remplace l'ENFANT : le `ppid` est
   * donc STABLE d'une session à l'autre, seul le `pid` change. Deux autres
   * scénarios produiraient la même impression d'« interruption » et appellent
   * des enquêtes entièrement différentes :
   *
   *   ppid CHANGÉ    ce n'est pas le surveillant qui a relancé — quelqu'un
   *                  d'autre a lancé un second serveur (script, IDE, terminal
   *                  resté ouvert). Chercher un fichier coupable serait perdre
   *                  son temps : il n'y en a pas.
   *   pid IDENTIQUE  le process n'est jamais mort ; la trace a été interrompue
   *                  pour une autre raison.
   */
  const armement = session[0] ?? {};
  const ancienPid = armement.pid ?? null;
  const ancienPpid = armement.ppid ?? null;
  dire(`PID oldChild=${ancienPid ?? '?'} newChild=${process.pid}`
    + ` | watcher(ppid) old=${ancienPpid ?? '?'} new=${process.ppid}`
    + ` → ${ancienPpid && ancienPpid !== process.ppid
      ? 'SURVEILLANT DIFFÉRENT : ce n’est pas un redémarrage de `--watch`, c’est une seconde instance'
      : ancienPid === process.pid
        ? 'MÊME process : la trace a été interrompue sans mort du serveur'
        : 'même surveillant, enfant remplacé — signature d’un redémarrage `--watch`'}`);

  /* ── LE PARENT A-T-IL DIT « Restarting » ? ──────────────────────────────── */
  const redemarrages = redemarragesDuParent(debutMs);
  const restart = redemarrages[0] ?? null;
  const mortParSignal = !session.some((l) => l.categorie === 'PROCESS' && /exit code=/.test(l.message ?? ''));

  if (restart) {
    dire(`WATCH_EVENT=RESTARTING at=${new Date(restart.atMs).toISOString().slice(11, 23)}`
      + ` (source=${restart.source ?? 'parent'} pidParent=${restart.pid ?? '?'})`);
  } else {
    dire('WATCH_EVENT=(non observé) — le lanceur `npm run dev` n’était pas en place, '
      + 'ou l’interruption n’est pas un redémarrage de surveillance.');
    dire(`indice: le process ${mortParSignal ? 'n’a PAS exécuté ses gestionnaires `exit` → mort par SIGNAL '
      + '(cohérent avec un redémarrage de `node --watch`)' : 'est sorti normalement (exit) → ce n’est PAS un redémarrage de surveillance'}`);
  }

  /**
   * ══ L'ATTRIBUTION N'EST PLUS ICI, ET LE RAPPORT LE DIT ═══════════════════
   *
   * Cette reprise énumérait les `GRAPH_CHANGE` que l'enfant avait observés
   * lui-même. Il n'en observe plus : il n'a ni instantané ni veilleur, et c'est
   * délibéré — les siens naissaient au clic, donc trop tard, et mouraient avec
   * lui, donc trop tôt.
   *
   * Ce bloc ne rend donc plus un verdict : il rend le CONTEXTE (l'étape, ses
   * appels) et RENVOIE au verdict du lanceur, qui suit immédiatement dans la
   * console via `rejouerAttributionParent()`. Un rapport qui annoncerait
   * « likelyTrigger=(aucun) » alors qu'il n'a simplement rien cherché serait
   * pire que muet.
   */
  // eslint-disable-next-line no-console
  console.log('[DEPLOY-FORENSICS][RECOVERY][SUMMARY] '
    + `restartDetected=${restart ? 'true(observé par le lanceur)' : 'true(inféré)'} `
    + 'attribution=CÔTÉ LANCEUR — voir [PARENT] ci-dessous '
    + '(cet enfant n’observe plus le système de fichiers : armement O(1))\n');

  try { fs.appendFileSync(FICHIER_TRACE, `${JSON.stringify({ at: new Date().toISOString(), atMs: Date.now(), categorie: 'CLOSED', raison: 'RECOVERED' })}\n`); } catch { /* rien */ }
  return { candidat: null, changements: [], restart };
}

/** Test uniquement : chemin du journal de reprise. */
export const cheminTrace = FICHIER_TRACE;
/** Test uniquement : y a-t-il une session armée ? */
export const estArmee = () => Boolean(sessionActive && !sessionActive.clos);
/**
 * Test uniquement : ce que la session porte encore.
 *
 * Ni graphe, ni racines, ni photos : l'enfant n'en construit plus. Ce qui reste
 * est le contexte métier, et c'est exactement ce que le lanceur ne peut pas
 * deviner.
 */
export const inspecterSession = () => (sessionActive ? {
  sessionId: sessionActive.sessionId,
  etape: sessionActive.etape,
  http: sessionActive.http,
} : null);

export default {
  estActivable, armerTraceConnexion, noterHttp, noterSsh,
  desarmerTrace, planifierDesarmement, rejouerTraceInterrompue,
  rejouerAttributionParent,
  caviarder, cheminTrace, estArmee, inspecterSession,
  SRC, REPO,
};
