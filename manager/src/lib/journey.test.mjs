/* Tests du parcours d'activation vu comme une suite d'écrans (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { JOURNEY_ORDER, stepPosition, completedStep, isJourneyDone, shouldPoll } = await import('./journey.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// --- Ordre ------------------------------------------------------------------
section('Ordre du parcours');
{
  check('4 écrans', JOURNEY_ORDER.length === 4);
  check('ordre métier respecté',
    JSON.stringify(JOURNEY_ORDER) === JSON.stringify(['SIGNATURE', 'LAUNCH_FEE', 'SUBSCRIPTION', 'ACTIVATION']));
  check('DONE n\'est pas un écran', !JOURNEY_ORDER.includes('DONE'));

  check('position 1-based', stepPosition('SIGNATURE') === 1);
  check('dernière étape', stepPosition('ACTIVATION') === 4);
  check('DONE hors parcours -> 0', stepPosition('DONE') === 0);

  check('DONE = parcours terminé', isJourneyDone('DONE') === true);
  check('ACTIVATION != terminé', isJourneyDone('ACTIVATION') === false);
}

// --- Franchissement ---------------------------------------------------------
section('Franchissement d\'étape');
{
  check('SIGNATURE -> LAUNCH_FEE fête SIGNATURE', completedStep('SIGNATURE', 'LAUNCH_FEE') === 'SIGNATURE');
  check('LAUNCH_FEE -> SUBSCRIPTION fête LAUNCH_FEE', completedStep('LAUNCH_FEE', 'SUBSCRIPTION') === 'LAUNCH_FEE');
  check('SUBSCRIPTION -> ACTIVATION fête SUBSCRIPTION', completedStep('SUBSCRIPTION', 'ACTIVATION') === 'SUBSCRIPTION');
  check('ACTIVATION -> DONE fête ACTIVATION', completedStep('ACTIVATION', 'DONE') === 'ACTIVATION');

  // Saut d'étape : frais non requis -> on passe SIGNATURE à SUBSCRIPTION direct.
  check('saut d\'étape (frais non requis) fête bien l\'étape quittée',
    completedStep('SIGNATURE', 'SUBSCRIPTION') === 'SIGNATURE');
  check('saut jusqu\'à DONE', completedStep('SIGNATURE', 'DONE') === 'SIGNATURE');
}

// --- Les trois refus --------------------------------------------------------
section('Ce qui ne doit JAMAIS être fêté');
{
  // Ouvrir la page ne franchit rien.
  check('premier rendu (prev null) -> rien', completedStep(null, 'LAUNCH_FEE') === null);
  check('premier rendu sur DONE -> rien', completedStep(null, 'DONE') === null);

  // Pas de mouvement.
  check('étape inchangée -> rien', completedStep('LAUNCH_FEE', 'LAUNCH_FEE') === null);
  check('DONE inchangé -> rien', completedStep('DONE', 'DONE') === null);

  // Recul : webhook tardif, signature invalidée…
  check('recul SUBSCRIPTION -> SIGNATURE -> rien', completedStep('SUBSCRIPTION', 'SIGNATURE') === null);
  check('recul ACTIVATION -> LAUNCH_FEE -> rien', completedStep('ACTIVATION', 'LAUNCH_FEE') === null);
  check('recul depuis DONE -> rien', completedStep('DONE', 'SIGNATURE') === null);

  // Inconnu.
  check('étape de départ inconnue -> rien', completedStep('N_IMPORTE_QUOI', 'ACTIVATION') === null);
  check('étape d\'arrivée inconnue -> rien', completedStep('SIGNATURE', 'N_IMPORTE_QUOI') === null);
}

// --- Totalité ---------------------------------------------------------------
section('Totalité');
{
  const all = [...JOURNEY_ORDER, 'DONE'];
  // Toute paire rend soit null, soit une étape connue du parcours.
  const results = all.flatMap((a) => all.map((b) => completedStep(a, b)));
  check('toute paire rend null ou une étape connue',
    results.every((r) => r === null || JOURNEY_ORDER.includes(r)));

  // Une progression stricte fête TOUJOURS l'étape quittée.
  const forward = JOURNEY_ORDER.flatMap((a, i) =>
    all.slice(i + 1).map((b) => completedStep(a, b) === a)
  );
  check('toute progression stricte fête l\'étape quittée', forward.every(Boolean));

  // Aucun mouvement arrière ne fête quoi que ce soit.
  const backward = JOURNEY_ORDER.flatMap((a, i) =>
    JOURNEY_ORDER.slice(0, i).map((b) => completedStep(a, b) === null)
  );
  check('aucun recul ne fête quoi que ce soit', backward.every(Boolean));
}

// --- Quand faut-il sonder ? -------------------------------------------------
section('Sondage');
{
  // On sonde tant qu'un webhook peut faire avancer le contrat.
  check('signature en attente -> on sonde', shouldPoll('INACTIVE', 'SIGNATURE') === true);
  check('paiement en attente -> on sonde', shouldPoll('INACTIVE', 'LAUNCH_FEE') === true);
  check('activation en cours -> on sonde', shouldPoll('ACTIVATION_IN_PROGRESS', 'ACTIVATION') === true);
  check('en attente signature DEV -> on sonde', shouldPoll('PENDING_DEV_SIGNATURE', 'SIGNATURE') === true);

  // États où plus rien ne bougera tout seul.
  check('site actif -> on arrête', shouldPoll('ACTIVE', 'DONE') === false);
  check('terminé -> on arrête', shouldPoll('ENDED', 'SIGNATURE') === false);
  check('annulé -> on arrête', shouldPoll('CANCELLED', 'SIGNATURE') === false);

  // LE PIÈGE : `deriveActivationStep` ne rend `DONE` que si le statut vaut
  // exactement ACTIVE. Un contrat résilié rend donc ACTIVATION — se fier à la
  // seule étape ferait sonder indéfiniment, des jours durant.
  check('résilié (CANCEL_AT_PERIOD_END) -> on arrête MALGRÉ step=ACTIVATION',
    shouldPoll('CANCEL_AT_PERIOD_END', 'ACTIVATION') === false);
  // FAILED attend une action humaine (relance par le DEV), pas une notification.
  check('en échec -> on arrête MALGRÉ step=SIGNATURE', shouldPoll('FAILED', 'SIGNATURE') === false);

  // Rien de chargé : pas de sondage à vide.
  check('aucun contrat -> on ne sonde pas', shouldPoll(null, 'SIGNATURE') === false);
  check('statut absent -> on ne sonde pas', shouldPoll(undefined, 'SIGNATURE') === false);

  // Un DRAFT ne bouge que par l'action du DEV, mais il reste inoffensif de le
  // sonder : la page DEV décide, elle, de ne pas le faire. On documente donc
  // que shouldPoll ne s'y oppose pas.
  check('brouillon -> shouldPoll ne tranche pas (la page DEV l\'exclut)', shouldPoll('DRAFT', 'SIGNATURE') === true);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
