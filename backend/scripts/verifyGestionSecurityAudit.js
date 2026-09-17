import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function expectMatch(content, pattern, message, failures) {
  if (!pattern.test(content)) {
    failures.push(message);
  }
}

function expectIncludes(content, text, message, failures) {
  if (!content.includes(text)) {
    failures.push(message);
  }
}

function verifyStrictDevRouter(relativePath, failures) {
  const content = readProjectFile(relativePath);
  expectIncludes(
    content,
    "import { requireStrictDev } from '../middlewares/requireDev.js';",
    `${relativePath}: import requireStrictDev manquant`,
    failures
  );
  expectMatch(
    content,
    /(router|gestionRouter)\.use\(requireAuth\(\),\s*requireMode\('gestion'\),\s*requireStrictDev\);|(router|gestionRouter)\.use\(requireAuth\(\),\s*requireStrictDev\);/,
    `${relativePath}: garde strict dev manquant`,
    failures
  );
}

function verifyAdminRouter(relativePath, failures) {
  const content = readProjectFile(relativePath);
  expectIncludes(
    content,
    "router.use(requireAuth(), requireMode('gestion'), requireDev);",
    `${relativePath}: le guard admin/dev attendu a disparu`,
    failures
  );
}

function verifyBlockedModules(relativePath, failures) {
  const content = readProjectFile(relativePath);
  const expectedModules = [
    'naviguationGestion',
    'userTestManager',
    'naviguationVitrine',
    'userManager',
    'commission',
    'monthlyCommissionInvoices',
    'mailTemplateEditor',
    'siteStatus',
    'themeManager',
    'uiConfigManager'
  ];
  for (const moduleName of expectedModules) {
    expectIncludes(
      content,
      `'${moduleName}'`,
      `${relativePath}: module bloque manquant (${moduleName})`,
      failures
    );
  }
}

function verifyHomepageDiscountAudit(failures) {
  const homeModule = readProjectFile('public/js/modules/homeModule.js');
  const highlightsController = readProjectFile('controllers/vitrineShopController.js');
  const appCss = readProjectFile('public/css/app.css');

  expectMatch(
    homeModule,
    /kind === 'product'[\s\S]*finalPrice < basePrice/,
    'homeModule: condition produit remisé absente',
    failures
  );
  expectIncludes(
    homeModule,
    'home-premium-boost-card__price-old',
    'homeModule: markup prix barre absent',
    failures
  );
  expectIncludes(
    homeModule,
    'home-premium-boost-card__price-new',
    'homeModule: markup prix remisé absent',
    failures
  );
  expectIncludes(
    highlightsController,
    'price: prices.price',
    'vitrineShopController: prix de base absent du payload highlights',
    failures
  );
  expectIncludes(
    highlightsController,
    'finalPrice: prices.finalPrice',
    'vitrineShopController: prix final absent du payload highlights',
    failures
  );
  expectIncludes(
    appCss,
    'text-decoration: line-through;',
    'app.css: style line-through absent pour le prix barre',
    failures
  );
}

const failures = [];

const strictDevRouters = [
  'routers/commissionRouter.js',
  'routers/gestionPagesRouter.js',
  'routers/mailTemplateRouter.js',
  'routers/vitrineGestionRouter.js',
  'routers/gestionUsersRouter.js',
  'routers/devRouter.js',
  'routers/uiConfigRouter.js',
  'routers/siteStatusRouter.js'
];

for (const relativePath of strictDevRouters) {
  verifyStrictDevRouter(relativePath, failures);
}

const adminRouters = [
  'routers/formationRouter.js',
  'routers/formationSessionRouter.js',
  'routers/salesRouter.js',
  // Thème vitrine géré par les admins (requireDev = admin+dev) depuis l'espace Paramètres.
  'routers/themeRouter.js'
];

for (const relativePath of adminRouters) {
  verifyAdminRouter(relativePath, failures);
}

verifyBlockedModules('controllers/vitrineGestionController.js', failures);
verifyBlockedModules('controllers/gestionPagesController.js', failures);
verifyBlockedModules('public/js/gestion.js', failures);

const appJs = readProjectFile('app.js');
expectIncludes(
  appJs,
  "app.use('/api/gestion', requireGestionRole());",
  "app.js: requireGestionRole() manquant sur /api/gestion",
  failures
);

verifyHomepageDiscountAudit(failures);

if (failures.length) {
  console.error('Audit securite gestion: ECHEC');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Audit securite gestion: OK');
