/**
 * AUTORITÉ PLATEFORME SUR LES INTEGRATED API — la garde du lot R11.
 *
 * ══ CE QUE CE FICHIER REMPLACE ═════════════════════════════════════════════
 *
 * Cinq suites ont disparu avec leur sujet :
 *
 *   brevo-webhook.test.js      622 l.  webhook Brevo LOCAL — supprimé
 *   brevo-operational.test.js  912 l.  états d'une installation locale — supprimée
 *   brevo.test.js              335 l.  champs de saisie Brevo — supprimés
 *   email-diagnostic.test.js   214 l.  diagnostic de cette installation
 *   integrated-api.test.js     376 l.  routes d'administration — supprimées
 *
 * Elles ne testaient pas un comportement métier devenu faux : elles testaient
 * un SOUS-SYSTÈME qui n'existe plus. Les maintenir aurait exigé de recréer ce
 * qu'on vient de retirer — c'est-à-dire de faire échouer la migration pour
 * garder ses tests verts.
 *
 * Ce fichier garde ce qui reste vrai, et surtout il verrouille l'ABSENCE :
 * c'est elle qui peut revenir en silence, pas la présence.
 *
 * ══ POURQUOI UNE GARDE D'ABSENCE EST NÉCESSAIRE ════════════════════════════
 *
 * Rien n'échoue le jour où un champ `apiKey` revient au catalogue, ni le jour
 * où une route d'écriture est remontée « pour dépanner ». Tout continue de
 * fonctionner — mieux, même, en apparence : un écran de configuration réapparaît
 * et l'on peut y coller une clé. Le défaut ne se voit qu'au repos, dans une base
 * qui contient de nouveau un secret que personne n'aurait dû pouvoir écrire.
 *
 * Lancement : node src/scripts/integrated-api-panel-authority.test.js
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  INTEGRATED_API_CATALOG,
  PROVIDER_VALUES,
  isPanelAuthority,
  hasBaseUrl,
  defaultBaseUrl,
  fieldKeys,
  requiredFieldKeys,
} from '../utils/integratedApiCatalog.js';
import { MANAGED_WEBHOOKS } from '../services/webhooks/managedWebhookRegistry.js';
import { integrationWebhookProviders } from '../services/webhooks/integrationWebhookProviders.js';
import { CREDENTIAL_POLICY } from './purge-dead-provider-credentials.js';

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const RACINE = fileURLToPath(new URL('../../..', import.meta.url));

let pass = 0;
let fail = 0;
function check(nom, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`); }
}
const section = (n) => console.log(`\n${n}`);
const lire = (...p) => readFileSync(join(...p), 'utf8');

/** Blanchit les commentaires : une explication qui CITE un motif interdit ne doit pas l'armer. */
function codeSeul(texte) {
  const blanc = (m) => m.replace(/[^\n]/g, ' ');
  return texte
    .replace(/\/\*[\s\S]*?\*\//g, blanc)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/** Tous les fichiers `.js` du backend hors tests, scripts d'outillage exclus. */
function sourcesRuntime() {
  const out = [];
  (function marcher(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') marcher(p); continue; }
      if (!e.name.endsWith('.js') || e.name.includes('.test.')) continue;
      out.push(p);
    }
  })(join(BACKEND, 'src'));
  return out;
}

/* ══ 1 · LES QUATRE FOURNISSEURS SONT SOUS AUTORITÉ PLATEFORME ═══════════ */
section('1 · Autorité du catalogue');

check('le catalogue déclare exactement quatre fournisseurs',
  PROVIDER_VALUES.length === 4, PROVIDER_VALUES.join(', '));

for (const p of PROVIDER_VALUES) {
  check(`${p} : autorité PANEL`, isPanelAuthority(p),
    `authority = ${INTEGRATED_API_CATALOG[p].authority ?? '(absente → autorité projet)'}`);
  check(`${p} : aucun champ saisissable`, fieldKeys(p).length === 0,
    `champs = ${fieldKeys(p).join(', ')}`);
  check(`${p} : aucun credential requis`, requiredFieldKeys(p).length === 0);
  check(`${p} : aucune base URL locale`, hasBaseUrl(p) === false && defaultBaseUrl(p, 'TEST') === '');
}

/**
 * AUCUNE EXCEPTION N'EST DÉCLARÉE — et c'est le contrôle qui compte.
 *
 * Les quatre contrôles ci-dessus passeraient encore si un CINQUIÈME fournisseur
 * local était ajouté demain : ils bouclent sur ce qui existe. Celui-ci refuse
 * l'ajout lui-même.
 */
check('aucun fournisseur n’échappe à l’autorité plateforme',
  PROVIDER_VALUES.every(isPanelAuthority));

/* ══ 2 · PLUS AUCUN CREDENTIAL LOCAL N'EST ADMINISTRABLE ═════════════════ */
section('2 · Politique de credentials');

check('BREVO : apiKey déclarée MORTE',
  CREDENTIAL_POLICY.BREVO.dead.includes('apiKey')
  && !CREDENTIAL_POLICY.BREVO.keep.includes('apiKey'));
check('BREVO : les secrets de webhook aussi',
  ['webhookSecret', 'webhookSecretPrevious'].every((f) => CREDENTIAL_POLICY.BREVO.dead.includes(f)));
check('BREVO ne conserve plus aucun credential', CREDENTIAL_POLICY.BREVO.keep.length === 0);

/**
 * L'EXCEPTION STRIPE EST NOMMÉE, PAS SUBIE.
 *
 * `webhookSecret` survit, et c'est correct : il est LIVRÉ par le Panel, ne
 * permet AUCUN appel sortant, et sert uniquement à constater qu'un événement
 * reçu vient bien de Stripe. Le supprimer rendrait le projet incapable de
 * distinguer un vrai événement d'un faux — l'inverse d'un durcissement.
 */
check('STRIPE conserve son seul secret de vérification',
  CREDENTIAL_POLICY.STRIPE.keep.length === 1
  && CREDENTIAL_POLICY.STRIPE.keep[0] === 'webhookSecret');
check('…et c’est la SEULE exception de tout le parc',
  Object.entries(CREDENTIAL_POLICY)
    .filter(([, v]) => v.keep.length > 0)
    .map(([k]) => k).join(',') === 'STRIPE');

/* ══ 3 · AUCUNE ROUTE D'ADMINISTRATION NE SUBSISTE ══════════════════════ */
section('3 · Surface d’administration');

for (const f of [
  'src/routes/integratedApi.routes.js',
  'src/controllers/integratedApi.controller.js',
  'src/validators/integratedApi.validator.js',
  'src/routes/brevoWebhookConfig.routes.js',
  'src/controllers/brevoWebhookConfig.controller.js',
  'src/services/brevo/brevoWebhookConfig.service.js',
  'src/services/brevo/brevoWebhookAuth.service.js',
  'src/services/brevo/brevoWebhookIngest.service.js',
]) {
  check(`supprimé : ${f}`, !existsSync(join(BACKEND, f)));
}

const routes = codeSeul(lire(BACKEND, 'src/routes/index.js'));
check('aucun montage /integrated-apis', !/integrated-apis/.test(routes));
check('aucun montage de configuration Brevo', !/brevo/i.test(routes));

const webhookRoutes = codeSeul(lire(BACKEND, 'src/routes/webhook.routes.js'));
check('aucune route de webhook Brevo entrant', !/brevo/i.test(webhookRoutes));
check('…mais Stripe reçoit toujours', /\/stripe/.test(webhookRoutes));

/* ══ 4 · AUCUN APPEL FOURNISSEUR DIRECT ═════════════════════════════════ */
section('4 · Appels directs');

const HOTES_INTERDITS = [
  { hote: 'api.brevo.com', provider: 'BREVO' },
  { hote: 'api.yousign.com', provider: 'YOUSIGN' },
  { hote: 'developers.hostinger.com', provider: 'HOSTINGER' },
];

for (const { hote, provider } of HOTES_INTERDITS) {
  const coupables = sourcesRuntime()
    .filter((f) => codeSeul(readFileSync(f, 'utf8')).includes(hote))
    .map((f) => f.replace(BACKEND, ''));
  check(`aucun appel runtime vers ${hote} (${provider})`, coupables.length === 0,
    coupables.join('\n      '));
}

/**
 * STRIPE EST TRAITÉ À PART, ET LA RAISON EST DANS LE SENS DU FLUX.
 *
 * `api.stripe.com` peut apparaître dans la VÉRIFICATION d'un événement reçu —
 * c'est du trafic ENTRANT, qui ne compose aucune requête et n'exige aucune clé
 * d'appel. Ce qui est interdit, c'est de fabriquer un appel sortant.
 */
const appelsSortantsStripe = sourcesRuntime().filter((f) => {
  const src = codeSeul(readFileSync(f, 'utf8'));
  return /fetch\(\s*[`'"]https:\/\/api\.stripe\.com/.test(src);
}).map((f) => f.replace(BACKEND, ''));
check('aucun appel sortant direct vers api.stripe.com',
  appelsSortantsStripe.length === 0, appelsSortantsStripe.join('\n      '));

/* ══ 5 · AUCUN WEBHOOK FOURNISSEUR N'EST POSSÉDÉ LOCALEMENT, SAUF STRIPE ═ */
section('5 · Propriété des webhooks');

check('le registre géré ne contient plus que STRIPE',
  Object.keys(MANAGED_WEBHOOKS).join(',') === 'STRIPE');
check('aucun driver de webhook Brevo',
  !integrationWebhookProviders().some((p) => p.providerCode() === 'BREVO'));
check('le driver Stripe est resté',
  integrationWebhookProviders().some((p) => p.providerCode() === 'STRIPE'));

/* ══ 6 · LE RETOUR DE LIVRAISON PASSE PAR LE PONT, ET IL EST INTACT ═════ */
section('6 · Retour de livraison par le Panel');

/*
 * LA DISTINCTION QUI COMPTE, ET QU'UNE SUPPRESSION TROP LARGE AURAIT RATÉE.
 *
 *   webhook Brevo LOCAL          → devait disparaître
 *   événements e-mail du PANEL   → devaient RESTER
 *
 * Les deux parlaient de `delivered` / `bounced`. Confondre les deux aurait
 * rendu le projet aveugle au sort de ses e-mails, sans qu'aucun test n'échoue :
 * les envois auraient continué de partir, et seraient restés « Accepté » pour
 * toujours.
 */
const applier = lire(BACKEND, 'src/services/email/emailDeliveryEvent.applier.js');
check('l’applicateur du pont existe toujours', applier.length > 0);
check('…et consomme EMAIL_DELIVERED', /EMAIL_DELIVERED/.test(applier));
check('…et EMAIL_BOUNCED', /EMAIL_BOUNCED/.test(applier));

/* ══ 7 · LE CANAL D'ENVOI NE DÉPEND QUE DE LA PLATEFORME ═══════════════ */
section('7 · Envoi');

const envoi = codeSeul(lire(BACKEND, 'src/services/email/emailDelivery.service.js'));
check('l’envoi passe par la capacité email.send_template',
  /email\.send_template/.test(envoi));
check('…et ne lit aucun credential local',
  !/getCredential|tryGetCredential/.test(envoi));

/*
 * LA NON-RÉGRESSION DEMANDÉE PAR §8 : le readiness ne doit JAMAIS revenir à
 * « pas de clé locale → e-mail indisponible ». C'est le contrôle qui, s'il
 * réapparaissait, éteindrait le service sur l'absence d'une valeur que plus
 * personne n'a le droit d'écrire.
 */
const readiness = codeSeul(lire(BACKEND, 'src/services/email/emailReadiness.service.js'));
check('le readiness ne bloque plus sur une clé Brevo locale',
  !/apiKey/.test(readiness),
  'un blocage qu’aucune action ne peut lever éteint le service');

const operational = codeSeul(lire(BACKEND, 'src/services/email/brevoOperational.service.js'));
check('l’état opérationnel ne connaît plus API_KEY_MISSING',
  !/API_KEY_MISSING/.test(operational));
check('…et nomme la vraie dépendance : la plateforme',
  /PANEL_NOT_PAIRED/.test(operational) && /capabilitiesAvailable/.test(operational));

const diagnostic = codeSeul(lire(BACKEND, 'src/services/email/emailDiagnostics.service.js'));
check('le diagnostic ne lit plus aucune clé Brevo',
  !/tryGetCredential|getCredential/.test(diagnostic));

/* ══ 8 · LE MANAGER N'ADMINISTRE PLUS RIEN ══════════════════════════════ */
section('8 · Manager');

const MANAGER = join(RACINE, 'manager');
check('la page IntegratedAPI est supprimée',
  !existsSync(join(MANAGER, 'src/pages/dev/DevIntegrationsPage.tsx')));

const app = codeSeul(lire(MANAGER, 'src/App.tsx'));
check('la route dev/integrations n’existe plus', !/dev\/integrations/.test(app));
check('…et son import paresseux non plus', !/DevIntegrationsPage/.test(app));

const nav = codeSeul(lire(MANAGER, 'src/config/nav.ts'));
check('aucune entrée de navigation Intégrations API',
  !/dev\/integrations/.test(nav) && !/Intégrations API/.test(nav));

const apiClient = codeSeul(lire(MANAGER, 'src/lib/api.ts'));
for (const verbe of [
  'listIntegrations', 'getIntegration', 'updateIntegrationMode',
  'deleteIntegrationMode', 'testIntegrationMode',
]) {
  check(`le client n’expose plus ${verbe}`, !new RegExp(`${verbe}\\s*:`).test(apiClient));
}

/**
 * LA CONFIGURATION MÉTIER N'A PAS ÉTÉ EMPORTÉE AVEC LA PAGE.
 *
 * `EmailConfigurationSection` vivait DANS la carte Brevo. Ce n'était pas de
 * l'administration de fournisseur — c'est le régime d'envoi et l'e-mail de
 * test, une fonction métier que rien d'autre ne rendait. La supprimer avec la
 * page aurait été une perte silencieuse, exactement ce qu'un audit doit éviter.
 */
const templates = lire(MANAGER, 'src/pages/dev/DevEmailTemplatesPage.tsx');
check('la configuration e-mail métier a été recueillie ailleurs',
  /<EmailConfigurationSection\s*\/>/.test(templates),
  'sinon la suppression de la page emporte une fonction sans remplaçant');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
