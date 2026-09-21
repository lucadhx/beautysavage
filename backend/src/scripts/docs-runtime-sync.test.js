/**
 * LA DOCUMENTATION DÉCRIT-ELLE ENCORE LE RUNTIME ? — garde du lot documentaire.
 *
 * ══ CE QU'ELLE VERROUILLE, ET CE QU'ELLE NE VERROUILLE PAS ═════════════════
 *
 * Elle ne compare PAS des phrases : une garde fondée sur des formulations
 * exactes casse au premier reformatage, on la neutralise, et elle ne protège
 * plus rien. Elle vérifie deux choses vérifiables :
 *
 *   1. les documents d'AUTORITÉ existent et se citent entre eux — un lecteur
 *      perdu doit tomber sur le bon document, pas sur un rapport de 2026-07 ;
 *   2. aucun document ACTIF ne présente comme courante une architecture
 *      supprimée. Les rapports historiques ont le droit d'en parler : c'est
 *      leur objet. Ils doivent seulement le DIRE, par un bandeau.
 *
 * ══ POURQUOI CETTE DISTINCTION EST TOUT LE SUJET ═══════════════════════════
 *
 * Une documentation périmée ne se signale jamais. Elle est lue avec confiance,
 * pendant un incident, par quelqu'un qui n'a pas le temps de vérifier — et elle
 * envoie réparer une chose qui n'existe plus. Effacer l'histoire serait pire :
 * on perdrait la raison des décisions. La règle est donc l'étiquetage, pas la
 * suppression.
 *
 * Lancement : node src/scripts/docs-runtime-sync.test.js
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

import { PROVIDER_VALUES, isPanelAuthority } from '../utils/integratedApiCatalog.js';

const RACINE = fileURLToPath(new URL('../../..', import.meta.url));
const DOCS = join(RACINE, 'docs');

let pass = 0;
let fail = 0;
function check(nom, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`); }
}
const section = (n) => console.log(`\n${n}`);
const lire = (p) => readFileSync(p, 'utf8');

function tousLesDocs(dir = DOCS) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...tousLesDocs(p)); continue; }
    if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/* ══ 1 · LES AUTORITÉS EXISTENT ═════════════════════════════════════════ */
section('1 · Documents d’autorité');

const AUTORITES = {
  'README.md': 'index — START HERE',
  'ARCHITECTURE.md': 'architecture',
  'PROTOCOL.md': 'exploitation',
  'PANEL_BRIDGE.md': 'pont Panel',
  'INTEGRATED_API.md': 'fournisseurs',
};
for (const [f, role] of Object.entries(AUTORITES)) {
  check(`${f} existe (${role})`, existsSync(join(DOCS, f)));
}

const index = lire(join(DOCS, 'README.md'));
for (const f of Object.keys(AUTORITES)) {
  if (f === 'README.md') continue;
  check(`l’index renvoie vers ${f}`, index.includes(f));
}

/* ══ 2 · LE PONT EST DOCUMENTÉ, ET SA RÈGLE DE MAINTENANCE POSÉE ═══════ */
section('2 · Panel Bridge');

const pont = lire(join(DOCS, 'PANEL_BRIDGE.md'));
const protocole = lire(join(DOCS, 'PROTOCOL.md'));

/*
 * La demande explicite du lot : le pont est documenté, ET le protocole impose
 * de mettre cette documentation à jour quand le pont change. Sans la seconde
 * moitié, la première périme en silence — c'est exactement le défaut que ce
 * fichier existe pour empêcher.
 */
check('le protocole impose la mise à jour du pont',
  /PANEL_BRIDGE\.md/.test(protocole) && /MÊME LOT/i.test(protocole),
  'la règle de maintenance du pont a disparu du protocole');
check('…et le pont renvoie vers cette règle',
  /PROTOCOL\.md/.test(pont) && /maintenance/i.test(pont));

for (const sujet of ['hydratePairing', 'CONTRACT_VERSION', 'outbox', 'capabilit', 'heartbeat']) {
  check(`le pont documente « ${sujet} »`, new RegExp(sujet, 'i').test(pont));
}

/**
 * LA VERSION DU CONTRAT EST LUE DANS LE CODE, PAS RECOPIÉE ICI.
 *
 * Une version écrite en dur dans le test ne prouverait rien : elle dirait
 * seulement que deux constantes se ressemblent. On compare la documentation à
 * la SOURCE.
 */
const contratSrc = lire(join(RACINE, 'backend/src/services/panelBridge/bridgeContract.js'));
const version = /CONTRACT_VERSION\s*=\s*'([^']+)'/.exec(contratSrc)?.[1];
check('la version de contrat documentée est celle du code',
  Boolean(version) && pont.includes(version), `code = ${version}`);

/* ══ 3 · LA DOCTRINE FOURNISSEUR SUIT LE CATALOGUE ═════════════════════ */
section('3 · Autorité des fournisseurs');

const integrated = lire(join(DOCS, 'INTEGRATED_API.md'));
for (const p of PROVIDER_VALUES) {
  check(`${p} est cité dans la doctrine`, integrated.includes(p));
}
check('le code place bien les quatre sous autorité PANEL',
  PROVIDER_VALUES.every(isPanelAuthority));
