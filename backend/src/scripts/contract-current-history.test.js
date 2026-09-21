/**
 * LE CONTRAT ACTUEL N'EST PAS LE PLUS RÉCENT.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * La projection choisissait « le contrat ACTIF, et à défaut le plus récemment
 * modifié ». Ce « à défaut » envoyait au Panel un contrat RÉSILIÉ comme s'il
 * était en vigueur : la fiche affichait son abonnement, ses frais de mise en
 * service, son activation, sa signature et son document — le tout sous une
 * pastille « Contrat terminé ».
 *
 * La règle de partage est ici une fonction PURE : elle se teste sans base, sans
 * réseau, cas par cas.
 */
process.env.ENV = 'TEST';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/inutilise';
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4138';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { selectCurrentAndPreviousContracts, estTermine } = await import(
  '../services/projectBridge/contractSelection.js'
);
const { CONTRACT_STATUS } = await import('../utils/contractConstants.js');

const contrat = (status, { id = status, updatedAt = '2026-01-01T00:00:00.000Z', endedAt = null, archived = false } = {}) => ({
  _id: id,
  status,
  archived,
  reference: `CTR-${id}`,
  updatedAt,
  createdAt: '2025-01-01T00:00:00.000Z',
  // Le chemin RÉEL de la projection lisible de l'abonnement.
  stripe: { subscription: { endedAt } },
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Un contrat ACTIVE est le contrat actuel');
{
  const { current, previous } = selectCurrentAndPreviousContracts([contrat(CONTRACT_STATUS.ACTIVE)]);
  check('il est retenu comme courant', current?.status === CONTRACT_STATUS.ACTIVE);
  check('…et l’histoire est vide', previous.length === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. ACTIVE puis résilié : plus AUCUN contrat actuel');
{
  // Le cas réel : le contrat vient d'être résilié, il est donc le plus
  // récemment modifié de tous.
  const resilie = contrat(CONTRACT_STATUS.ENDED, {
    id: 'resilie',
    updatedAt: '2026-08-04T10:00:00.000Z',
    endedAt: '2026-08-04T10:00:00.000Z',
  });
  const { current, previous } = selectCurrentAndPreviousContracts([resilie]);

  check('LE POINT CENTRAL : aucun contrat actuel', current === null);
  check('…le contrat résilié passe dans l’histoire', previous.length === 1);
  check('…et il y est complet', previous[0].reference === 'CTR-resilie');
  check('le plus récent n’est pas devenu le courant par défaut',
    current === null && previous[0].status === CONTRACT_STATUS.ENDED);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Tous les statuts terminaux sont de l’histoire');
{
  for (const statut of [CONTRACT_STATUS.ENDED, CONTRACT_STATUS.CANCELLED, CONTRACT_STATUS.FAILED]) {
    const { current, previous } = selectCurrentAndPreviousContracts([contrat(statut)]);
    check(`${statut} → jamais courant`, current === null && previous.length === 1);
  }
  const archive = contrat(CONTRACT_STATUS.ACTIVE, { id: 'archive', archived: true });
  const { current } = selectCurrentAndPreviousContracts([archive]);
  check('un contrat ARCHIVÉ ne peut pas être courant, même ACTIVE', current === null);
  check('estTermine reconnaît l’archivage', estTermine(archive) === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Un contrat en cours de mise en place reste le contrat du moment');
{
  for (const statut of [
    CONTRACT_STATUS.CANCEL_AT_PERIOD_END,
    CONTRACT_STATUS.ACTIVATION_IN_PROGRESS,
    CONTRACT_STATUS.INACTIVE,
    CONTRACT_STATUS.PENDING_DEV_SIGNATURE,
    CONTRACT_STATUS.DRAFT,
  ]) {
    const { current } = selectCurrentAndPreviousContracts([contrat(statut)]);
    check(`${statut} → courant (il n’appartient pas au passé)`, current?.status === statut);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Plusieurs anciens contrats : aucun n’est choisi, et l’ordre tient');
{
  const anciens = [
    contrat(CONTRACT_STATUS.ENDED, { id: 'vieux', endedAt: '2024-05-01T00:00:00.000Z' }),
    contrat(CONTRACT_STATUS.CANCELLED, { id: 'recent', endedAt: '2026-07-01T00:00:00.000Z' }),
    contrat(CONTRACT_STATUS.ENDED, { id: 'moyen', endedAt: '2025-06-01T00:00:00.000Z' }),
  ];
  const { current, previous } = selectCurrentAndPreviousContracts(anciens);
  check('aucun contrat actuel', current === null);
  check('les trois sont dans l’histoire', previous.length === 3);
  check('…du plus récent au plus ancien',
    previous.map((c) => c._id).join('|') === 'recent|moyen|vieux');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. Un contrat actif ET des contrats passés');
{
  const { current, previous } = selectCurrentAndPreviousContracts([
    contrat(CONTRACT_STATUS.ENDED, { id: 'ancien', endedAt: '2025-01-01T00:00:00.000Z' }),
    contrat(CONTRACT_STATUS.ACTIVE, { id: 'courant', updatedAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  check('le courant est l’ACTIVE', current?._id === 'courant');
  check('…et l’ancien reste consultable', previous.map((c) => c._id).join() === 'ancien');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. Aucun contrat du tout');
{
  const { current, previous } = selectCurrentAndPreviousContracts([]);
  check('aucun courant', current === null);
  check('aucune histoire', previous.length === 0);
  check('une entrée nulle ne casse rien',
    selectCurrentAndPreviousContracts([null, undefined]).current === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. Deux contrats vivants : le plus avancé gagne, l’autre reste visible');
{
  const { current, previous } = selectCurrentAndPreviousContracts([
    contrat(CONTRACT_STATUS.DRAFT, { id: 'brouillon', updatedAt: '2026-09-01T00:00:00.000Z' }),
    contrat(CONTRACT_STATUS.ACTIVE, { id: 'actif', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ]);
  check('l’ACTIVE est le courant, malgré une date plus ancienne', current?._id === 'actif');
  check('…et le brouillon n’est pas perdu', previous.some((c) => c._id === 'brouillon'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('9. La règle vit à UN seul endroit');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sync = await fs.readFile(path.join(racine, 'services/projectBridge/projectSync.service.js'), 'utf8');

  check('la projection appelle la fonction de partage',
    /selectCurrentAndPreviousContracts\(tous\)/.test(sync));
  check('…et ne retombe plus sur « le plus récent non annulé »',
    !/status: \{ \$nin: \[CONTRACT_STATUS\.CANCELLED\] \}/.test(sync));
  check('elle dit franchement s’il y a un contrat actuel',
    /hasCurrentContract: Boolean\(current\)/.test(sync));
  check('…et publie l’histoire à part',
    /previousContracts: await Promise\.all\(previous\.map/.test(sync));
  check('aucun motif de résiliation n’est inventé',
    !/cancellationReason:/.test(sync));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
