/* Tests du verrou de défilement (comptage pur, sans DOM).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { createScrollLock } = await import('./scrollLock.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

/** Environnement d'essai : compte les poses et les restaurations. */
function espion() {
  const journal = { poses: 0, restaurations: 0 };
  return {
    journal,
    adapter: {
      apply() {
        journal.poses += 1;
        return () => { journal.restaurations += 1; };
      },
    },
  };
}

// --- Un verrou seul ---------------------------------------------------------
section('Un verrou seul');
{
  const { journal, adapter } = espion();
  const verrou = createScrollLock(adapter);

  check('au repos : rien de posé', journal.poses === 0 && verrou.depth() === 0);

  const libere = verrou.lock();
  check('pose appliquée une fois', journal.poses === 1);
  check('profondeur à 1', verrou.depth() === 1);
  check('rien restauré tant que le verrou tient', journal.restaurations === 0);

  libere();
  check('restauration appliquée', journal.restaurations === 1);
  check('profondeur revenue à zéro', verrou.depth() === 0);
}

// --- Verrous empilés (tiroir + modale) --------------------------------------
section('Verrous empilés');
{
  const { journal, adapter } = espion();
  const verrou = createScrollLock(adapter);

  const tiroir = verrou.lock();
  const modale = verrou.lock();
  check('une SEULE pose pour deux verrous', journal.poses === 1);
  check('profondeur à 2', verrou.depth() === 2);

  // Le cas qui cassait avant : la modale se ferme, le tiroir est encore ouvert.
  modale();
  check('la modale fermée ne rend PAS le défilement', journal.restaurations === 0);
  check('profondeur redescendue à 1', verrou.depth() === 1);

  tiroir();
  check('le dernier verrou libéré restaure', journal.restaurations === 1);
  check('profondeur revenue à zéro', verrou.depth() === 0);
}

// --- Libération idempotente (React strict, double démontage) ----------------
section('Libération idempotente');
{
  const { journal, adapter } = espion();
  const verrou = createScrollLock(adapter);

  const a = verrou.lock();
  const b = verrou.lock();

  a();
  a();
  a();
  check('trois appels sur la même libération = un seul décompte', verrou.depth() === 1);
  check('aucune restauration prématurée', journal.restaurations === 0);

  b();
  check('restauration une fois toutes les libérations consommées', journal.restaurations === 1);
  check('profondeur jamais négative', verrou.depth() === 0);
}

// --- Cycles successifs ------------------------------------------------------
section('Cycles successifs');
{
  const { journal, adapter } = espion();
  const verrou = createScrollLock(adapter);

  for (let i = 0; i < 3; i += 1) verrou.lock()();
  check('trois ouvertures/fermetures = trois poses', journal.poses === 3);
  check('trois ouvertures/fermetures = trois restaurations', journal.restaurations === 3);
  check('aucun verrou fantôme à la fin', verrou.depth() === 0);
}

// --- Verdict ----------------------------------------------------------------
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
