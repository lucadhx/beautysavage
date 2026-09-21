/* Tests de la machine à états d'enregistrement (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { snapshot, isDirty, deriveSaveState, defaultEquals, SAVED_DECAY_MS } = await import('./saveState.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// --- Instantané -------------------------------------------------------------
section('Instantané');
{
  check('null -> null (ressource non chargée)', snapshot(null) === null);
  check('undefined -> null', snapshot(undefined) === null);
  check('objet -> chaîne', snapshot({ a: 1 }) === '{"a":1}');
  check('objets égaux -> instantanés égaux', snapshot({ a: 1, b: [2] }) === snapshot({ a: 1, b: [2] }));
  check('objets différents -> instantanés différents', snapshot({ a: 1 }) !== snapshot({ a: 2 }));
  check('objet vide accepté', snapshot({}) === '{}');
}

// --- Travail en attente -----------------------------------------------------
section('Travail en attente');
{
  check('référence posée + identique -> propre', isDirty('{"a":1}', '{"a":1}') === false);
  check('référence posée + différent -> modifié', isDirty('{"a":1}', '{"a":2}') === true);
  check('aucune référence -> jamais modifié', isDirty(null, '{"a":1}') === false);
  check('brouillon non chargé -> jamais modifié', isDirty('{"a":1}', null) === false);
  check('rien de chargé -> jamais modifié', isDirty(null, null) === false);
  check('undefined traité comme non chargé', isDirty(undefined, { a: 1 }) === false);

  // Objets : le cas réel des pages (`data` de useResource).
  check('objets équivalents -> propre', isDirty({ a: 1 }, { a: 1 }) === false);
  check('objets différents -> modifié', isDirty({ a: 1 }, { a: 2 }) === true);
  check('objets imbriqués comparés en profondeur', isDirty({ a: { b: [1] } }, { a: { b: [2] } }) === true);

  // Valeurs falsy : ne doivent PAS être prises pour « non chargé ».
  check('0 est une valeur chargée', isDirty(0, 1) === true);
  check('false est une valeur chargée', isDirty(false, true) === true);
  check('chaîne vide est une valeur chargée', isDirty('', 'x') === true);
}

// --- Comparateur sur mesure -------------------------------------------------
section('Comparateur sur mesure');
{
  // Le configurateur de signature compare ses zones par `zonesEqual` : l'ordre
  // du tableau n'y est pas signifiant, la sérialisation ne convient donc pas.
  const byId = (a, b) =>
    a.length === b.length &&
    [...a].sort((x, y) => x.id.localeCompare(y.id)).every((z, i) => {
      const other = [...b].sort((x, y) => x.id.localeCompare(y.id))[i];
      return z.id === other.id && z.v === other.v;
    });

  const a = [{ id: 'z1', v: 1 }, { id: 'z2', v: 2 }];
  const reordered = [{ id: 'z2', v: 2 }, { id: 'z1', v: 1 }];

  check('ordre différent -> modifié pour le comparateur par défaut', isDirty(a, reordered) === true);
  check('ordre différent -> propre pour le comparateur sur mesure', isDirty(a, reordered, byId) === false);
  check('vraie différence -> modifié malgré le comparateur',
    isDirty(a, [{ id: 'z1', v: 9 }, { id: 'z2', v: 2 }], byId) === true);
  check('comparateur ignoré quand rien n\'est chargé', isDirty(null, a, byId) === false);
}

// --- Égalité par défaut -----------------------------------------------------
section('Égalité par défaut');
{
  check('valeurs identiques', defaultEquals({ a: 1 }, { a: 1 }) === true);
  check('valeurs différentes', defaultEquals({ a: 1 }, { a: 2 }) === false);
  // Documenté comme volontaire : un faux « modifié » est bénin, un faux
  // « propre » perd du travail.
  check('ordre des clés significatif (documenté)', defaultEquals({ a: 1, b: 2 }, { b: 2, a: 1 }) === false);
}

// --- États affichés ---------------------------------------------------------
section('États affichés');
{
  check('repos + propre -> idle', deriveSaveState('resting', false) === 'idle');
  check('repos + modifié -> dirty', deriveSaveState('resting', true) === 'dirty');
  check('requête en vol -> saving', deriveSaveState('saving', false) === 'saving');
  check('succès + propre -> saved', deriveSaveState('saved', false) === 'saved');
}

// --- L'invariant : « ✓ Enregistré » ne ment jamais --------------------------
section("L'invariant : « ✓ Enregistré » ne ment jamais");
{
  // Le seul vrai bug possible : afficher « enregistré » sur un écran modifié.
  const SETTLED = ['idle', 'saved'];
  const phases = ['resting', 'saving', 'saved'];
  const lies = phases.filter((p) => SETTLED.includes(deriveSaveState(p, true)));
  check('aucune phase n\'affiche « enregistré » quand c\'est modifié', lies.length === 0);

  // Cas concret : l'utilisateur édite pendant la fenêtre de validation.
  check('édition pendant la validation -> redemande l\'enregistrement',
    deriveSaveState('saved', true) === 'dirty');

  // Cas concret : l'utilisateur édite pendant que la requête est en vol.
  // `saving` prime — mais au retour, la phase repasse à `saved` et `dirty`
  // reprend la main (cas ci-dessus), donc le travail n'est jamais perdu de vue.
  check('édition pendant la requête -> reste saving', deriveSaveState('saving', true) === 'saving');
}

// --- Totalité ---------------------------------------------------------------
section('Totalité');
{
  const phases = ['resting', 'saving', 'saved'];
  const valid = ['idle', 'dirty', 'saving', 'saved'];
  const all = phases.flatMap((p) => [true, false].map((d) => deriveSaveState(p, d)));
  check('toute combinaison rend un état connu', all.every((s) => valid.includes(s)));
  check('les 6 combinaisons sont couvertes', all.length === 6);
  check('délai de validation raisonnable', SAVED_DECAY_MS > 800 && SAVED_DECAY_MS < 6000);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
