import 'dotenv/config';
import mongoose from 'mongoose';

// Migration idempotente des thèmes vers le modèle multi-scope (T1).
// - dry-run par défaut ; `--apply` pour écrire.
// - documents legacy sans `scope` → scope 'vitrine'.
// - garantit au plus 1 thème actif par scope (garde le plus récent, désactive les autres).
// - crée un thème 'manager' actif par défaut s'il n'en existe aucun (depuis defaultPanelTheme).
// - ne désactive jamais le thème vitrine actif existant (seul un doublon de scope est désactivé).
//
// Usage CLI : node scripts/migrateThemesToScopes.js [--apply]
// Programmatique (tests) : migrateThemesToScopes({ apply, logger }) sur une connexion mongoose ouverte.

// Couleurs alignées sur frontend-react defaultPanelTheme (bleu/ardoise, distinct vitrine).
export const MANAGER_DEFAULT = {
  baseName: 'Panel Manager (defaut)',
  colors: {
    primary: '#2563eb',
    secondary: '#7c3aed',
    background: '#f1f5f9',
    surface: '#ffffff',
    text: '#0f172a'
  },
  derivedTokens: { surfaceHeader: null, accent: '#0ea5e9', accentStrong: null }
};

function effectiveScope(doc) {
  return doc.scope === 'manager' ? 'manager' : 'vitrine'; // legacy/absent → vitrine
}

function recencyKey(doc) {
  return new Date(doc.updatedAt || doc.createdAt || 0).getTime();
}

const noopLogger = { log: () => {} };

/** Exécute la migration sur la connexion mongoose courante. Renvoie le plan + ce qui a été appliqué. */
export async function migrateThemesToScopes({ apply = false, logger = noopLogger } = {}) {
  const themes = mongoose.connection.collection('themes');
  const docs = await themes.find().toArray();
  logger.log(`[migrateThemesToScopes] ${docs.length} theme(s) trouve(s). mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const plan = { setScopeVitrine: [], deactivate: [], createManager: false };

  // 1) Legacy sans scope → vitrine.
  for (const doc of docs) {
    if (doc.scope !== 'vitrine' && doc.scope !== 'manager') plan.setScopeVitrine.push(doc._id);
  }

  // 2) Au plus 1 actif par scope (garde le plus récent).
  for (const scope of ['vitrine', 'manager']) {
    const actives = docs.filter((d) => d.isActive && effectiveScope(d) === scope);
    if (actives.length <= 1) continue;
    actives.sort((a, b) => recencyKey(b) - recencyKey(a));
    for (const extra of actives.slice(1)) plan.deactivate.push(extra._id);
    logger.log(`[migrateThemesToScopes] scope=${scope} : ${actives.length} actifs → garde le plus récent.`);
  }

  // 3) Thème manager actif manquant → création.
  const hasManagerActive = docs.some((d) => d.isActive && effectiveScope(d) === 'manager');
  if (!hasManagerActive) plan.createManager = true;

  logger.log('[migrateThemesToScopes] plan :', {
    setScopeVitrine: plan.setScopeVitrine.length,
    deactivate: plan.deactivate.length,
    createManager: plan.createManager
  });

  if (!apply) return { plan, applied: false, createdManagerName: null };

  // Ordre : désactiver d'abord (évite tout conflit d'index unique partiel), puis fixer les scopes.
  if (plan.deactivate.length) {
    await themes.updateMany({ _id: { $in: plan.deactivate } }, { $set: { isActive: false } });
  }
  if (plan.setScopeVitrine.length) {
    await themes.updateMany({ _id: { $in: plan.setScopeVitrine } }, { $set: { scope: 'vitrine' } });
  }
  let createdManagerName = null;
  if (plan.createManager) {
    let name = MANAGER_DEFAULT.baseName;
    let suffix = 1;
    while (await themes.findOne({ name })) {
      suffix += 1;
      name = `${MANAGER_DEFAULT.baseName} ${suffix}`;
    }
    const now = new Date();
    await themes.insertOne({
      name,
      scope: 'manager',
      colors: MANAGER_DEFAULT.colors,
      derivedTokens: MANAGER_DEFAULT.derivedTokens,
      logoUrl: '',
      slogan: '',
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    createdManagerName = name;
    logger.log(`[migrateThemesToScopes] theme manager actif cree : "${name}".`);
  }

  logger.log('[migrateThemesToScopes] APPLY termine.');
  return { plan, applied: true, createdManagerName };
}

async function runCli() {
  const apply = process.argv.includes('--apply');
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  try {
    await migrateThemesToScopes({ apply, logger: console });
    if (!apply) console.log('[migrateThemesToScopes] DRY-RUN : aucune ecriture. Relancer avec --apply.');
  } finally {
    await mongoose.disconnect();
  }
}

// Exécution CLI uniquement quand le script est lancé directement (pas à l'import depuis les tests).
if (process.argv[1] && process.argv[1].includes('migrateThemesToScopes')) {
  runCli().catch((error) => {
    console.error('[migrateThemesToScopes] echec :', error);
    process.exit(1);
  });
}
