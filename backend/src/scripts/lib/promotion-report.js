/**
 * Construction et écriture des rapports de migration (JSON + Markdown).
 * Aucun secret n'est inclus : les hash de mots de passe, l'URI Mongo et le JWT
 * ne sont jamais lus ni écrits ici. Le scan de secrets ne rapporte que des
 * chemins de champs, jamais des valeurs.
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { REPORTS_DIR, BACKEND_ROOT } from './promotion-core.js';

const rel = (p) => path.relative(BACKEND_ROOT, p).replace(/\\/g, '/');

/** Écrit les deux rapports et retourne leurs chemins relatifs. */
export async function writeReports(report, stamp) {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const jsonFile = path.join(REPORTS_DIR, `test-to-prod-${stamp}.json`);
  const mdFile = path.join(REPORTS_DIR, `test-to-prod-${stamp}.md`);
  await fsp.writeFile(jsonFile, JSON.stringify(report, null, 2), 'utf8');
  await fsp.writeFile(mdFile, renderMarkdown(report), 'utf8');
  return { jsonFile: rel(jsonFile), mdFile: rel(mdFile) };
}

const ok = (b) => (b ? '✅' : '❌');

export function renderMarkdown(r) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push(`# Rapport de migration TEST → PROD`);
  push('');
  push(`- **Date** : ${r.date}`);
  push(`- **Mode** : \`${r.mode}\``);
  push(`- **Source** : \`${r.source}\``);
  push(`- **Destination** : \`${r.destination}\``);
  push(`- **Résultat** : ${r.success ? '✅ SUCCÈS' : '❌ ÉCHEC'}`);
  push('');

  // Collections
  push(`## Collections (${r.collections.length})`);
  push('');
  push('| Collection | Source | PROD avant | Copiés | PROD après | Index | Statut |');
  push('|---|---:|---:|---:|---:|---:|:---:|');
  for (const c of r.collections) {
    const matched = c.destAfter === c.sourceCount;
    push(
      `| ${c.name} | ${c.sourceCount} | ${c.destBefore ?? '-'} | ${c.copied ?? c.wouldCopy ?? 0} | ` +
        `${c.destAfter} | ${c.indexesCreated ?? c.wouldCreateIndexes ?? 0} | ${ok(matched)} |`
    );
  }
  push('');

  // Empreintes / parité
  if (r.parity) {
    push(`## Parité TEST / PROD`);
    push('');
    push(`Empreinte globale TEST : \`${r.parity.testGlobal || 'n/a'}\``);
    push(`Empreinte globale PROD : \`${r.parity.prodGlobal || 'n/a'}\``);
    push('');
    push('| Collection | Empreinte |');
    push('|---|:---:|');
    for (const [name, res] of Object.entries(r.parity.perCollection || {})) {
      push(`| Collection ${name} | ${res.match ? 'MATCH' : 'MISMATCH'} |`);
    }
    push('');
  }

  // TEST inchangée
  if (r.testUntouched) {
    push(`## Base TEST`);
    push('');
    push(`Base TEST inchangée : **${r.testUntouched.unchanged ? 'OUI' : 'NON'}**`);
    push(`- Empreinte avant : \`${r.testUntouched.before}\``);
    push(`- Empreinte après : \`${r.testUntouched.after}\``);
    push('');
  }

  // Singletons
  if (r.integrity?.singletons) {
    push(`## Singletons`);
    push('');
    push('| Singleton | Documents | OK |');
    push('|---|---:|:---:|');
    for (const [name, count] of Object.entries(r.integrity.singletons)) {
      push(`| ${name} | ${count} | ${ok(count === 1)} |`);
    }
    push('');
  }

  // Comptes
  if (r.integrity?.accounts) {
    const a = r.integrity.accounts;
    push(`## Comptes`);
    push('');
    push(`- Total : ${a.total}`);
    for (const [role, n] of Object.entries(a.byRole || {})) push(`- ${n} ${role}`);
    // LOT 2C — on rend compte des RÔLES présents, jamais d'adresses attendues :
    // aucune adresse n'est « attendue » dans un parc où chaque projet a la sienne.
    for (const [role, s] of Object.entries(a.expected || {})) {
      push(`- rôle ${role} : présent ${ok(s.present)} (${s.count} compte(s))`);
    }
    push('');
    push(`> Aucun hash de mot de passe n'est lu ni affiché.`);
    push('');
  }

  // Uploads
  if (r.uploads) {
    const u = r.uploads;
    push(`## Uploads (fichiers locaux)`);
    push('');
    push(`- Dossier : \`${u.uploadsDir}\``);
    push(`- Référencés en base : ${u.referencedCount}`);
    push(`- Présents physiquement : ${u.presentCount} / ${u.referencedCount}`);
    push(`- Fichiers sur disque : ${u.physicalCount}`);
    push(`- Références cassées (manquants) : ${u.missing.length}`);
    push(`- Orphelins (non référencés) : ${u.orphans.length}`);
    if (u.missing.length) {
      push('');
      push(`**Références cassées :**`);
      for (const f of u.missing) push(`- \`${f}\``);
    }
    push('');
    push(`> Manifest des fichiers à déployer : \`${u.manifestFile || 'migration-reports/uploads-manifest.json'}\``);
    push('');
  }

  // URLs risquées
  push(`## URLs localhost / ngrok détectées (${r.riskyUrls?.length || 0})`);
  push('');
  if (!r.riskyUrls?.length) {
    push('Aucune URL localhost/ngrok détectée.');
  } else {
    push('> Ces URL ont été copiées **telles quelles**. Elles doivent être remplacées avant déploiement PROD (voir configuration réseau).');
    push('');
    push('| Collection | Champ | Valeur |');
    push('|---|---|---|');
    for (const u of r.riskyUrls.slice(0, 100)) {
      push(`| ${u.collection} | \`${u.field}\` | ${u.value} |`);
    }
    if (r.riskyUrls.length > 100) push(`| … | … | (+${r.riskyUrls.length - 100} autres) |`);
  }
  push('');

  // Configuration réseau
  if (r.network) {
    push(`## Configuration réseau`);
    push('');
    push('Configuration réseau copiée depuis TEST.');
    push('À remplacer avant déploiement si elle contient localhost ou ngrok.');
    push('');
    push('| Clé | Valeur (TEST) | À remplacer |');
    push('|---|---|:---:|');
    for (const [k, v] of Object.entries(r.network)) {
      const risky = /(localhost|127\.0\.0\.1|ngrok)/i.test(String(v));
      push(`| ${k} | ${v} | ${risky ? '⚠️ OUI' : 'non'} |`);
    }
    push('');
  }

  // Secrets
  push(`## Scan de secrets potentiels (${r.secretFields?.length || 0})`);
  push('');
  if (!r.secretFields?.length) {
    push('Aucun champ suspect détecté.');
  } else {
    push('> Chemins de champs uniquement — **aucune valeur n\'est affichée**.');
    push('');
    push('| Collection | Champ | Attendu (safe) |');
    push('|---|---|:---:|');
    for (const s of r.secretFields) {
      push(`| ${s.collection} | \`${s.field}\` | ${s.knownSafe ? 'oui (hash bcrypt)' : '⚠️ à vérifier'} |`);
    }
  }
  push('');

  // Intégrité
  if (r.integrity) {
    push(`## Contrôle d'intégrité`);
    push('');
    push(`- Références cassées : ${r.integrity.brokenRefs?.length || 0}`);
    push(`- Doublons (index uniques) : ${r.integrity.duplicates?.length || 0}`);
    push(`- Erreurs : ${r.integrity.errors?.length || 0}`);
    push(`- Avertissements : ${r.integrity.warnings?.length || 0}`);
    if (r.integrity.errors?.length) {
      push('');
      push('**Erreurs :**');
      for (const e of r.integrity.errors) push(`- ❌ ${e}`);
    }
    if (r.integrity.warnings?.length) {
      push('');
      push('**Avertissements :**');
      for (const w of r.integrity.warnings) push(`- ⚠️ ${w}`);
    }
    push('');
  }

  // Backup
  if (r.backup) {
    push(`## Sauvegarde PROD (avant migration)`);
    push('');
    push(`- Fichier : \`${r.backup.file}\``);
    push(`- Collections sauvegardées : ${r.backup.collections}`);
    push('');
  }

  // Avertissements globaux
  if (r.warnings?.length) {
    push(`## Avertissements`);
    push('');
    for (const w of r.warnings) push(`- ⚠️ ${w}`);
    push('');
  }

  // Points à configurer avant VPS
  if (r.beforeVps?.length) {
    push(`## À configurer avant déploiement VPS`);
    push('');
    for (const b of r.beforeVps) push(`- [ ] ${b}`);
    push('');
  }

  push(`---`);
  push(`_Rapport généré automatiquement par \`promote-test-to-prod\`. Ne contient aucun secret._`);
  return lines.join('\n');
}
