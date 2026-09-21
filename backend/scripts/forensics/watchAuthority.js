/**
 * ══ L'AUTORITÉ FORENSIQUE CÔTÉ PARENT (V3) ═════════════════════════════════
 *
 * ── POURQUOI L'ATTRIBUTION DÉMÉNAGE ICI ────────────────────────────────────
 *
 * Le V2 a produit la preuve qui invalide sa propre architecture :
 *
 *     oldChild=38092  newChild=33532  ppid inchangé=40424
 *     WATCH_EVENT=RESTARTING at=16:17:20.863
 *     filesChanged=0  filesTouched=0  likelyTrigger=(aucun)
 *
 * Le redémarrage est RÉEL, le surveillant de Node l'a déclenché, et
 * l'instrumentation ENFANT n'a rien vu. Ce n'est pas un défaut de réglage :
 * c'est une limite structurelle. L'enfant :
 *
 *   · n'existe que depuis le clic — ses veilleurs `fs.watch` sont posés
 *     quelques millisecondes avant l'écriture qu'on cherche, et sur Windows la
 *     mise en place d'une surveillance récursive n'est pas instantanée ;
 *   · MEURT au moment précis où l'information devient disponible ;
 *   · ne voit jamais « Restarting », qui est imprimé par son parent.
 *
 * Le parent, lui, vit depuis `npm run dev` — des minutes ou des heures. Ses
 * veilleurs sont chauds, son instantané est établi, et il survit à l'événement.
 *
 *     PARENT  autorité du REDÉMARRAGE et de son attribution
 *     ENFANT  contexte MÉTIER (HTTP, SSH, DNS, run)
 *
 * Les deux ne se mélangent pas, et ce module ne connaît rien du métier.
 *
 * ── L'ENSEMBLE SURVEILLÉ N'EST PLUS DÉDUIT : NODE LE DIT ───────────────────
 *
 * MESURE décisive : en ajoutant un canal `ipc` au `stdio` du surveillant — sans
 * toucher à la ligne de commande — on reçoit les notifications INTERNES que le
 * chargeur envoie au mode `--watch` :
 *
 *     { 'watch:import': ['file:///…/src/server.js'] }
 *     { 'watch:require': ['…/node_modules/charge/index.js'] }
 *
 * Vérifié sur banc : couverture complète (src, hors src, hors backend,
 * `node_modules`, imports dynamiques tardifs), et AUCUN fichier non chargé.
 * Le V2 devait reconstruire ce graphe par trois heuristiques ; le V3 le reçoit
 * de l'autorité elle-même.
 *
 * Le canal ne change RIEN pour le processus observé : mesuré, le serveur avait
 * DÉJÀ `process.send` avant qu'on l'ajoute — le mode `--watch` lui en donne un.
 * Seule notre extrémité du tuyau change.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND = path.resolve(ICI, '../..');
export const SRC = path.join(BACKEND, 'src');
export const REPO = path.resolve(BACKEND, '..');
const DOSSIER = path.join(BACKEND, 'logs', 'deployment-forensics');

/**
 * LES TROIS INSTANTANÉS QUI SUIVENT LE REDÉMARRAGE.
 *
 * À T0, l'écriture a déjà eu lieu (le surveillant temporise avant de relancer).
 * Les suivants attrapent l'écrivain lent — et surtout, comparés entre eux, ils
 * distinguent une modification PERSISTANTE d'une modification RESTAURÉE : si le
 * fichier est revenu à son état d'origine à T+500, c'est un aller-retour, et
 * c'est une information sur l'outil, pas un doute sur le fait.
 */
const RETARDS_MS = [50, 150, 500];

/** Au-delà, un fichier de `node_modules` n'est plus haché : voir `PLAFOND`. */
const PLAFOND_EMPREINTES_NM = 1500;

const maintenant = () => Date.now();

export const chemineRelatif = (absolu) => {
  const rel = path.relative(REPO, absolu);
  return (rel.startsWith('..') ? absolu : rel).replace(/\\/g, '/');
};

const cheminReel = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };

const ZONE = (p) => {
  const n = path.normalize(p);
  if (n.includes(`${path.sep}node_modules${path.sep}`)) return 'node_modules';
  if (n.startsWith(SRC + path.sep)) return 'backend/src';
  if (n.startsWith(BACKEND + path.sep)) return 'backend/*';
  if (n.startsWith(REPO + path.sep)) return 'repo/*';
  return 'external';
};

/* -------------------------------------------------------------------------- */
/*  PHOTOGRAPHIE                                                              */
/* -------------------------------------------------------------------------- */

/**
 * L'EMPREINTE — obligatoire hors `node_modules`, raisonnée à l'intérieur.
 *
 * Le lot exige le hachage pour tout ce qui n'est pas `node_modules`, et une
 * « stratégie raisonnable » à l'intérieur. La stratégie est : on ne hache QUE
 * les fichiers que Node a annoncés comme chargés. C'est déjà le seul
 * sous-ensemble capable de provoquer un redémarrage, et il est mille fois plus
 * petit que l'arbre complet.
 */
