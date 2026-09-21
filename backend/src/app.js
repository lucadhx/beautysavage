import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env.js';
import { isOriginAllowed } from './config/corsOrigins.js';
import { apiRouter } from './routes/index.js';
import * as publicController from './controllers/public.controller.js';
import webhookRoutes from './routes/webhook.routes.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import { requireServiceReady } from './middlewares/readiness.middleware.js';
import { describeReadiness } from './services/lifecycle/readiness.service.js';
import { scheduleOrphanSweep } from './services/storage.service.js';
import { installerMessagesDeValidationFrancais } from './utils/validationFr.js';

/**
 * AUCUNE PHRASE ANGLAISE NE FRANCHIT LA FRONTIÈRE DU PRODUIT.
 *
 * Posé au CHARGEMENT du module, et non dans `createApp()` : une recette qui
 * importe un validateur sans monter l'application doit bénéficier de la même
 * carte. Voir `utils/validationFr.js` — l'installation est idempotente.
 */
installerMessagesDeValidationFrancais();

export function createApp() {
  const app = express();

  // Derrière un reverse proxy (Nginx) : faire confiance au 1er hop pour obtenir
  // l'IP client réelle (X-Forwarded-For) — indispensable au rate-limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images to be embedded
    })
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Outils non-navigateur (pas d'origin) + origines .env ET configurées
        // (managerUrl/websiteUrl du singleton). Jamais "*" avec credentials.
        if (!origin || isOriginAllowed(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    })
  );
  /**
   * ── LES SONDES D'ABORD, LA GARDE ENSUITE ──────────────────────────────────
   *
   * Montées avant tout le reste. Une sonde qui dépendrait de ce qui la précède
   * ne pourrait rien diagnostiquer : c'est précisément quand la chaîne est
   * cassée qu'on l'interroge.
   *
   * `/livez` ne consulte AUCUNE dépendance, volontairement : un `/livez` qui
   * échouerait parce que Mongo est tombée ferait redémarrer en boucle un
   * backend parfaitement sain — et le redémarrage ne répare évidemment pas la
   * base. On transformerait une panne passagère en panne permanente.
   */
  app.get('/livez', (req, res) =>
    res.status(200).json({
      success: true,
      data: { status: 'alive', uptimeS: Math.round(process.uptime()) },
    })
  );

  /**
   * `/readyz` porte sa réponse dans le STATUT — 200 prêt, 503 sinon — pour
   * qu'un proxy ou une sonde de déploiement décide sans lire le corps. Le
   * corps, lui, dit LAQUELLE des dépendances manque : sans ce détail, « pas
   * prêt » envoie chercher partout.
   */
  app.get('/readyz', (req, res) => {
    const etat = describeReadiness();
    res.set('Cache-Control', 'no-store');
    if (!etat.ready) res.set('Retry-After', '2');
    return res.status(etat.ready ? 200 : 503).json({ success: etat.ready, data: etat });
  });

  /**
   * ── LA GARDE DE DISPONIBILITÉ ─────────────────────────────────────────────
   *
   * Placée ici, elle couvre TOUT le reste : webhooks, médias, surface `/api`.
   * Aucune de ces surfaces ne peut aboutir sans base, et chacune produisait
   * jusqu'ici sa propre erreur illisible — un 500 pour l'une, une attente de
   * dix secondes pour l'autre.
   *
   * Elle rend un `503` porteur d'un code stable, ce qui permet au Manager de
   * distinguer « attends » de « reconnecte-toi », et à un fournisseur de
   * webhook de réessayer au lieu d'abandonner.
   */
  app.use(requireServiceReady);

  // Webhooks montés AVANT express.json() : la vérification de signature (Stripe
  // & Yousign) exige le corps BRUT (le routeur applique express.raw en interne).
  app.use('/api/webhooks', webhookRoutes);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (config.isTest) app.use(morgan('dev'));

  /**
   * LECTURE D'UN MÉDIA — depuis l'AUTORITÉ, jamais depuis un disque local.
   *
   * Une instance CLIENTE (poste de développement) n'a pas les fichiers : les
   * servir depuis son propre dossier renverrait un 404 pour un média qui
   * existe pourtant sur le projet déployé. Elle relaie donc la lecture, et le
   * navigateur ne s'adresse qu'à son propre backend — ni adresse d'autorité,
   * ni jeton ne transitent par lui.
   *
   * L'autorité, elle, passe directement au service statique ci-dessous.
   */
  app.use('/uploads', async (req, res, next) => {
    try {
      const { resolveProjectMediaAuthority, relayToProjectAuthority } =
        await import('./services/media/projectMediaAuthority.js');
      const { authority, isAuthority } = await resolveProjectMediaAuthority();
      if (isAuthority || !authority) return next();

      const amont = await relayToProjectAuthority(authority, `/uploads${req.path}`, { method: 'GET' });
      if (!amont.ok) return next();

      const type = amont.headers.get('content-type');
      if (type) res.type(type);
      // Le cache suit celui de l'autorité : deux durées différentes feraient
      // réapparaître une image remplacée sur une seule des deux surfaces.
      const cache = amont.headers.get('cache-control');
      if (cache) res.set('cache-control', cache);

      return res.status(amont.status).send(Buffer.from(await amont.arrayBuffer()));
    } catch {
      // L'autorité injoignable ne doit pas casser la requête : on laisse le
      // service statique répondre, puis le 404 canonique.
      return next();
    }
  });

  /**
   * UN MÉDIA EST IMMUABLE — son nom porte l'empreinte de son contenu.
   *
   * `<mediaId>-<empreinte>.webp` : un contenu différent a forcément une autre
   * adresse, et une adresse donnée ne peut plus jamais désigner autre chose.
   * Le navigateur peut donc le garder un an sans risquer d'afficher une image
   * périmée.
   *
   * Les fichiers au nom HISTORIQUE gardent une durée courte : leur adresse ne
   * dépend pas de leur contenu, et les déclarer immuables serait une promesse
   * qu'on ne peut pas tenir.
   */
  app.use(
    '/uploads',
    express.static(config.paths.uploads, {
      dotfiles: 'deny',
      index: false,
      setHeaders(res, filePath) {
        const porteLEmpreinte = /-[0-9a-f]{12}\.[a-z0-9]+$/i.test(filePath);
        res.set('Cache-Control', porteLEmpreinte
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=604800');
      },
    })
  );

  /**
   * RÉFÉRENCE SUPPRIMÉE — 410 Gone, jamais un 404 muet.
   *
   * Un média retiré laisse son DESCRIPTEUR : on distingue donc « cette adresse
   * n'a jamais existé » (404) de « ce média a été supprimé » (410). Placé
   * APRÈS le service statique : un média supprimé n'a plus de fichier, cette
   * lecture ne coûte donc rien sur le chemin normal.
   */
  app.use('/uploads', async (req, res, next) => {
    try {
      const nom = decodeURIComponent(String(req.path || '').replace(/^\/+/, ''));
      if (!nom || nom.includes('/')) return next();
      const { findProjectMedia } = await import('./services/media/projectMedia.service.js');
      const media = await findProjectMedia(nom);
      if (!media?.deletedAt) return next();
      return res.status(410).set('Cache-Control', 'no-store').json({
        success: false,
        code: 'PROJECT_MEDIA_GONE',
        message: 'Ce média a été supprimé. Cette adresse ne servira plus aucun contenu.',
      });
    } catch {
      return next();
    }
  });

  app.get('/health', (req, res) =>
    res.json({ success: true, data: { status: 'ok', env: config.env } })
  );

  /**
   * ══ LE PLAN DU SITE EST SERVI À LA RACINE, ET C'EST UNE CORRECTION ════════
   *
   * ── L'INCIDENT ───────────────────────────────────────────────────────────
   *
   * Google Search Console a refusé le plan du site avec :
   *
   *     « Le sitemap peut être lu, mais contient des erreurs.
   *       Le sitemap est un fichier HTML. »
   *
   * Le plan existait bien, mais à `/api/public/sitemap.xml`. À l'adresse que
   * TOUT LE MONDE essaie — `/sitemap.xml` — nginx ne trouvait aucun fichier et
   * appliquait le repli d'application à page unique : il rendait `index.html`
   * en `text/html`, avec un code 200. Un 200 qui ment est pire qu'un 404 : le
   * moteur ne réessaie pas, il conclut que le plan est du HTML.
   *
   * ── POURQUOI LA ROUTE EST ICI, ET NON SOUS `/api` ────────────────────────
   *
   * Parce que `/sitemap.xml` est une adresse de PROTOCOLE, au même titre que
   * `/robots.txt` : elle n'appartient pas à l'API du projet, elle appartient à
   * la racine du site. nginx y renvoie désormais un bloc dédié, et ce bloc a
   * besoin d'une cible qui existe. La route `/api/public/sitemap.xml` reste
   * servie : des liens la citent, et la retirer casserait ce qui marche.
   *
   * ── CE QUI EMPÊCHE LA RÉCIDIVE ───────────────────────────────────────────
   *
   * Trois choses, et aucune ne suffit seule : ce bloc, le `location` dédié du
   * moteur de déploiement, et le contrôle de santé qui refuse un déploiement
   * dont `/sitemap.xml` ne rend pas du XML.
   */
  app.get('/sitemap.xml', (req, res, next) => publicController.sitemap(req, res, next));

  // Après toute mutation réussie (création/màj/suppression), programme un
  // balayage anti-orphelins débattu : les fichiers upload devenus non référencés
  // (avis supprimé, bannière/logo/service remplacé…) sont nettoyés du disque.
  // Fire-and-forget : n'impacte jamais la réponse.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) scheduleOrphanSweep();
      });
    }
    next();
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
