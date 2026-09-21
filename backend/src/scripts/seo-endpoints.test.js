/**
 * `/sitemap.xml` ET `/robots.txt` NE SONT JAMAIS DU HTML — garde de déploiement.
 *
 * ══ LE DÉFAUT QUE CETTE SUITE VERROUILLE ════════════════════════════════════
 *
 * Google Search Console a refusé le plan du site de ly-solution.com :
 *
 *     « Le sitemap peut être lu, mais contient des erreurs.
 *       Le sitemap est un fichier HTML. »
 *
 * Rien n'était en panne. Le plan existait, sa route répondait, la suite de
 * tests était verte, le déploiement s'était terminé sans une seule erreur. Mais
 * le plan vivait sous `/api/public/sitemap.xml`, et à l'adresse que TOUT LE
 * MONDE essaie — `/sitemap.xml` — nginx ne trouvait aucun fichier et appliquait
 * le repli d'application à page unique : `index.html`, en `text/html`, en 200.
 *
 * Un 200 qui ment est pire qu'un 404. Sur un 404, le moteur revient ; sur ce
 * 200, il conclut que le plan du site EST une page HTML, et il s'arrête là.
 *
 * C'est la même famille que le type MIME des modules (`nginx-module-mime`) :
 * un défaut qui n'existe qu'une fois la configuration serveur et l'application
 * assemblées, invisible à toute suite qui ne regarde que du code.
 *
 * ══ CE QUE CETTE SUITE VÉRIFIE, ET DANS QUEL ORDRE ══════════════════════════
 *
 *   1. le générateur nginx pose un bloc EXACT pour `/sitemap.xml` sur l'hôte
 *      public, AVANT que le repli d'application ne puisse l'attraper ;
 *   2. les hôtes NON publics — Manager, API — refusent l'indexation autrement
 *      que par leur absence du plan : en-tête `X-Robots-Tag` et `robots.txt`
 *      interdisant tout ;
 *   3. le backend sert la route à la RACINE, cible de ce bloc ;
 *   4. le `robots.txt` livré annonce une adresse de plan ABSOLUE, et cette
 *      adresse est bien celle qui est servie ;
 *   5. le contrôle de santé refuse un déploiement dont `/sitemap.xml` répond
 *      200 avec du HTML — c'est la garde qui rend le retour en arrière
 *      impossible.
 *
 * Les points 1, 2 et 5 sont dans le MOTEUR : ils protègent tout projet du parc,
 * pas seulement celui-ci.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderNginxConfig } from '../deployment-engine/nginx.js';
import { parseTargetUrl } from '../deployment-engine/url.js';
import { planTopology } from '../deployment-engine/topology.js';
import { checkSeoEndpoints } from '../deployment-engine/health.js';
import { FakeTransport } from '../deployment-engine/transport/FakeTransport.js';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n${t}`); }

const ici = path.dirname(fileURLToPath(import.meta.url));
const racineProjet = path.resolve(ici, '../../..');

const cible = parseTargetUrl('https://demo.exemple.test');
const config = renderNginxConfig(cible, {
  webRoot: '/var/www/demo/vitrine',
  managerRoot: '/var/www/demo/manager',
  backendPort: 6070,
});

/**
 * Isole le corps du bloc `server` qui sert un hôte donné. Les assertions qui
 * suivent portent toutes sur UN hôte : une règle posée sur le Manager ne doit
 * jamais pouvoir faire passer une assertion qui concerne la vitrine.
 */