function photographier(absolu, { hacher }) {
  try {
    const st = fs.statSync(absolu);
    return {
      mtimeMs: Math.round(st.mtimeMs),
      /**
       * ══ `ctime` — LE TÉMOIN QUI MANQUAIT AU V3 ═══════════════════════════
       *
       * Le V3 comparait contenu + taille + date + inode. L'incident `ssh2` a
       * produit un redémarrage RÉEL avec `GRAPH_DIFF=0` sur ces quatre
       * dimensions — donc quelque chose avait bougé que rien ne mesurait.
       *
       * MESURE : `ctime` est l'horodatage des MÉTADONNÉES, et il est le seul à
       * bouger dans les deux cas qui produisent exactement cette signature :
       *
       *     changement d'ATTRIBUT seul        mtime — , ctime CHG   → relance
       *     écriture puis RESTAURATION        mtime — , ctime CHG   → relance
       *     (avec mtime remis à l'identique)
       *     lecture pure                      ctime — , atime chg   → ne relance PAS
       *
       * Sans lui, ces deux écritures sont indétectables après coup. Avec lui,
       * elles se nomment.
       */
      ctimeMs: Math.round(st.ctimeMs),
      size: st.size,
      ino: st.ino !== undefined && st.ino !== null ? String(st.ino) : null,
      /** Sous Windows, `mode` porte le bit lecture-seule — un attribut visible. */
      mode: st.mode,
      hash: hacher
        ? crypto.createHash('sha1').update(fs.readFileSync(absolu)).digest('hex').slice(0, 16)
        : null,
    };
  } catch { return null; }
}

function comparer(avant, apres) {
  if (!avant && !apres) return null;
  if (!avant) return 'ADDED';
  if (!apres) return 'REMOVED';
  const causes = [];
  if (avant.hash && apres.hash && avant.hash !== apres.hash) causes.push('contenu');
  if (avant.size !== apres.size) causes.push('taille');
  if (avant.mtimeMs !== apres.mtimeMs) causes.push('date');
  if (avant.ino && apres.ino && avant.ino !== apres.ino) causes.push('inode');
  if (avant.mode !== apres.mode) causes.push('droits');
  /**
   * `métadonnées` EN DERNIER, ET SEUL S'IL EST SEUL.
   *
   * Un `ctime` qui bouge accompagne toute écriture : le mentionner à chaque
   * fois noierait la cause réelle. Il n'apporte une information NOUVELLE que
   * lorsqu'il est le SEUL à avoir bougé — et c'est précisément le cas de
   * l'incident `ssh2`.
   */
  if (!causes.length && avant.ctimeMs !== apres.ctimeMs) causes.push('métadonnées(ctime)');
  return causes.length ? causes.join('+') : null;
}

/* -------------------------------------------------------------------------- */
/*  L'AUTORITÉ                                                                */
/* -------------------------------------------------------------------------- */

export class WatchAuthority {
  constructor({ journal, dossier = DOSSIER } = {}) {
    this.dossier = dossier;
    this.journal = journal ?? path.join(dossier, 'watch-parent.jsonl');

    this.watchSessionId = crypto.randomUUID();
    this.parentPid = process.pid;
    this.currentChildPid = null;
    this.childGeneration = 0;
    this.lastRestartAt = null;

    /**
     * L'UNION DES GÉNÉRATIONS — et c'est une nécessité, pas une commodité.
     *
     * Un module chargé par la génération N peut être réécrit AVANT que la
     * génération N+1 n'ait fini de republier son graphe. Remettre l'ensemble à
     * zéro à chaque redémarrage créerait une fenêtre aveugle exactement au
     * moment où l'on observe — et cette fenêtre s'ouvrirait à chaque incident.
     */
    this.unionSurveillee = new Map(); // realpath → { path, zone, sources:Set, generations:Set }
    this.instantane = new Map();      // realpath → photo

    this.evenementsFs = [];           // source B — fs.watch (parent) + FileSystemWatcher
    this.processus = [];              // §12 — naissances de npm/node/git
    this.veilleurs = [];
    this.helpers = [];
    this.sessionMetier = null;        // §3 — la session CONNECTION_SERVER de l'enfant
    this.debordement = false;

    /** Sentinelle `node_modules` : références SHA-256 et `ctime` par fichier. */
    this.shaReference = new Map();
    this.ctimeReference = new Map();
    this.sondesEnCours = new Set();
    /** Outils Windows d'identification d'écrivain, détectés au lancement (§4). */
    this.outils = { handle: null, procmon: null, openfiles: false };

    /**
     * ══ LA PORTÉE RÉELLEMENT SURVEILLÉE PAR NODE ═════════════════════════════
     *
     * `null` = tout le graphe chargé (comportement de `--watch`).
     * Un tableau de racines = `--watch-path`, et Node NE REGARDE QUE cela.
     *
     * Cette distinction n'est pas cosmétique. Node continue d'annoncer chaque
     * module chargé par `watch:require` / `watch:import` — y compris ceux de
     * `node_modules` — même quand `--watch-path` lui interdit d'y réagir. Sans
     * cette borne, l'autorité collectionnerait 1400 fichiers « surveillés »
     * dont 900 ne peuvent plus rien déclencher, et désignerait un jour l'un
     * d'eux comme déclencheur d'un redémarrage qu'il était incapable de causer.
     */
    this.portee = null;
  }

