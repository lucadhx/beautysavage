/* Tests de la préparation guidée d'un contrat (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { deriveContractSetup, isNamed } = await import('./contractSetup.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const zone = (role) => ({
  id: `z-${role}`, name: '', signerRole: role, page: 1,
  xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE',
});

function contract(over = {}) {
  return {
    reference: 'CTR-2026-0001',
    name: '', // un contrat naît SANS nom : aucun pré-remplissage
    status: 'DRAFT',
    document: { hasOriginal: false, pageCount: 0 },
    signatureConfiguration: { zones: [], locked: false },
    pricing: { launchFee: { enabled: false }, subscription: { enabled: false } },
    ...over,
  };
}
const byKey = (s, k) => s.steps.find((x) => x.key === k);
const statusOf = (s, k) => byKey(s, k).status;

// --- Nommage ----------------------------------------------------------------
section('Étape 1 — nommer');
{
  check('nouveau contrat = pas encore nommé', !isNamed(contract()));
  check('nom vide = pas nommé', !isNamed(contract({ name: '' })));
  check('espaces seuls = pas nommé', !isNamed(contract({ name: '   ' })));
  check('nom personnalisé = nommé', isNamed(contract({ name: 'Contrat SB Auto 2026' })));
  // Plus aucune chaîne magique : le front ne compare plus le nom à un défaut
  // posé par le backend. Les contrats créés AVANT ce changement portent encore
  // « Contrat <référence> » — ils comptent comme nommés, et c'est voulu.
  check('ancien nom auto = nommé (rétro-compatibilité)', isNamed(contract({ name: 'Contrat CTR-2026-0001' })));
  check('nom = référence seule = nommé', isNamed(contract({ name: 'CTR-2026-0001' })));

  const s = deriveContractSetup(contract());
  check('6 étapes (le réglage de signature en fait partie)', s.steps.length === 6);
  check('nommer = étape courante', statusOf(s, 'NAME') === 'current');
  check('index courant = 0', s.currentIndex === 0);
  check('document verrouillé tant que non nommé', statusOf(s, 'DOCUMENT') === 'locked');
  check('zones verrouillées', statusOf(s, 'ZONES') === 'locked');
  check('validation verrouillée', statusOf(s, 'VALIDATE') === 'locked');
  check('validation impossible', !s.readyToValidate);
}

// --- Document ---------------------------------------------------------------
section('Étape 2 — document');
{
  const named = contract({ name: 'Contrat SB Auto' });
  const s = deriveContractSetup(named);
  check('nommer terminé (vert)', statusOf(s, 'NAME') === 'done');
  check('le nom devient le résumé', byKey(s, 'NAME').hint === 'Contrat SB Auto');
  check('document déverrouillé et courant', statusOf(s, 'DOCUMENT') === 'current');
  check('zones toujours verrouillées', statusOf(s, 'ZONES') === 'locked');
  check('tarification verrouillée sans PDF', statusOf(s, 'PRICING') === 'locked');

  const withPdf = deriveContractSetup(contract({ name: 'X', document: { hasOriginal: true, pageCount: 3 } }));
  check('document terminé', statusOf(withPdf, 'DOCUMENT') === 'done');
  check('résumé = nombre de pages', byKey(withPdf, 'DOCUMENT').hint === '3 page(s)');
  // Le PDF n'ouvre PAS les zones : on ne sait pas encore si ce contrat se
  // signe. La question passe avant la mise en œuvre de la réponse.
  check('le PDF ouvre la question de la signature', statusOf(withPdf, 'SIGNATURE') === 'current');
  check('…et surtout pas les zones', statusOf(withPdf, 'ZONES') === 'locked');
  check('la tarification attend son tour', statusOf(withPdf, 'PRICING') === 'locked');
}

// --- Zones ------------------------------------------------------------------
section('Étape 3 — zones');
{
  const base = { name: 'X', document: { hasOriginal: true, pageCount: 1 } };

  const partial = deriveContractSetup(contract({ ...base, signatureConfiguration: { zones: [zone('DEVELOPER')] } }));
  check('un seul rôle -> pas terminé', statusOf(partial, 'ZONES') === 'current');
  check('manque signalé', partial.steps.find((x) => x.key === 'ZONES').hint === 'Zone manquante pour un signataire');
  check('validation impossible', !partial.readyToValidate);

  const full = deriveContractSetup(contract({
    ...base, signatureConfiguration: { zones: [zone('DEVELOPER'), zone('CLIENT')] },
  }));
  check('les deux rôles -> terminé', statusOf(full, 'ZONES') === 'done');
  check('résumé = nombre de zones', byKey(full, 'ZONES').hint === '2 zone(s)');
  check('validation devient possible', full.readyToValidate);
  // Possible ≠ ouverte : la tarification n'a pas encore été traitée, et le
  // parcours ne saute pas par-dessus une étape sous prétexte qu'elle n'est pas
  // bloquante. La validation reste offerte (« optional »), jamais imposée.
  check('la tarification passe d’abord', statusOf(full, 'PRICING') === 'current');
  check('validation offerte, pas ouverte', statusOf(full, 'VALIDATE') === 'optional');
  check('index courant = tarification',
    full.currentIndex === full.steps.findIndex((x) => x.key === 'PRICING'));
}

// --- Tarification (non bloquante) -------------------------------------------
section('Étape 4 — tarification (facultative)');
{
  const ready = {
    name: 'X', document: { hasOriginal: true, pageCount: 1 },
    signatureConfiguration: { zones: [zone('DEVELOPER'), zone('CLIENT')] },
  };

  // « Aucun montant » n'est pas « étape non traitée » : un contrat gratuit est
  // légitime. Tant que personne ne l'a dit, la question reste posée.
  const free = deriveContractSetup(contract(ready));
  check('sans décision -> à traiter', statusOf(free, 'PRICING') === 'current');
  check('…et le résumé le dit', byKey(free, 'PRICING').hint === 'À définir');
  check('ne bloque JAMAIS la validation', free.readyToValidate);

  const gratuit = deriveContractSetup(contract(ready), { PRICING: true });
  check('gratuit confirmé -> terminée', statusOf(gratuit, 'PRICING') === 'done');
  check('mention « contrat gratuit »', byKey(gratuit, 'PRICING').hint === 'Contrat gratuit');

  const paid = deriveContractSetup(contract({
    ...ready, pricing: { launchFee: { enabled: true }, subscription: { enabled: false } },
  }));
  check('avec frais -> terminée', statusOf(paid, 'PRICING') === 'done');
  check('résumé des lignes', byKey(paid, 'PRICING').hint === 'frais de lancement');

  const both = deriveContractSetup(contract({
    ...ready, pricing: { launchFee: { enabled: true }, subscription: { enabled: true } },
  }));
  check('deux lignes résumées', byKey(both, 'PRICING').hint === 'frais de lancement + abonnement');
}

// --- Ordre imposé -----------------------------------------------------------
section('Ordre imposé');
{
  // Un PDF importé sans nom : le nom reste l'étape courante, mais le document
  // franchi ne « redevient » pas à faire — on n'efface pas un acquis.
  const s = deriveContractSetup(contract({ document: { hasOriginal: true, pageCount: 2 } }));
  check('nom encore courant', statusOf(s, 'NAME') === 'current');
  check('document déjà franchi reste vert', statusOf(s, 'DOCUMENT') === 'done');
  check('validation toujours bloquée', !s.readyToValidate);
  check('une seule étape courante à la fois', s.steps.filter((x) => x.status === 'current').length === 1);
}

// --- Ordre d'ouverture automatique ------------------------------------------
section('Ordre automatique — l’étape ouverte est la bonne');
{
  const ouverte = (s) => s.steps[s.currentIndex]?.key;
  const cles = (s) => s.steps.map((x) => x.key);
  const nomme = { name: 'Contrat de test' };
  const pdf = { document: { hasOriginal: true, pageCount: 2 } };

  // 1. PDF importé, aucune décision de signature.
  const apresPdf = deriveContractSetup(contract({ ...nomme, ...pdf }));
  check('1. après le PDF, c’est SIGNATURE qui s’ouvre', ouverte(apresPdf) === 'SIGNATURE');
  check('1. …et surtout PAS les zones', ouverte(apresPdf) !== 'ZONES');
  check('1. …les zones restent visibles mais VERROUILLÉES',
    cles(apresPdf).includes('ZONES') && statusOf(apresPdf, 'ZONES') === 'locked');
  check('1. …la validation reste verrouillée', statusOf(apresPdf, 'VALIDATE') === 'locked');

  // 2. SIGNATURE = REQUISE, confirmée par l'utilisateur.
  const requise = deriveContractSetup(contract({ ...nomme, ...pdf }), { SIGNATURE: true });
  check('2. signature confirmée « oui » → ZONES s’ouvre', ouverte(requise) === 'ZONES');
  check('2. …et l’étape signature est franchie', statusOf(requise, 'SIGNATURE') === 'done');

  // 3. SIGNATURE = NON REQUISE.
  const sans = deriveContractSetup(contract({ ...nomme, ...pdf, signatureApplicable: false }));
  check('3. signature « non » → TARIFICATION s’ouvre', ouverte(sans) === 'PRICING');
  check('3. …les zones ont disparu du parcours', !cles(sans).includes('ZONES'));
  check('3. …sans même avoir été confirmée : NOT_REQUIRED est déjà un choix',
    statusOf(sans, 'SIGNATURE') === 'done');

  // 4. ZONES terminées.
  const zonesFaites = deriveContractSetup(
    contract({ ...nomme, ...pdf, signatureConfiguration: { version: 1, versionCount: 1, locked: false, signers: [], zones: [zone('DEVELOPER'), zone('CLIENT')] } }),
  );
  check('4. zones terminées → TARIFICATION s’ouvre', ouverte(zonesFaites) === 'PRICING');
  check('4. …et la signature compte comme décidée (des zones existent)',
    statusOf(zonesFaites, 'SIGNATURE') === 'done');

  // 5. TARIFICATION terminée (un montant existe).
  const tarifee = deriveContractSetup(contract({
    ...nomme, ...pdf,
    signatureApplicable: false,
    pricing: { launchFee: { enabled: true, amountExcludingTax: 50000 }, subscription: { enabled: false, amountExcludingTax: 0 } },
  }));
  check('5. tarification faite → VALIDATION s’ouvre', ouverte(tarifee) === 'VALIDATE');
  check('5. …et elle est bien courante', statusOf(tarifee, 'VALIDATE') === 'current');

  // 5 bis. Contrat GRATUIT : la tarification se confirme, sans montant.
  const gratuit = deriveContractSetup(
    contract({ ...nomme, ...pdf, signatureApplicable: false }), { PRICING: true },
  );
  check('5b. contrat gratuit confirmé → VALIDATION s’ouvre', ouverte(gratuit) === 'VALIDATE');
  check('5b. …la tarification est franchie', statusOf(gratuit, 'PRICING') === 'done');

  // 6. La validation ne s'ouvre JAMAIS avant la tarification.
  check('6. tarification non traitée → VALIDATION n’est pas ouverte',
    ouverte(sans) !== 'VALIDATE' && statusOf(sans, 'VALIDATE') !== 'current');
  check('6. …même quand rien ne l’empêche métier',
    deriveContractSetup(contract({ ...nomme, ...pdf, signatureApplicable: false })).readyToValidate === true);
  check('6. …et le parcours pointe bien la tarification', ouverte(sans) === 'PRICING');

  // 7. Réouverture d'un brouillon : la 1ʳᵉ étape incomplète réellement applicable.
  const rouvert = deriveContractSetup(contract({
    ...nomme, ...pdf,
    signatureConfiguration: { version: 1, versionCount: 1, locked: false, signers: [], zones: [zone('DEVELOPER')] },
  }));
  check('7. brouillon rouvert → reprend aux zones incomplètes', ouverte(rouvert) === 'ZONES');
  check('7. …sans redemander la signature (des zones existent déjà)',
    statusOf(rouvert, 'SIGNATURE') === 'done');
  const rouvertVierge = deriveContractSetup(contract({ ...nomme, ...pdf }));
  check('7. …un brouillon sans trace reprend à la signature',
    ouverte(rouvertVierge) === 'SIGNATURE');

  // 8. Rien d'incohérent quand tout est fait.
  const complet = deriveContractSetup(contract({
    ...nomme, ...pdf,
    signatureConfiguration: { version: 1, versionCount: 1, locked: false, signers: [], zones: [zone('DEVELOPER'), zone('CLIENT')] },
    pricing: { launchFee: { enabled: true, amountExcludingTax: 50000 }, subscription: { enabled: false, amountExcludingTax: 0 } },
  }));
  check('8. parcours complet → VALIDATION, et rien d’autre', ouverte(complet) === 'VALIDATE');
  check('8. …une seule étape courante', complet.steps.filter((x) => x.status === 'current').length === 1);
  check('8. …aucune étape verrouillée en arrière',
    complet.steps.slice(0, -1).every((x) => x.status === 'done'));

  // L'ordre lui-même, du début à la fin.
  check('l’ordre est document → signature → zones → tarification → validation',
    cles(complet).join('>') === 'NAME>DOCUMENT>SIGNATURE>ZONES>PRICING>VALIDATE');
  check('…et sans signature : document → signature → tarification → validation',
    cles(sans).join('>') === 'NAME>DOCUMENT>SIGNATURE>PRICING>VALIDATE');
}

// --- Robustesse -------------------------------------------------------------
section('Robustesse');
{
  const s = deriveContractSetup({ reference: 'CTR-1', name: '' });
  check('payload minimal toléré', s.steps.length === 6 && s.currentIndex === 0);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