function blocServeur(conf, hote) {
  const blocs = conf.split(/(?=^server\s*\{)/m).filter((b) => b.trim().startsWith('server'));
  return blocs.filter((b) => {
    /**
     * COMPARAISON PAR JETON, PAS PAR SOUS-CHAÎNE. `manager.demo.exemple.test`
     * CONTIENT `demo.exemple.test` : une recherche textuelle rendrait le bloc du
     * Manager quand on demande celui de la vitrine, et l'assertion « la vitrine
     * ne s'interdit pas l'indexation » échouerait sur une règle qui ne la
     * concerne pas. On découpe donc la liste `server_name` en noms d'hôtes.
     */
    const m = b.match(/server_name\s+([^;]+);/);
    if (!m) return false;
    return m[1].trim().split(/\s+/).includes(hote);
  })
    // On ignore les blocs de redirection HTTP→HTTPS (ils ne servent rien).
    .filter((b) => !/return\s+301\s+https/.test(b) || /location\s*\/\s*\{/.test(b))
    .join('\n');
}

const HOTE_PUBLIC = 'demo.exemple.test';
const HOTE_MANAGER = 'manager.demo.exemple.test';
const HOTE_API = 'api.demo.exemple.test';

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · L’hôte PUBLIC a un bloc dédié pour le plan du site');
{
  const vitrine = blocServeur(config, HOTE_PUBLIC);
  check('le bloc de la vitrine a été trouvé', vitrine.length > 0);

  /**
   * `location = /sitemap.xml` — le signe `=` n'est pas décoratif. nginx donne
   * la priorité ABSOLUE à une correspondance exacte : elle est évaluée avant
   * tout préfixe, donc avant le `location /` qui porte le repli d'application.
   * Un `location /sitemap.xml` sans `=` fonctionnerait ici par accident, et
   * cesserait de fonctionner le jour où un préfixe plus long serait ajouté.
   */
  check('une correspondance EXACTE vise /sitemap.xml',
    /location\s*=\s*\/sitemap\.xml\s*\{/.test(vitrine));

  check('…et elle est proxifiée vers le backend (pas servie depuis le disque)',
    /location\s*=\s*\/sitemap\.xml\s*\{[\s\S]{0,400}?proxy_pass\s+http:\/\/127\.0\.0\.1:6070\/sitemap\.xml\s*;/.test(vitrine));

  /**
   * LE REPLI EXISTE TOUJOURS. On n'a pas remplacé le comportement d'une
   * application à page unique, on lui a retiré UNE adresse. Si cette assertion
   * tombe, toutes les routes du site rendent 404.
   */
  check('le repli d’application à page unique est intact',
    /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/.test(vitrine));

  /** L'hôte public ne doit surtout PAS s'interdire lui-même l'indexation. */
  check('la vitrine ne porte AUCUN en-tête de non-indexation',
    !/X-Robots-Tag/i.test(vitrine));
  check('…et n’écrase pas son propre robots.txt',
    !/location\s*=\s*\/robots\.txt/.test(vitrine));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · Les hôtes NON publics refusent l’indexation, explicitement');
{
  /**
   * ══ POURQUOI L'ABSENCE DU PLAN NE PROTÈGE DE RIEN ═══════════════════════
   *
   * Un plan de site est une INVITATION, pas une clôture. Google découvre une
   * adresse par un lien entrant, un certificat TLS publié dans les journaux de
   * transparence — chaque sous-domaine y figure en clair, quelques minutes
   * après son émission —, une barre d'adresse, un référent. `manager.` et
   * `api.` sont donc trouvables sans que personne ne les ait déclarés.
   *
   * Il faut donc une interdiction PORTÉE PAR LA RÉPONSE elle-même. Et elle ne
   * doit rien casser : le Manager reste servi normalement, on ajoute seulement
   * un en-tête que les moteurs lisent et que les navigateurs ignorent.
   */
  for (const [nom, hote] of [['Manager', HOTE_MANAGER], ['API', HOTE_API]]) {
    const bloc = blocServeur(config, hote);
    check(`le bloc ${nom} a été trouvé`, bloc.length > 0);
    check(`${nom} · en-tête X-Robots-Tag noindex`,
      /add_header\s+X-Robots-Tag\s+"noindex,\s*nofollow"\s+always\s*;/.test(bloc));
    check(`${nom} · robots.txt servi en texte brut et interdisant tout`,
      /location\s*=\s*\/robots\.txt\s*\{[\s\S]{0,400}?Disallow:\s*\//.test(bloc));
    check(`${nom} · …et ce robots.txt n’est pas du HTML`,
      /location\s*=\s*\/robots\.txt\s*\{[\s\S]{0,400}?text\/plain/.test(bloc));
    /**
     * UN SEUL type de contenu. `return 200 "…"` en pose déjà un ; un
     * `add_header Content-Type` par-dessus n'aurait pas remplacé cette valeur,
     * il en aurait ajouté une seconde. nginx émettait alors, mesuré en
     * production sur manager.ly-solution.com :
     *
     *     Content-Type: text/plain, text/plain; charset=utf-8
     *
     * Deux valeurs jointes par une virgule ne sont pas un type de contenu.
     */
    check(`${nom} · le type est posé par default_type, pas par add_header`,
      /location\s*=\s*\/robots\.txt\s*\{[\s\S]{0,400}?default_type\s+text\/plain\s*;/.test(bloc)
      && !/location\s*=\s*\/robots\.txt\s*\{[\s\S]{0,400}?add_header\s+Content-Type/.test(bloc));
    /**
     * AUCUN PLAN DU SITE, ET DIT FRANCHEMENT.
     *
     * Ne PAS écrire de bloc ne suffit pas : sans règle, l'hôte du Manager
     * applique son repli d'application (200 + HTML) et l'hôte API proxifie
     * tout vers le backend, qui sert le VRAI plan — mesuré en production :
     *
     *     api.ly-solution.com/sitemap.xml       200 · application/xml
     *     manager.ly-solution.com/sitemap.xml   200 · text/html
     *
     * Le plan du site appartient à UN hôte. Partout ailleurs, l'adresse
     * n'existe pas, et le dire vaut mieux que rendre autre chose.
     */
    check(`${nom} · le plan du site répond 404, il n’est pas inventé`,
      /location\s*=\s*\/sitemap\.xml\s*\{[\s\S]{0,200}?return\s+404\s*;/.test(bloc));
    check(`${nom} · …et surtout il n’est PAS proxifié vers le backend`,
      !/location\s*=\s*\/sitemap\.xml\s*\{[\s\S]{0,200}?proxy_pass/.test(bloc));
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · La topologie désigne UN SEUL hôte public');
{
  const topo = planTopology({ host: 'demo.exemple.test' });
  const publics = topo.publishable.filter((a) => a.public === true);
  const prives = topo.publishable.filter((a) => a.public !== true);

  check(`exactement une application publique (${publics.map((a) => a.id).join(', ') || 'aucune'})`,
    publics.length === 1);
  check('…et c’est celle qui occupe l’hôte principal',
    publics.length === 1 && publics[0].host === 'demo.exemple.test');
  check(`les autres sont privées (${prives.map((a) => a.id).join(', ') || 'aucune'})`,
    prives.every((a) => a.host !== 'demo.exemple.test'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3.bis · Un profil peut refuser la publicité — le Panel le fait');
{
  /**
   * ══ CE QUE LE RÔLE NE DIT PAS ═════════════════════════════════════════════
   *
   * « web » décrit une FORME : une application front servie sur l'hôte
   * principal. Le frontend du Panel a exactement cette forme, et ne doit
   * pourtant jamais paraître dans un moteur — c'est un plan de contrôle.
   *
   * Déduire la publicité du seul rôle rendait donc indexable tout plan de
   * contrôle, tout espace interne, toute console bâtie sur cette forme. En
   * silence : rien n'échoue, rien n'alerte, l'hôte est simplement ouvert.
   *
   * Le profil garde donc le dernier mot, et le DÉFAUT reste « public » : une
   * vitrine qui oublie de se déclarer doit rester trouvable, c'est l'erreur la
   * moins grave des deux.
   */
  const profilPlanDeControle = [
    { id: 'frontend', role: 'web', nginxRole: 'web', public: false },
    { id: 'backend', role: 'server', nginxRole: 'server' },
  ];

  const confPanel = renderNginxConfig(parseTargetUrl('https://plan.exemple.test'), {
    webRoot: '/var/www/plan/frontend',
    backendPort: 6070,
    profile: profilPlanDeControle,
  });
  const bloc = blocServeur(confPanel, 'plan.exemple.test');
  check('un « web » déclaré non public n’expose AUCUN plan du site',
    /location\s*=\s*\/sitemap\.xml\s*\{[\s\S]{0,200}?return\s+404\s*;/.test(bloc)
    && !/proxy_pass[^\n]*sitemap/.test(bloc));
  check('…et porte l’interdiction d’indexation',
    /add_header\s+X-Robots-Tag\s+"noindex,\s*nofollow"\s+always\s*;/.test(bloc));
  check('…et sert son propre robots.txt en « Disallow: / »',
    /location\s*=\s*\/robots\.txt\s*\{[\s\S]{0,400}?Disallow:\s*\//.test(bloc));
  check('…sans rien retirer à son fonctionnement (repli d’application intact)',
    /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/.test(bloc));

  const topoPanel = planTopology({ host: 'plan.exemple.test', profile: profilPlanDeControle });
  check('la topologie ne déclare AUCUN hôte public',
    topoPanel.publishable.every((a) => a.public !== true));

  /** Le défaut n'a pas bougé : sans déclaration, un « web » reste public. */
  const topoVitrine = planTopology({
    host: 'vitrine.exemple.test',
    profile: [{ id: 'vitrine', role: 'web', nginxRole: 'web' }],
  });
  check('sans déclaration, un « web » reste public',
    topoVitrine.publishable[0]?.public === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · Le backend sert le plan À LA RACINE');
{
  const appJs = fs.readFileSync(path.join(racineProjet, 'backend/src/app.js'), 'utf8');

  /**
   * La cible du bloc nginx doit EXISTER. Un `proxy_pass` vers une route absente
   * rendrait la page 404 de l'API — du JSON en 404 : moins grave que du HTML en
   * 200, et toujours faux.
   */
  check('app.js enregistre GET /sitemap.xml à la racine',
    /app\.get\(\s*['"]\/sitemap\.xml['"]/.test(appJs));

  const controleur = fs.readFileSync(
    path.join(racineProjet, 'backend/src/controllers/public.controller.js'), 'utf8',
  );
  check('le contrôleur répond avec un type XML',
    /res\.type\(\s*['"]application\/xml['"]\s*\)/.test(controleur));
  check('…et une déclaration XML en tête du document',
    controleur.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  check('…dans un urlset conforme au schéma sitemaps.org',
    controleur.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));

  /**
   * LES ADRESSES SONT ABSOLUES, ET L'HÔTE NE VIENT PAS DE LA REQUÊTE. Un plan
   * construit sur l'en-tête `Host` publierait, sous un `Host` falsifié, un plan
   * pointant ailleurs. L'hôte vient de la configuration réseau du projet.
   */
  check('l’hôte du plan vient de la configuration, pas d’un en-tête de requête',
    /cfg\.network\?\.websiteUrl/.test(controleur) && !/req\.(headers\.host|hostname)/.test(controleur));

  /** Ce que le plan ne doit JAMAIS contenir. */
  const bloc = controleur.slice(controleur.indexOf('export const sitemap'));
  const corpsSitemap = bloc.slice(0, bloc.indexOf('\n});'));
  for (const interdit of ['/manager', '/api/', 'admin', 'login', '/404']) {
    check(`le plan ne cite pas « ${interdit} »`, !corpsSitemap.includes(interdit));
  }
  check('le plan ne retient que les chapitres PUBLIÉS',
    /Chapter\.find\(\s*\{\s*published:\s*true\s*\}/.test(corpsSitemap));
  check('…et que les pages PUBLIÉES',
    /SitePage\.find\(\s*\{\s*published:\s*true\s*\}/.test(corpsSitemap));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · Le robots.txt livré annonce une adresse ABSOLUE et EXISTANTE');
{
  const robots = fs.readFileSync(path.join(racineProjet, 'vitrine/public/robots.txt'), 'utf8');
  const ligne = robots.split('\n').find((l) => /^\s*Sitemap:/i.test(l));
  check('une ligne Sitemap est déclarée', Boolean(ligne));

  /**
   * La spécification n'autorise PAS de chemin relatif ici : la ligne doit
   * porter une URL complète. C'était la première version de ce fichier, et
   * elle était doublement fausse — relative, ET pointant sur une adresse qui
   * n'existait pas encore.
   */
  const url = (ligne || '').replace(/^\s*Sitemap:\s*/i, '').trim();
  check(`l’adresse est absolue (${url})`, /^https:\/\/[^/]+\/.+/.test(url));

  /**
   * ET ELLE POINTE SUR LA ROUTE QUI EXISTE. La deuxième version du fichier
   * annonçait `/api/public/sitemap.xml` : une adresse valide, que personne ne
   * soumet jamais à un moteur. C'est `/sitemap.xml` qui a été soumis, et
   * c'est `/sitemap.xml` qui doit répondre.
   */
  check('…et son chemin est /sitemap.xml, à la racine',
    url.endsWith('/sitemap.xml') && !url.includes('/api/'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · Le contrôle de santé refuse un plan en HTML');
{
  /** Réponse de sonde telle que `curl` la produit : « code type » puis le corps. */
  const reponse = (code, type, corps) => ({ code: 0, stdout: `${code} ${type}\n${corps}`, stderr: '' });

  const cas = async (nom, sitemapRes, robotsRes, attenduOk) => {
    const t = new FakeTransport();
    t.on(/sitemap\.xml/, sitemapRes);
    t.on(/robots\.txt/, robotsRes);
    const r = await checkSeoEndpoints(t, 'demo.exemple.test');
    check(`${nom} → ${attenduOk ? 'accepté' : 'REFUSÉ'}${r.problems.length ? ` (${r.problems[0].slice(0, 60)}…)` : ''}`,
      r.ok === attenduOk);
    return r;
  };

  const robotsBon = reponse(200, 'text/plain', 'User-agent: *\nAllow: /\n');

  /** LE CAS EXACT DE L'INCIDENT : le repli d'application rend la page d'accueil. */
  await cas('plan répondant 200 avec du HTML',
    reponse(200, 'text/html', '<!doctype html><html lang="fr"><head>'), robotsBon, false);

  /** La variante sournoise : bon type annoncé, corps HTML. */
  await cas('plan annoncé XML mais rendant du HTML',
    reponse(200, 'application/xml', '<!doctype html><html>'), robotsBon, false);

  /** Un type ni XML ni HTML ne trompe personne, et reste invalide. */
  await cas('plan répondant 200 en texte brut',
    reponse(200, 'text/plain', 'rien'), robotsBon, false);

  /** Le cas NOMINAL. */
  const bon = await cas('plan XML conforme',
    reponse(200, 'application/xml; charset=utf-8',
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
    robotsBon, true);
  check('…et il est reconnu comme XML', bon.sitemap.isXml === true);

  /**
   * UN PLAN ABSENT RESTE TOLÉRÉ. Tous les projets du parc n'en publient pas ;
   * en refuser le déploiement les bloquerait tous pour une exigence qu'ils
   * n'ont jamais prise. C'est le 200 MENTEUR qu'on interdit, pas l'absence.
   */
  await cas('plan absent (404)', reponse(404, 'text/html', '<html>404</html>'), robotsBon, true);

  /**
   * ══ UNE RÉPONSE QU'ON N'A PAS PU LIRE N'EST PAS « CONFORME » ═════════════
   *
   * ── LE DÉFAUT QUE CES CAS FERMENT ────────────────────────────────────────
   *
   * Sur un déploiement réel de ly-solution.com, la sonde est tombée sur le
   * garde de disponibilité du backend, qui venait d'être relancé :
   *
   *     HTTP 503 · {"success":false,"message":"Le service démarre…"}
   *
   * Le contrôle n'a rien refusé — tout code autre que 200 était traité comme
   * « aucun plan publié », cas légitime — et le rapport a imprimé
   * « ✓ plan du site et fichier robots conformes ». Il a certifié une réponse
   * qu'il n'avait jamais lue.
   *
   * Un contrôle qui rassure sans avoir vérifié est pire qu'un contrôle absent.
   * On distingue donc DEUX absences : « ce projet ne publie pas de plan »
   * (404, une décision) et « le service n'a pas su répondre » (5xx ou rien,
   * un échec de mesure). La seconde est réessayée, puis refusée.
   */
  {
    const seul = async (nom, sm, attenduOk) => {
      const t = new FakeTransport();
      t.on(/sitemap\.xml/, sm);
      t.on(/robots\.txt/, robotsBon);
      // `retries: 0` : on éprouve le VERDICT, pas la patience.
      const r = await checkSeoEndpoints(t, 'demo.exemple.test', { retries: 0 });
      check(`${nom} → ${attenduOk ? 'accepté' : 'REFUSÉ'} · « ${r.verdict} »`, r.ok === attenduOk);
      return r;
    };

    const cinqCentTrois = await seul('service en cours de démarrage (503)',
      reponse(503, 'application/json; charset=utf-8', '{"success":false,"message":"Le service démarre"}'), false);
    check('…et le problème nomme le code et le nombre de tentatives',
      /503/.test(cinqCentTrois.problems[0]) && /tentative/.test(cinqCentTrois.problems[0]));

    await seul('hôte injoignable (aucune réponse)', reponse(0, '__ERR__', ''), false);

    /** Un projet sans plan reste en règle — mais son verdict le DIT. */
    const absent = await seul('aucun plan publié (404)', reponse(404, 'text/html', '<html>404</html>'), true);
    check('…et le verdict ne prétend PAS que le plan est conforme',
      /aucun plan du site publié/.test(absent.verdict) && !/^plan du site et fichier robots conformes/.test(absent.verdict));

    /** Le nombre de tentatives est rapporté : la mesure se raconte. */
    check('chaque sonde rapporte son nombre de tentatives', absent.sitemap.attempts === 1);
  }

  /** Le fichier robots est soumis à la même règle. */
  await cas('robots.txt rendant du HTML',
    reponse(200, 'application/xml', '<?xml version="1.0"?><urlset>'),
    reponse(200, 'text/html', '<!doctype html>'), false);
}


/* ══════════════════════════════════════════════════════════════════════════ */
section('7 · « Contrôle SEO » est une ÉTAPE, pas un détail caché');
{
  /**
   * ══ POURQUOI CETTE SECTION EXISTE ═════════════════════════════════════════
   *
   * Le contrôle vivait à l'intérieur de « Vérification publique finale ». Il
   * fonctionnait, et personne ne le voyait : ni dans la liste des étapes du
   * déploiement, ni dans le rapport copiable. Un contrôle dont le résultat
   * ne s'affiche nulle part ne rassure pas quand il passe et n'alerte pas
   * quand il refuse.
   *
   * On verrouille donc les trois faits qui le rendent VISIBLE : il est déclaré
   * au registre canonique, il occupe sa propre place dans l'ordre du pipeline,
   * et le rapport reproduit son journal.
   */
  const { CANONICAL_ORDER, CANONICAL_STEPS, toCanonical, stepsForMode } = await import('../deployment-engine/steps.js');
  const { PIPELINE_STEPS } = await import('../deployment-engine/pipeline.js');

  const etape = CANONICAL_STEPS.find((s) => s.id === 'seo.verify');
  check('l’étape « seo.verify » est déclarée au registre', Boolean(etape));
  check(`…et porte un libellé lisible (« ${etape?.label} »)`, etape?.label === 'Contrôle SEO');
  check('…elle est VISIBLE (donc dans la checklist affichée)', etape?.visible === true);
  check('…elle est BLOQUANTE et REQUISE', etape?.blocking === true && etape?.required === true);

  const i = CANONICAL_ORDER.indexOf('seo.verify');
  check('elle suit la vérification publique finale',
    CANONICAL_ORDER[i - 1] === 'public.healthcheck');
  /**
   * …et PRÉCÈDE la synchronisation réseau, qui est un acte de PUBLICATION.
   * On n'annonce pas une destination dont un moteur de recherche recevrait un
   * document invalide.
   */
  check('…et précède la synchronisation de la configuration réseau',
    CANONICAL_ORDER[i + 1] === 'runtime.sync');

  check('le geste brut « seo » est rattaché à cette étape', toCanonical('seo') === 'seo.verify');
  check('elle figure dans la checklist du mode DEPLOYMENT',
    stepsForMode('DEPLOYMENT').some((s) => s.id === 'seo.verify'));

  const p = PIPELINE_STEPS.indexOf('seo');
  check('le pipeline l’exécute entre « validate » et « runtime_config »',
    PIPELINE_STEPS[p - 1] === 'validate' && PIPELINE_STEPS[p + 1] === 'runtime_config');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('8 · Le rapport copiable porte le JOURNAL des sondes');
{
  const { renderMarkdown } = await import('../deployment-engine/report/markdown.js');

  const journal = [
    '[vitrine] demo.exemple.test',
    '  https://demo.exemple.test/sitemap.xml → HTTP 200 · application/xml; charset=utf-8 · « <?xml version="1.0" encoding="UTF-8"?> <urlset »',
    '  https://demo.exemple.test/robots.txt → HTTP 200 · text/plain · « User-agent: * Allow: / »',
    '  ✓ plan du site et fichier robots conformes',
  ];

  const md = renderMarkdown({
    identification: { operationType: 'DEPLOYMENT', result: 'ok' },
    steps: [],
    seo: { hosts: ['demo.exemple.test'], checked: 1, log: journal },
  });

  check('le rapport ouvre une section « Contrôle SEO »', md.includes('## Contrôle SEO'));
  check('…qui nomme l’hôte contrôlé', md.includes('demo.exemple.test'));
  /**
   * CHAQUE LIGNE, VERBATIM. Un rapport qui résumerait « SEO : ok » obligerait
   * à rouvrir un terminal pour savoir ce que le moteur a lu.
   */
  for (const ligne of journal) {
    check(`…et reproduit « ${ligne.trim().slice(0, 52)}… »`, md.includes(ligne));
  }
  check('…dans un bloc de code (c’est un journal, il se lit dans l’ordre)',
    /## Contrôle SEO[\s\S]{0,400}?```/.test(md));

  /** Un projet sans hôte public le DIT, au lieu de disparaître du rapport. */
  const mdSkip = renderMarkdown({
    identification: {}, steps: [],
    seo: { skipped: true, reason: 'aucun hôte public dans le profil de ce projet' },
  });
  check('un contrôle non applicable est écrit, pas tu',
    mdSkip.includes('## Contrôle SEO') && mdSkip.includes('aucun hôte public'));

  /**
   * ══ ET SURTOUT : LE JOURNAL SURVIT À L'ÉCHEC ═════════════════════════════
   *
   * C'est quand un contrôle REFUSE qu'on veut voir ce qu'il a lu. Le pipeline
   * attache donc le détail structuré de l'erreur à l'évènement d'étape, et le
   * moteur capture la section même sur un `status: 'error'`.
   */
  const mdEchec = renderMarkdown({
    identification: { result: 'error' }, steps: [],
    seo: {
      hosts: ['demo.exemple.test'],
      checked: 1,
      problems: ['/sitemap.xml répond 200 avec du HTML : un moteur de recherche le refusera.'],
      log: ['[vitrine] demo.exemple.test', '  https://demo.exemple.test/sitemap.xml → HTTP 200 · text/html · « <!doctype html> »'],
    },
  });
  check('un échec montre la réponse fautive', mdEchec.includes('text/html') && mdEchec.includes('<!doctype html>'));
  check('…et énonce le problème', mdEchec.includes('un moteur de recherche le refusera'));
}


console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