  /** Déclare ce que Node surveille vraiment. `null` = tout le graphe. */
  definirPortee(racines) {
    this.portee = Array.isArray(racines) && racines.length ? racines.map((r) => path.normalize(r)) : null;
    this.noter('WATCH_SCOPE', {
      mode: this.portee ? '--watch-path' : '--watch (graphe complet)',
      racines: this.portee ? this.portee.map(chemineRelatif) : null,
      /**
       * Ce que cela CHANGE, dit une fois : un lecteur du journal doit pouvoir
       * comprendre pourquoi `node_modules` a cessé d'apparaître dans les
       * verdicts, sans avoir à relire ce code.
       */
      consequence: this.portee
        ? 'une écriture dans node_modules ne peut plus relancer le serveur'
        : 'tout module chargé peut relancer le serveur',
    });
    /** Les entrées déjà connues sont reclassées : la portée peut arriver après. */
    for (const [reel, info] of this.unionSurveillee) info.dansPortee = this.estDansPortee(reel);
    return this.portee;
  }

  /** Ce chemin peut-il réellement provoquer un redémarrage ? */
  estDansPortee(reel) {
    if (!this.portee) return true;
    const n = path.normalize(reel);
    return this.portee.some((r) => n === r || n.startsWith(r + path.sep));
  }

  /**
   * ══ QUEL OUTIL WINDOWS PEUT NOMMER L'ÉCRIVAIN ? (§4) ═════════════════════
   *
   * On CHERCHE, on n'exige rien, et l'on ne demande RIEN à l'exploitant. Si
   * `handle.exe` ou Process Monitor sont déjà installés, le lanceur s'en sert
   * pendant la fenêtre forensique ; sinon on le DIT, et l'on se rabat sur la
   * corrélation de processus (§5), qui est plus faible mais toujours honnête.
   *
   * Le résultat de cette détection est journalisé au démarrage : un rapport qui
   * conclut « écrivain inconnu » doit permettre de savoir POURQUOI il l'est.
   */
  detecterOutils() {
    const trouver = (nom) => {
      try {
        const sortie = spawnSync('where', [nom], { encoding: 'utf8' });
        const ligne = String(sortie.stdout ?? '').split(/\r?\n/).find((l) => l.trim());
        return ligne ? ligne.trim() : null;
      } catch { return null; }
    };
    this.outils = {
      handle: trouver('handle.exe') ?? trouver('handle64.exe'),
      procmon: trouver('procmon.exe') ?? trouver('Procmon64.exe'),
      /**
       * `openfiles.exe` existe TOUJOURS sous Windows, mais n'énumère rien tant
       * que l'indicateur global « maintain objects list » n'est pas activé — ce
       * qui exige l'élévation ET un redémarrage. Le noter comme disponible
       * serait promettre une capacité qu'on n'a pas.
       */
      openfiles: false,
    };
    this.noter('WRITER_TOOLING', {
      handle: this.outils.handle,
      procmon: this.outils.procmon,
      openfilesUsable: this.outils.openfiles,
      /** Mesuré sur ce poste : USN et Win32_ProcessStartTrace exigent l'élévation. */
      usnJournal: 'ACCESS_DENIED_SANS_ELEVATION',
      processStartTrace: 'ACCESS_DENIED_SANS_ELEVATION',
      repli: 'corrélation de processus ±2s (§5)',
    });
    return this.outils;
  }

  noter(event, extra = {}) {
    const at = new Date();
    try {
      fs.mkdirSync(this.dossier, { recursive: true });
      fs.appendFileSync(this.journal, `${JSON.stringify({
        at: at.toISOString(), atMs: at.getTime(), event, source: 'watch-parent',
        watchSessionId: this.watchSessionId, pid: this.parentPid, ...extra,
      })}\n`);
    } catch { /* un journal qui échoue ne casse jamais le développement */ }
  }

  /* ── L'ENSEMBLE SURVEILLÉ, DIT PAR NODE ────────────────────────────────── */

  /**
   * ENREGISTRE une annonce `watch:require` / `watch:import` du chargeur.
   *
   * C'est la source A du graphe : l'autorité elle-même. On la complète — jamais
   * on ne la remplace — par ce que l'enfant publie (S1/S2/S3), qui apporte les
   * fichiers chargés avant que notre canal ne soit prêt.
   */
  annoncerCharge(chemins, source = 'node-watch-ipc') {
    let nouveaux = 0;
    for (const brut of chemins) {
      if (typeof brut !== 'string' || !brut) continue;
      let absolu;
      try { absolu = brut.startsWith('file:') ? fileURLToPath(brut) : brut; } catch { continue; }
      if (!path.isAbsolute(absolu)) continue; // `node:module` & consorts
      const reel = cheminReel(absolu);
      const existant = this.unionSurveillee.get(reel);
      if (existant) {
        existant.sources.add(source);
        existant.generations.add(this.childGeneration);
        continue;
      }
      this.unionSurveillee.set(reel, {
        path: chemineRelatif(absolu),
        realpath: chemineRelatif(reel),
        zone: ZONE(reel),
        sources: new Set([source]),
        generations: new Set([this.childGeneration]),
        /** Node l'annonce comme chargé — mais le surveille-t-il vraiment ? */
        dansPortee: this.estDansPortee(reel),
      });
      nouveaux += 1;
      /**
       * ON NE PHOTOGRAPHIE QUE CE QUI PEUT DÉCLENCHER.
       *
       * Hacher 900 fichiers de `node_modules` que Node ne regarde plus serait
       * payer le coût d'une surveillance qui n'existe pas.
       */
      if (this.estDansPortee(reel)) this.photographierUn(reel);
    }
    return nouveaux;
  }

