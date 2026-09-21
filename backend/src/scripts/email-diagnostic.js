/**
 * Diagnostic e-mail AUTONOME — `npm run email:diagnostic`.
 *
 * Se connecte à la base, lance TOUS les contrôles du pipeline Brevo (config,
 * webhook distant, réception, corrélation), applique le processus par élimination,
 * imprime un rapport lisible et l'écrit dans `backend/logs/`.
 *
 * Options (arguments CLI) :
 *   --mode=TEST|PROD   mode à diagnostiquer (défaut : mode Brevo actif)
 *   --live             envoie un VRAI e-mail de test et attend le webhook
 *   --recipient=a@b.fr destinataire du test live (défaut : adresse support)
 *   --wait=20000       attente (ms) du webhook après l'envoi live
 *
 * AUCUNE variable d'environnement de debug à poser : l'outil produit tout.
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { bootstrap } from '../config/bootstrap.js';
import { runEmailDiagnostics, formatDiagnosticReport } from '../services/email/emailDiagnostics.service.js';
import { writeDiagnosticReport } from '../utils/diagnosticReport.js';
import { logger } from '../utils/logger.js';

function arg(name, fallback = undefined) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

async function main() {
  await connectDatabase();
  // Bootstrap léger : garantit les singletons/migrations sans démarrer le serveur.
  await bootstrap();

  const mode = typeof arg('mode') === 'string' ? String(arg('mode')).toUpperCase() : undefined;
  const live = Boolean(arg('live', false));
  const recipient = typeof arg('recipient') === 'string' ? arg('recipient') : null;
  const waitMs = Number(arg('wait', 20_000)) || 20_000;

  if (live) logger.info(`Diagnostic e-mail (LIVE, envoi réel) — mode ${mode || 'actif'}…`);
  else logger.info(`Diagnostic e-mail (lecture seule) — mode ${mode || 'actif'}…`);

  const report = await runEmailDiagnostics({ mode, liveTest: live, recipient, waitMs });
  const human = formatDiagnosticReport(report);
  console.log(`\n${human}\n`);

  const { jsonPath, logPath } = await writeDiagnosticReport(report, human);
  logger.success(`Rapport écrit :`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${logPath}`);

  await disconnectDatabase();
  // Code de sortie non nul si le verdict n'est pas sain (utile en CI/scripts).
  process.exit(report.verdict.code === 'HEALTHY' || report.verdict.code === 'AWAITING_CONFIRMATION' ? 0 : 1);
}

main().catch(async (err) => {
  logger.error('Diagnostic e-mail échoué', err?.stack || err?.message || err);
  try { await disconnectDatabase(); } catch { /* ignore */ }
  process.exit(2);
});