check('…et la documentation le dit',
  /authority = PANEL/i.test(integrated) || /autorité Panel/i.test(integrated));
check('l’exception Stripe est NOMMÉE et justifiée',
  /webhookSecret/.test(integrated) && /aucun appel/i.test(integrated),
  'une exception non expliquée se lit comme un oubli');

/* ══ 4 · AUCUN DOCUMENT ACTIF NE DÉCRIT UNE ARCHITECTURE SUPPRIMÉE ═════ */
section('4 · Architectures supprimées');

/** Marqueurs d'architectures réellement retirées du produit. */
const DISPARU = [
  { motif: /\/dev\/integrations/, quoi: 'page IntegratedAPI du Manager' },
  { motif: /BREVO\.apiKey/, quoi: 'clé Brevo locale' },
  { motif: /api\.brevo\.com/, quoi: 'appel direct Brevo' },
  { motif: /webhooks\/brevo\/transactional/, quoi: 'webhook Brevo local' },
  { motif: /brevoWebhookConfig/, quoi: 'service de configuration webhook Brevo' },
];

/** Un document se déclare historique/périmé par un bandeau en tête. */
const estEtiquete = (texte) => /RAPPORT HISTORIQUE|ARCHITECTURE SUPPRIMÉE|PARTIELLEMENT OBSOLÈTE/.test(
  texte.slice(0, 1400),
);

const fautifs = [];
for (const chemin of tousLesDocs()) {
  const rel = relative(RACINE, chemin).split(sep).join('/');
  /* Références fournisseur externes : elles DOIVENT parler de l'API du fournisseur. */
  if (rel.includes('docs/yousign/') || rel.includes('docs/Brevo/')) continue;
  const texte = lire(chemin);
  if (estEtiquete(texte)) continue;
  for (const { motif, quoi } of DISPARU) {
    if (!motif.test(texte)) continue;
    /* Un document d'autorité a le droit de NOMMER ce qui a disparu pour le dire. */
    if (/n’existe plus|n'existe plus|n’existent plus|n'existent plus|a disparu|supprimé/i.test(texte)) continue;
    fautifs.push(`${rel} : ${quoi}`);
  }
}
check('aucun document actif ne présente une architecture supprimée comme courante',
  fautifs.length === 0, fautifs.join('\n      '));

/* ══ 5 · LES AUTORITÉS NE SE CONTREDISENT PAS ══════════════════════════ */
section('5 · Cohérence entre autorités');

const archi = lire(join(DOCS, 'ARCHITECTURE.md'));
check('l’architecture renvoie au protocole et au pont',
  /PROTOCOL\.md/.test(archi) && /PANEL_BRIDGE\.md/.test(archi));
check('l’architecture documente l’ordre de démarrage',
  ['CORE', 'PANEL', 'INTEGRATED APIs', 'REPRISES', 'BACKGROUND SERVICES', 'API PRÊTE']
    .every((s) => archi.includes(s)));
check('…et la doctrine de propriété du déploiement',
  /appartient au backend/i.test(archi));
check('le protocole documente les mêmes sections de démarrage',
  ['CORE', 'PANEL', 'INTEGRATED APIs', 'REPRISES', 'API PRÊTE']
    .every((s) => protocole.includes(s)));

/*
 * L'HONNÊTETÉ SUR `npm test` FAIT PARTIE DU CONTRAT DOCUMENTAIRE.
 *
 * Prétendre une suite verte qui ne l'est pas fait perdre plus de temps qu'une
 * absence de documentation : on cherche la régression qu'on vient d'introduire
 * dans un rouge qui préexistait.
 */
check('le protocole dit la vérité sur npm test',
  /npm test/.test(protocole) && /préexistant/i.test(protocole));

/* ══ 6 · LES LIENS INTERNES POINTENT QUELQUE PART ══════════════════════ */
section('6 · Liens internes');

const casses = [];
for (const chemin of tousLesDocs()) {
  const texte = lire(chemin);
  const dossier = join(chemin, '..');
  for (const m of texte.matchAll(/\[[^\]]+\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    /*
      UN LIEN PEUT ÊTRE PERCENT-ENCODÉ, ET C'EST DU MARKDOWN VALIDE.

      Un chemin contenant une espace ou un accent — `Controle qualité/…` — ne
      peut PAS s'écrire nu dans un lien markdown : la parenthèse fermante se
      lit à la première espace. La forme correcte est l'encodage, et le
      contrôleur le refusait comme un document absent.

      Un vérificateur de liens qui ne sait pas lire un lien valide produit des
      fausses alertes, et une fausse alerte dans une garde finit par la faire
      ignorer entièrement. `decodeURIComponent` échoue sur une séquence `%`
      invalide : on retombe alors sur la chaîne brute plutôt que de lever.
    */
    let cible = m[1];
    if (/^https?:/.test(cible)) continue;
    try { cible = decodeURIComponent(cible); } catch { /* chemin non encodé */ }
    if (!existsSync(join(dossier, cible))) {
      casses.push(`${relative(RACINE, chemin).split(sep).join('/')} → ${cible}`);
    }
  }
}
check('aucun lien markdown ne pointe vers un document absent',
  casses.length === 0, casses.slice(0, 12).join('\n      '));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