  photographierUn(reel) {
    const info = this.unionSurveillee.get(reel);
    if (!info) return;
    const hacher = info.zone !== 'node_modules'
      || this.instantane.size < PLAFOND_EMPREINTES_NM;
    const photo = photographier(reel, { hacher });
    if (photo) this.instantane.set(reel, photo);
  }

  /**
   * L'INSTANTANÉ DE DÉPART — posé AVANT toute génération d'enfant.
   *
   * Le lot insiste : ne pas se limiter au graphe rapporté par l'enfant pour
   * cette première photographie. On prend donc `backend/src` en entier. C'est
   * un sur-ensemble volontaire : ces fichiers ne seront JAMAIS accusés s'ils ne
   * sont pas dans l'ensemble surveillé, mais leur photo existe si la question
   * se pose — et elle existe dès la première seconde, pas au premier clic.
   */
  instantaneInitial() {
    let n = 0;
    const parcourir = (d) => {
      let entrees;
      try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { parcourir(p); continue; }
        const reel = cheminReel(p);
        if (this.instantane.has(reel)) continue;
        const photo = photographier(reel, { hacher: true });
        if (photo) { this.instantane.set(reel, photo); n += 1; }
        /**
         * ══ SOUS `--watch-path`, LA PORTÉE EST LA SEULE SOURCE DU GRAPHE ═════
         *
         * MESURE : avec `--watch-path`, Node CESSE d'émettre ses annonces
         * `watch:require` / `watch:import` — le canal IPC devient muet, et
         * `loadedFiles` tombe à 0.
         *
         * Or c'est cette union qui filtre les événements : sans elle, chaque
         * écriture serait marquée « hors graphe », l'attribution retomberait à
         * `confidence=NONE`, et le lot précédent perdrait toute sa puissance —
         * exactement ce que §9 interdit dans l'autre sens.
         *
         * La portée devient donc elle-même le graphe : tout fichier sous
         * `--watch-path` PEUT relancer le serveur, qu'il soit chargé ou non
         * (mesuré : un fichier neuf sous `src` relance). C'est une définition
         * plus juste que « chargé », et elle vient de la même autorité que le
         * redémarrage.
         */
        if (this.portee && !this.unionSurveillee.has(reel)) {
          this.unionSurveillee.set(reel, {
            path: chemineRelatif(p),
            realpath: chemineRelatif(reel),
            zone: ZONE(reel),
            sources: new Set(['watch-scope']),
            generations: new Set([this.childGeneration]),
            dansPortee: true,
          });
        }
      }
    };
    for (const racine of this.portee ?? [SRC]) parcourir(racine);
    return n;
  }

  /* ── SOURCE B — LES ÉVÉNEMENTS FICHIER ─────────────────────────────────── */

  ajouterEvenement(source, type, absolu) {
    const reel = cheminReel(absolu);
    const connu = this.unionSurveillee.get(reel);
    const evenement = {
      at: maintenant(),
      source,
      type,
      path: chemineRelatif(absolu),
      realpath: chemineRelatif(reel),
      zone: ZONE(reel),
      /**
       * « SURVEILLÉ » SIGNIFIE « PEUT DÉCLENCHER », pas « est chargé ».
       *
       * Un module de `node_modules` reste dans le graphe annoncé par Node, mais
       * sous `--watch-path=./src` il ne peut plus rien relancer. Le compter
       * comme surveillé rouvrirait exactement les faux positifs `ssh2` et
       * `iconv-lite` que ce lot supprime.
       */
      surveille: Boolean(connu) && Boolean(connu.dansPortee),
      /** Chargé mais hors portée : l'information reste, sans accuser. */
      chargeHorsPortee: Boolean(connu) && !connu.dansPortee,
    };
    this.evenementsFs.push(evenement);
    if (this.evenementsFs.length > 5000) this.evenementsFs.splice(0, 2500);

    /**
     * UNE DÉPENDANCE QUI BOUGE MÉRITE UNE ENQUÊTE IMMÉDIATE, PAS UN DIFF DIFFÉRÉ.
     *
     * L'incident `ssh2` a montré la limite : au moment où le V3 comparait ses
     * instantanés, l'écriture était déjà annulée. On échantillonne donc CE
     * fichier tout de suite, et plusieurs fois de suite.
     */
    if (connu && connu.dansPortee && evenement.zone === 'node_modules') {
      void this.sonderDependance(reel, evenement);
    }
    return evenement;
  }

  /**
   * ══ LA SENTINELLE `node_modules` (§2, §3, §10) ═══════════════════════════
   *
   * ── CE QU'ELLE RÉPOND, ET QUE RIEN D'AUTRE NE PEUT RÉPONDRE ───────────────
   *
   * Le fichier a-t-il RÉELLEMENT changé de contenu, ou a-t-il seulement été
   * touché ? Le diff différé du V3 ne pouvait pas trancher : quand il regardait,
   * l'état final était redevenu identique. La question restait ouverte, et une
   * question ouverte sur un fichier de `node_modules` finit toujours par être
   * répondue au hasard.
   *
   * On échantillonne donc DÈS l'événement, puis à +5, +20, +50, +100 et +500 ms.
   * Un aller-retour rapide laisse alors une trace : au moins un échantillon
   * tombe pendant la modification.
   *
   * ── SHA-256, ET SEULEMENT ICI ────────────────────────────────────────────
   *
   * Le reste du diagnostic se contente d'une empreinte courte : il compare des
   * milliers de fichiers et n'a besoin que de détecter une différence. Ici on
   * ARBITRE une accusation, sur UN fichier — l'empreinte doit être hors de
   * discussion.
   *
   * ── AUCUN CONTENU N'EST JOURNALISÉ ───────────────────────────────────────
   *
   * Des empreintes, des tailles, des horodatages. Jamais un octet du fichier :
   * une dépendance peut contenir des clés de test, des fixtures, des exemples.
   */
  async sonderDependance(reel, evenement) {
    if (this.sondesEnCours.has(reel)) return;
    this.sondesEnCours.add(reel);

    const sha = (p) => {
      try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
      catch { return null; }
    };
    const echantillon = (etiquette) => {
      const st = photographier(reel, { hacher: false });
      return {
        at: etiquette,
        sha256: sha(reel),
        mtimeMs: st?.mtimeMs ?? null,
        ctimeMs: st?.ctimeMs ?? null,
        size: st?.size ?? null,
        ino: st?.ino ?? null,
        mode: st?.mode ?? null,
      };
    };

    /** La référence : ce que le lanceur avait photographié AVANT tout événement. */
    const reference = this.shaReference.get(reel) ?? null;
    const echantillons = [echantillon(0)];
    for (const retard of [5, 20, 50, 100, 500]) {
      await new Promise((r) => { setTimeout(r, retard === 5 ? 5 : retard - echantillons.at(-1).at); });
      echantillons.push(echantillon(retard));
    }

    const empreintes = new Set(echantillons.map((e) => e.sha256).filter(Boolean));
    const contenuADiverge = reference
      ? echantillons.some((e) => e.sha256 && e.sha256 !== reference)
      : empreintes.size > 1;
    const revenu = reference
      ? echantillons.at(-1).sha256 === reference
      : false;
    const metaSeule = !contenuADiverge
      && echantillons.some((e) => e.ctimeMs !== echantillons[0].ctimeMs)
      || (!contenuADiverge && this.ctimeReference.has(reel)
        && echantillons[0].ctimeMs !== this.ctimeReference.get(reel));

    const paquet = (evenement.path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/) ?? [])[1] ?? '(inconnu)';
    const verdict = contenuADiverge
      ? (revenu ? 'CONTENU MODIFIÉ PUIS RESTAURÉ' : 'CONTENU MODIFIÉ')
      : metaSeule ? 'MÉTADONNÉES SEULES (attribut/horodatage) — aucun octet changé'
        : 'AUCUN CHANGEMENT MESURABLE (accès seul)';

    this.noter('NODE_MODULES_MUTATION', {
      package: paquet,
      file: evenement.path,
      realpath: evenement.realpath,
      source: evenement.source,
      hashBefore: reference,
      hashDuring: echantillons.map((e) => e.sha256).find((h) => h && h !== reference) ?? null,
      hashAfter: echantillons.at(-1).sha256,
      contentChanged: contenuADiverge,
      restored: revenu,
      metadataOnly: Boolean(metaSeule) && !contenuADiverge,
      verdict,
      echantillons: echantillons.map((e) => ({
        at: e.at, sha: e.sha256 ? e.sha256.slice(0, 16) : null,
        mtimeMs: e.mtimeMs, ctimeMs: e.ctimeMs, size: e.size, ino: e.ino, mode: e.mode,
      })),
      externalWriterSuspected: true,
      /** Les processus nés autour de l'événement — la seule piste vers l'écrivain. */
      processusFenetre: this.processus.filter((p) => Math.abs(p.at - evenement.at) <= 2000),
    });

    // La référence suit l'état courant : un second événement compare au présent.
    const finale = echantillons.at(-1);
    if (finale.sha256) this.shaReference.set(reel, finale.sha256);
    if (finale.ctimeMs !== null) this.ctimeReference.set(reel, finale.ctimeMs);
    this.sondesEnCours.delete(reel);
  }

  /**
   * SURVEILLANCE PARENT — posée au lancement, donc CHAUDE depuis toujours.
   *
   * C'est la différence de fond avec le V2 : ces veilleurs ne sont pas créés au
   * clic, quelques millisecondes avant l'écriture qu'on cherche. Ils observent
   * déjà depuis le démarrage de la session de développement.
   */
  demarrerVeilleursFs(racines) {
    for (const racine of racines) {
      try {
        const v = fs.watch(racine, { recursive: true }, (type, fichier) => {
          if (!fichier) return;
          this.ajouterEvenement('fs.watch', String(type).toUpperCase(), path.join(racine, String(fichier)));
        });
        this.veilleurs.push(v);
      } catch (err) {
        this.noter('WATCH_ROOT_FAILED', { racine: chemineRelatif(racine), code: err?.code ?? null });
      }
    }
    return this.veilleurs.length;
  }

  /**
   * LES HELPERS WINDOWS — lancés PAR NOUS, jamais par l'exploitant.
   *
   * Le lot est explicite : « l'utilisateur ne lance RIEN ». Ce sont donc des
   * enfants du lanceur, qui meurent avec lui. Si PowerShell est absent ou
   * refuse, on le NOTE et l'on continue : une source d'appoint qui manque
   * dégrade le diagnostic, elle ne doit pas empêcher le développement.
   */
  demarrerHelpers(racines) {
    const lancer = (nom, script, args, surLigne) => {
      try {
        const p = spawn('powershell', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(ICI, script), ...args,
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let tampon = '';
        p.stdout.on('data', (b) => {
          tampon += b.toString('utf8');
          const lignes = tampon.split(/\r?\n/);
          tampon = lignes.pop() ?? '';
          for (const l of lignes) if (l.trim()) surLigne(l.trim());
        });
        /**
         * LA SORTIE D'ERREUR DU HELPER EST JOURNALISÉE, PAS AVALÉE.
         *
         * Un helper qui échoue en silence, c'est une source qu'on croit active
         * et qui ne dit rien — exactement l'ambiguïté que ce lot combat. On la
         * borne (un message suffit à diagnostiquer, mille noieraient le journal).
         */
        let erreursVues = 0;
        p.stderr.on('data', (b) => {
          if (erreursVues >= 3) return;
          erreursVues += 1;
          this.noter('HELPER_STDERR', { nom, message: String(b).trim().slice(0, 300) });
        });
        p.on('error', (err) => this.noter('HELPER_ERROR', { nom, message: err?.message ?? null }));
        p.on('exit', (code) => {
          if (code !== 0 && code !== null) this.noter('HELPER_EXIT', { nom, code });
        });
        this.helpers.push({ nom, process: p });
        return true;
      } catch (err) {
        this.noter('HELPER_ERROR', { nom, message: err?.message ?? null });
        return false;
      }
    };

    /**
     * LES RACINES VOYAGENT EN UNE SEULE CHAÎNE, SÉPARÉES PAR `|`.
     *
     * MESURE : appelé via `-File`, PowerShell ne lie qu'UNE valeur à un
     * paramètre `[string[]]` — la seconde racine devenait un argument
     * positionnel orphelin et le helper mourait. `|` est interdit dans un
     * chemin Windows : la séparation est donc sans ambiguïté, y compris pour
     * les chemins à espaces comme celui de ce projet.
     */
    const fsOk = lancer('fs-events', 'fs-events.ps1',
      ['-ParentPid', String(process.pid), '-RootsJoined', racines.join('|')], (ligne) => {
      const [type, ...reste] = ligne.split('|');
      if (type === 'EVENT') {
        const [, kind, full] = [ligne, reste[1], reste.slice(2).join('|')];
        this.ajouterEvenement('FileSystemWatcher', String(kind).toUpperCase(), full);
      } else if (type === 'OVERFLOW') {
        /**
         * UN DÉBORDEMENT SE DIT. Une rafale peut saturer le tampon du
         * surveillant .NET : ignorer l'avertissement ferait passer une LACUNE
         * pour une ABSENCE d'événement — l'erreur que tout ce lot combat.
         */
        this.debordement = true;
        this.noter('FS_EVENTS_OVERFLOW', {});
      } else if (type === 'ERROR') {
        this.noter('HELPER_ERROR', { nom: 'fs-events', message: reste.join('|') });
      }
    });

    const procOk = lancer('process-trace', 'process-trace.ps1',
      ['-ParentPid', String(process.pid)], (ligne) => {
      const [type, ms, pid, ppid, nom, naissance] = ligne.split('|');
      if (type !== 'PROC') return;
      const e = {
        at: Number(ms), pid: Number(pid), ppid: Number(ppid), nom,
        startTimeMs: naissance ? Number(naissance) : null,
      };
      this.processus.push(e);
      if (this.processus.length > 2000) this.processus.splice(0, 1000);
      this.noter('PROCESS_SPAWNED', e);
    });

    return { fsOk, procOk };
  }

  arreterHelpers() {
    for (const h of this.helpers) { try { h.process.kill(); } catch { /* déjà parti */ } }
    for (const v of this.veilleurs) { try { v.close(); } catch { /* déjà fermé */ } }
  }

  /* ── L'ÉVÉNEMENT — ce qui se passe quand le parent lit « Restarting » ──── */

  /**
   * ATTRIBUE un redémarrage. Appelé à l'instant EXACT de la lecture du message.
   *
   * Les instantanés différés sont lancés sans être attendus : le lanceur ne
   * doit pas retarder le relais de la sortie pour faire du diagnostic.
   */
  async attribuerRedemarrage({ cible = null } = {}) {
    const T0 = maintenant();
    this.lastRestartAt = T0;

    const diffs = { T0: this.diffInstantane() };
    const FENETRE_EVENEMENTS_MS = 5000;
    const recents = this.evenementsFs.filter((e) => T0 - e.at <= FENETRE_EVENEMENTS_MS);

    for (const retard of RETARDS_MS) {
      await new Promise((r) => { setTimeout(r, retard - (maintenant() - T0) > 0 ? retard - (maintenant() - T0) : 0); });
      diffs[`T+${retard}`] = this.diffInstantane();
    }

    const attribution = this.attribuer({ T0, diffs, evenements: recents });

    this.noter('WATCH_RESTART', {
      cible,
      connectionForensicsSessionId: this.sessionMetier?.sessionId ?? null,
      connectionForensicsEtape: this.sessionMetier?.etape ?? null,
      childOld: this.currentChildPid,
      childGeneration: this.childGeneration,
      /**
       * DEUX CHIFFRES, PARCE QU'ILS RÉPONDENT À DEUX QUESTIONS.
       *
       * `loadedFiles` — ce que le process a chargé.
       * `watchedFiles` — ce qui peut réellement le relancer.
       *
       * Les confondre était acceptable sous `--watch`, où ils étaient égaux.
       * Sous `--watch-path`, annoncer 1400 « surveillés » serait faux de 900.
       */
      loadedFiles: this.unionSurveillee.size,
      watchedFiles: [...this.unionSurveillee.values()].filter((i) => i.dansPortee).length,
      watchScope: this.portee ? this.portee.map(chemineRelatif) : '(graphe complet)',
      /** Les événements bruts, des DEUX sources, dans l'ordre. */
      eventsBefore: recents.filter((e) => e.at <= T0).map(this.serialiserEvenement),
      eventsAfter: this.evenementsFs.filter((e) => e.at > T0).map(this.serialiserEvenement),
      graphDiff: attribution.graphDiff,
      diffsParFenetre: Object.fromEntries(
        Object.entries(diffs).map(([k, v]) => [k, v.map((d) => `${d.cause} ${d.path}`)]),
      ),
      processusRecents: this.processus.filter((p) => T0 - p.at <= FENETRE_EVENEMENTS_MS),
      likelyTrigger: attribution.likelyTrigger,
      confidence: attribution.confidence,
      classification: attribution.classification,
      fsEventsOverflow: this.debordement,
    });

    // La base repart de l'état courant : un même écart ne doit pas être
    // réattribué au redémarrage suivant.
    this.rebaser();
    return attribution;
  }

  serialiserEvenement = (e) => ({
    at: e.at, source: e.source, type: e.type, path: e.path, zone: e.zone, surveille: e.surveille,
  });

  /** Recompare l'ensemble SURVEILLÉ — jamais tout `src`, qui n'accuse personne. */
  diffInstantane() {
    const ecarts = [];
    for (const [reel, info] of this.unionSurveillee) {
      // Hors portée = incapable de déclencher : on ne le compare même pas.
      if (!info.dansPortee) continue;
      const avant = this.instantane.get(reel) ?? null;
      const apres = photographier(reel, { hacher: Boolean(avant?.hash) || info.zone !== 'node_modules' });
      const cause = comparer(avant, apres);
      if (cause) {
        ecarts.push({
          path: info.path, realpath: info.realpath, zone: info.zone, cause,
          mtimeBefore: avant?.mtimeMs ?? null, mtimeAfter: apres?.mtimeMs ?? null,
          sizeBefore: avant?.size ?? null, sizeAfter: apres?.size ?? null,
          hashBefore: avant?.hash ?? null, hashAfter: apres?.hash ?? null,
          inoBefore: avant?.ino ?? null, inoAfter: apres?.ino ?? null,
        });
      }
    }
    return ecarts;
  }

  rebaser() {
    for (const [reel, info] of this.unionSurveillee) {
      if (!info.dansPortee) continue;
      const photo = photographier(reel, { hacher: info.zone !== 'node_modules' });
      if (photo) this.instantane.set(reel, photo);
    }
  }

  /**
   * ══ LE MODÈLE DE CONFIANCE (§15) ══════════════════════════════════════════
   *
   * Le V2 rendait `likelyTrigger` sans dire ce qu'il valait. Or « un fichier a
   * un événement live ET une différence de contenu juste avant le redémarrage »
   * et « un fichier diffère après coup, sans qu'aucune source ne l'ait vu
   * bouger » sont deux affirmations de force très inégale — et la seconde peut
   * n'être qu'un effet du redémarrage lui-même.
   *
   *   HIGH    événement live SUR un fichier surveillé + écart mesuré
   *   MEDIUM  événement live seul, sur un fichier surveillé
   *   LOW     écart constaté après coup, sans aucun événement
   *   NONE    aucune preuve fichier — et on le DIT
   */
  attribuer({ T0, diffs, evenements }) {
    const graphDiff = [];
    const vus = new Set();
    for (const fenetre of Object.values(diffs)) {
      for (const d of fenetre) {
        if (vus.has(d.path)) continue;
        vus.add(d.path);
        graphDiff.push(d);
      }
    }

    const surveilles = evenements.filter((e) => e.surveille);
    const avecEcart = surveilles.filter((e) => graphDiff.some((d) => d.path === e.path));

    let confidence = 'NONE';
    let likelyTrigger = null;
    if (avecEcart.length) {
      confidence = 'HIGH';
      likelyTrigger = avecEcart[avecEcart.length - 1].path;
    } else if (surveilles.length) {
      confidence = 'MEDIUM';
      likelyTrigger = surveilles[surveilles.length - 1].path;
    } else if (graphDiff.length) {
      confidence = 'LOW';
      likelyTrigger = graphDiff[graphDiff.length - 1].path;
    }

    /**
     * ══ ON N'ACCUSE PAS L'APPLICATION D'UNE ÉCRITURE QU'ELLE NE FAIT PAS ═════
     *
     * Si le fichier désigné vit dans `node_modules`, l'application ne l'écrit
     * pas : l'audit du dépôt établit que les seuls `npm ci` / `npm install` du
     * produit s'exécutent dans une COPIE de staging ou sur la machine distante,
     * jamais sur l'arbre en cours d'exécution. Un gestionnaire de paquets, un
     * antivirus, un indexeur ou une extension d'éditeur sont les explications
     * plausibles — et la trace de processus est là pour les nommer.
     *
     * Classer « bug du moteur de déploiement » ici enverrait corriger un code
     * qui n'a rien fait.
     */
    let classification = 'UNKNOWN';
    if (likelyTrigger) {
      const cible = graphDiff.find((d) => d.path === likelyTrigger)
        ?? surveilles.find((e) => e.path === likelyTrigger);
      classification = cible?.zone === 'node_modules'
        ? 'EXTERNAL_WRITER_SUSPECTED'
        : 'PROJECT_SOURCE_CHANGE';
    } else {
      classification = 'NO_FILE_EVIDENCE';
    }

    const writer = this.classerEcrivain({ T0, likelyTrigger, classification });
    return { likelyTrigger, confidence, classification, graphDiff, T0, ...writer };
  }

  /**
   * ══ QUI A ÉCRIT ? (§12) — ET « JE NE SAIS PAS » EST UNE RÉPONSE ══════════
   *
   * Sans `handle.exe` ni Process Monitor, Windows ne donne pas le PID d'un
   * écrivain sans élévation (mesuré : USN et `Win32_ProcessStartTrace` refusent).
   * On ne peut donc que CORRÉLER — et une corrélation n'est pas une preuve.
   *
   * La règle est donc stricte : on ne nomme un écrivain que si un processus
   * plausible est né dans la fenêtre. Sinon `UNKNOWN_EXTERNAL`, dit franchement.
   * Nommer un antivirus « parce que c'est souvent lui » serait exactement le
   * genre de conclusion qui fait perdre des journées.
   *
   * `NODE_APP` mérite un mot : le lot §14 en fait un P0 — aucun runtime ne doit
   * modifier son propre `node_modules`. On ne l'attribue donc QUE sur un fichier
   * hors `node_modules`, ou sur une mutation de CONTENU démontrée dont notre
   * process est le seul candidat.
   */
  classerEcrivain({ T0, likelyTrigger, classification }) {
    if (!likelyTrigger) return { writer: 'NONE', writerConfidence: 'NONE', writerEvidence: [] };
    if (classification === 'PROJECT_SOURCE_CHANGE') {
      return { writer: 'NODE_APP_OR_EDITOR', writerConfidence: 'LOW', writerEvidence: ['fichier du projet, hors node_modules'] };
    }

    const FENETRE = 2000;
    const candidats = this.processus.filter((p) => Math.abs(p.at - T0) <= FENETRE);
    const familles = [
      [/^npm|^npx|^pnpm|^yarn/i, 'NPM'],
      [/^Code\.exe$|^code\.exe$/i, 'VSCODE'],
      [/MsMpEng|Antimalware/i, 'ANTIVIRUS'],
      [/OneDrive|Dropbox|GoogleDrive|FileCoAuth/i, 'SYNC_TOOL'],
      [/SearchIndexer|SearchProtocolHost/i, 'INDEXER'],
      [/^git\.exe$/i, 'GIT'],
    ];

    for (const [motif, famille] of familles) {
      const vu = candidats.find((p) => motif.test(p.nom));
      if (vu) {
        return {
          writer: famille,
          /**
           * MEDIUM, jamais HIGH : un processus né dans la fenêtre est une
           * COÏNCIDENCE TEMPORELLE. Seul un outil de handles pourrait prouver
           * l'écriture, et il n'est pas installé.
           */
          writerConfidence: 'MEDIUM',
          writerEvidence: [`${vu.nom} pid=${vu.pid} ppid=${vu.ppid} à ${vu.at - T0}ms du redémarrage`],
        };
      }
    }

    return {
      writer: 'UNKNOWN_EXTERNAL',
      writerConfidence: 'NONE',
      writerEvidence: candidats.length
        ? [`${candidats.length} processus dans la fenêtre, aucun d’une famille connue`]
        : ['AUCUN processus npm/node/git/éditeur/antivirus né dans la fenêtre ±2s'],
    };
  }

  /* ── LE CONTEXTE MÉTIER PUBLIÉ PAR L'ENFANT ────────────────────────────── */

  /** L'enfant annonce l'armement d'une session CONNECTION_SERVER. */
  sessionMetierArmee(charge) {
    this.sessionMetier = { ...charge, at: maintenant() };
    this.noter('CHILD_SESSION_ARMED', charge);
  }

  sessionMetierDesarmee(charge) {
    this.noter('CHILD_SESSION_DISARMED', { ...charge, sessionId: this.sessionMetier?.sessionId ?? null });
    this.sessionMetier = null;
  }
}

export default WatchAuthority;
