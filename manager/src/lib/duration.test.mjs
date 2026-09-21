/* Tests de la durée des prestations (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const {
  hasDuration, formatDuration, splitDuration, joinDuration, parseDurationPart,
  MAX_HOURS_PART, MAX_MINUTES_PART,
} = await import('./duration.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// --- Durée renseignée ? -----------------------------------------------------
section('Durée renseignée ?');
{
  check('non renseignée : null', hasDuration(null) === false);
  check('non renseignée : undefined', hasDuration(undefined) === false);
  check('non renseignée : absente', hasDuration() === false);
  check('non renseignée : 0', hasDuration(0) === false);
  check('négative -> non renseignée', hasDuration(-5) === false);
  check('NaN -> non renseignée', hasDuration(NaN) === false);
  check('Infinity -> non renseignée', hasDuration(Infinity) === false);
  check('renseignée : 45', hasDuration(45) === true);
  check('renseignée : 1', hasDuration(1) === true);
}

// --- Affichage --------------------------------------------------------------
section('Affichage');
{
  // La règle : une durée absente ne s'affiche JAMAIS.
  check('non renseignée -> chaîne vide', formatDuration(null) === '');
  check('undefined -> chaîne vide', formatDuration(undefined) === '');
  check('0 -> chaîne vide (jamais « 0 min »)', formatDuration(0) === '');
  check('négative -> chaîne vide', formatDuration(-30) === '');

  check('45 -> « 45 min »', formatDuration(45) === '45 min');
  check('5 -> « 5 min »', formatDuration(5) === '5 min');
  check('59 -> « 59 min »', formatDuration(59) === '59 min');
  check('60 -> « 1h » (pas « 1h00 »)', formatDuration(60) === '1h');
  check('120 -> « 2h »', formatDuration(120) === '2h');
  check('90 -> « 1h30 »', formatDuration(90) === '1h30');
  check('150 -> « 2h30 » (exemple du cahier des charges)', formatDuration(150) === '2h30');
  check('65 -> « 1h05 » : minutes complétées', formatDuration(65) === '1h05');
  check('61 -> « 1h01 »', formatDuration(61) === '1h01');
  check('décimale arrondie', formatDuration(45.4) === '45 min');
  check('longue durée', formatDuration(1440) === '24h');
}

// --- Découpage / recomposition ----------------------------------------------
section('Découpage / recomposition');
{
  check('150 -> 2h30', JSON.stringify(splitDuration(150)) === JSON.stringify({ hours: 2, mins: 30 }));
  check('45 -> 0h45', JSON.stringify(splitDuration(45)) === JSON.stringify({ hours: 0, mins: 45 }));
  check('60 -> 1h00', JSON.stringify(splitDuration(60)) === JSON.stringify({ hours: 1, mins: 0 }));
  check('non renseignée -> deux champs vides',
    JSON.stringify(splitDuration(null)) === JSON.stringify({ hours: null, mins: null }));
  check('0 -> deux champs vides',
    JSON.stringify(splitDuration(0)) === JSON.stringify({ hours: null, mins: null }));

  check('2h30 -> 150', joinDuration(2, 30) === 150);
  check('0h45 -> 45', joinDuration(0, 45) === 45);
  check('2h seul -> 120', joinDuration(2, null) === 120);
  check('30min seul -> 30', joinDuration(null, 30) === 30);
  check('deux champs vides -> null (efface la durée)', joinDuration(null, null) === null);
  check('0h 0min -> null (efface la durée)', joinDuration(0, 0) === null);

  // Aller-retour : éditer sans rien changer ne doit pas altérer la valeur.
  const roundtrip = (m) => { const { hours, mins } = splitDuration(m); return joinDuration(hours, mins); };
  check('aller-retour 150', roundtrip(150) === 150);
  check('aller-retour 45', roundtrip(45) === 45);
  check('aller-retour 60', roundtrip(60) === 60);
  check('aller-retour 1', roundtrip(1) === 1);
  check('aller-retour non renseignée', roundtrip(null) === null);
}

// --- Saisie -----------------------------------------------------------------
section('Saisie');
{
  check('champ vide -> null', parseDurationPart('', MAX_MINUTES_PART) === null);
  check('espaces -> null', parseDurationPart('   ', MAX_MINUTES_PART) === null);
  // 0 doit rester saisissable : c'est ce qui permet d'écrire « 2h00 ».
  check('« 0 » -> 0, pas null', parseDurationPart('0', MAX_MINUTES_PART) === 0);
  check('« 30 » -> 30', parseDurationPart('30', MAX_MINUTES_PART) === 30);
  check('texte -> null', parseDurationPart('abc', MAX_MINUTES_PART) === null);
  check('négatif ramené à 0', parseDurationPart('-5', MAX_MINUTES_PART) === 0);
  check('minutes > 59 ramenées à 59', parseDurationPart('90', MAX_MINUTES_PART) === 59);
  check('heures > 23 ramenées à 23', parseDurationPart('99', MAX_HOURS_PART) === 23);
  check('décimale tronquée', parseDurationPart('2.7', MAX_HOURS_PART) === 2);
  check('bornes cohérentes', MAX_MINUTES_PART === 59 && MAX_HOURS_PART === 23);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
