/* COÛT D'UN ABONNEMENT — l'échéance et le repère, jamais confondus.
 *
 * ── LA CONFUSION VERROUILLÉE ────────────────────────────────────────────────
 * Un abonnement annuel s'affichait avec son montant d'échéance sans dire qu'il
 * est prélevé EN UNE FOIS : « 1 200 € » pouvait se lire « par mois ». À
 * l'inverse, mettre en avant l'équivalent mensuel sans nommer la somme
 * réellement débitée serait tout aussi trompeur. Les deux coexistent, et ces
 * contrôles vérifient qu'aucun ne peut prendre la place de l'autre.
 *
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { deriveSubscriptionCost, monthlyEquivalent } = await import('./subscriptionPricing.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

/** 100 € HT, TVA 20 % — en centimes entiers, comme la facturation. */
const ligne = (over = {}) => ({
  enabled: true,
  amountExcludingTax: 10000,
  taxAmount: 2000,
  amountIncludingTax: 12000,
  currency: 'EUR',
  interval: 'MONTH',
  ...over,
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Mensuel avec TVA — l’échéance EST l’équivalent mensuel');
{
  const c = deriveSubscriptionCost(ligne());
  check('applicable', c.applicable === true);
  check('fréquence mensuelle', c.interval === 'MONTH' && c.paidUpfront === false);
  check('échéance : 100 € HT', c.perCharge.excludingTax === 10000);
  check('…TVA 20 €', c.perCharge.tax === 2000);
  check('…TTC 120 €', c.perCharge.includingTax === 12000);
  check('équivalent mensuel = échéance', c.monthlyEquivalent.excludingTax === 10000);
  check('…TTC aussi', c.monthlyEquivalent.includingTax === 12000);
  check('sur douze mois : 1 200 € HT', c.yearly.excludingTax === 120000);
  check('…et 1 440 € TTC', c.yearly.includingTax === 144000);
}

section('2. Mensuel sans TVA');
{
  const c = deriveSubscriptionCost(ligne({ taxAmount: 0, amountIncludingTax: 10000 }));
  check('aucune TVA', c.perCharge.tax === 0);
  check('HT = TTC', c.perCharge.excludingTax === c.perCharge.includingTax);
  check('annuel cohérent', c.yearly.includingTax === 120000);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Annuel avec TVA — 1 200 € HT prélevés EN UNE FOIS');
{
  const c = deriveSubscriptionCost(ligne({
    interval: 'YEAR', amountExcludingTax: 120000, taxAmount: 24000, amountIncludingTax: 144000,
  }));
  check('fréquence annuelle', c.interval === 'YEAR');
  check('le prélèvement est unique', c.paidUpfront === true);
  check('échéance débitée : 1 200 € HT', c.perCharge.excludingTax === 120000);
  check('…TVA 240 €', c.perCharge.tax === 24000);
  check('…total débité 1 440 € TTC', c.perCharge.includingTax === 144000);

  // Le repère de comparaison — jamais un montant débité.
  check('équivalent mensuel : 100 € HT', c.monthlyEquivalent.excludingTax === 10000);
  check('…et 120 € TTC', c.monthlyEquivalent.includingTax === 12000);
  check('l’équivalent n’est PAS l’échéance',
    c.monthlyEquivalent.excludingTax !== c.perCharge.excludingTax);

  // Sur douze mois, l'annuel EST l'échéance : on ne remultiplie pas.
  check('coût annuel = échéance', c.yearly.excludingTax === 120000);
  check('…sans dérive d’arrondi', c.yearly.includingTax === 144000);
}

section('4. Annuel sans TVA');
{
  const c = deriveSubscriptionCost(ligne({
    interval: 'YEAR', amountExcludingTax: 120000, taxAmount: 0, amountIncludingTax: 120000,
  }));
  check('équivalent mensuel HT = TTC', c.monthlyEquivalent.excludingTax === c.monthlyEquivalent.includingTax);
  check('…et vaut 100 €', c.monthlyEquivalent.excludingTax === 10000);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Montants non divisibles par douze — aucun centime inventé');
{
  // 1 000,05 € HT sur l'année : 100005 / 12 = 8333,75 → 8334 centimes.
  const c = deriveSubscriptionCost(ligne({
    interval: 'YEAR', amountExcludingTax: 100005, taxAmount: 20001, amountIncludingTax: 120006,
  }));
  check('équivalent arrondi au centime le plus proche', c.monthlyEquivalent.excludingTax === 8334);
  check('l’échéance reste EXACTE', c.perCharge.excludingTax === 100005);
  check('…et le coût annuel aussi', c.yearly.excludingTax === 100005);
  check('l’arrondi ne remonte JAMAIS dans l’annuel',
    c.yearly.excludingTax !== c.monthlyEquivalent.excludingTax * 12);

  // Cas classique : 100 € / an → 8,333… € par mois.
  const petit = deriveSubscriptionCost(ligne({
    interval: 'YEAR', amountExcludingTax: 10000, taxAmount: 2000, amountIncludingTax: 12000,
  }));
  check('100 € / an → 8,33 € HT par mois', petit.monthlyEquivalent.excludingTax === 833);
  check('…et 10 € TTC par mois', petit.monthlyEquivalent.includingTax === 1000);

  /**
   * L'APPEL PREND UNE RÉCURRENCE, PLUS UNE CHAÎNE — et le silence était le piège.
   *
   * Ces trois contrôles passaient `'YEAR'`. La signature a changé quand la
   * récurrence est devenue `{unit, interval}` (pour couvrir un trimestriel), et
   * `monthsPerCycle('YEAR')` déstructure alors `undefined` : la fonction rend
   * le montant INCHANGÉ au lieu de le diviser.
   *
   * Le symptôme en production serait un équivalent mensuel douze fois trop
   * élevé, affiché sans erreur. Ces trois lignes étaient rouges depuis, et
   * disaient exactement cela — personne ne les avait relues.
   */
  const AN = { unit: 'YEAR', interval: 1 };
  // Un centime : il ne doit jamais devenir zéro sans raison, ni un centime plein.
  check('1 centime / an → 0', monthlyEquivalent(1, AN) === 0);
  check('6 centimes / an → 1', monthlyEquivalent(6, AN) === 1);
  check('12 centimes / an → 1', monthlyEquivalent(12, AN) === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. Gratuit, désactivé, incohérent — rien à présenter');
{
  check('abonnement désactivé', deriveSubscriptionCost(ligne({ enabled: false })).applicable === false);
  check('montant nul', deriveSubscriptionCost(ligne({ amountExcludingTax: 0, taxAmount: 0, amountIncludingTax: 0 })).applicable === false);
  check('ligne absente', deriveSubscriptionCost(null).applicable === false);
  check('…et ne lève pas', deriveSubscriptionCost(undefined).perCharge.includingTax === 0);

  // Valeurs aberrantes : on ne propage pas de NaN dans un montant.
  const sale = deriveSubscriptionCost(ligne({ amountExcludingTax: 'abc', taxAmount: null, amountIncludingTax: undefined }));
  check('une saisie non numérique donne 0, jamais NaN',
    sale.perCharge.excludingTax === 0 && Number.isFinite(sale.perCharge.includingTax));
  check('un montant négatif est ramené à 0',
    deriveSubscriptionCost(ligne({ amountExcludingTax: -500 })).perCharge.excludingTax === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. TTC publié vs recomposé, devise, changement de fréquence');
{
  // Le TTC publié fait foi : il vient du même calcul que la facture.
  const publie = deriveSubscriptionCost(ligne({ amountIncludingTax: 11999 }));
  check('le TTC publié prime', publie.perCharge.includingTax === 11999);

  // Absent, il se recompose — sans quoi l'écran afficherait 0.
  const recompose = deriveSubscriptionCost({ enabled: true, amountExcludingTax: 10000, taxAmount: 2000, interval: 'MONTH' });
  check('TTC absent → recomposé', recompose.perCharge.includingTax === 12000);

  check('devise reprise telle quelle', deriveSubscriptionCost(ligne({ currency: 'chf' })).currency === 'CHF');
  check('devise par défaut', deriveSubscriptionCost(ligne({ currency: undefined })).currency === 'EUR');

  // Changement de fréquence à montant égal : les repères doivent bouger.
  const mensuel = deriveSubscriptionCost(ligne({ interval: 'MONTH' }));
  const annuel = deriveSubscriptionCost(ligne({ interval: 'YEAR' }));
  check('même montant, fréquences différentes → équivalents différents',
    mensuel.monthlyEquivalent.excludingTax !== annuel.monthlyEquivalent.excludingTax);
  check('…et coûts annuels différents', mensuel.yearly.excludingTax !== annuel.yearly.excludingTax);

  // Une valeur de fréquence inconnue ne doit pas passer pour de l'annuel.
  check('fréquence inconnue → mensuel', deriveSubscriptionCost(ligne({ interval: 'WEEK' })).interval === 'MONTH');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. L’écran dit « en une fois » UNIQUEMENT en annuel');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const carte = await lire('src/components/contracts/SubscriptionCostCard.tsx');
  const admin = await lire('src/pages/MyContractPage.tsx');
  const dev = await lire('src/pages/dev/DevContractsPage.tsx');

  check('la mise en avant est TOUJOURS l’équivalent mensuel',
    /text-2xl font-semibold tabular-nums[\s\S]{0,120}monthlyEquivalent\.excludingTax/.test(carte));
  check('…annoncé comme tel', /HT \/ mois/.test(carte));
  /**
   * LA PHRASE A CHANGÉ AVEC L'OFFRE, ET C'EST UN PROGRÈS.
   *
   * Elle disait « à payer en une fois pour l'année ». La carte sait désormais
   * présenter un trimestriel : la période est INTERPOLÉE, parce qu'écrire
   * « pour l'année » sur un trimestre serait faux.
   *
   * Ce que ce contrôle défend n'a pas bougé : la mention n'apparaît QUE
   * lorsqu'un prélèvement unique a lieu.
   */
  check('« à payer en une fois » n’apparaît QUE si paidUpfront',
    /\{paidUpfront && \([\s\S]{0,260}à payer en une fois, \{periode\}/.test(carte));
  check('le total débité est nommé sur une échéance due',
    /Total débité aujourd’hui/.test(carte));
  check('la TVA est affichée', /Ligne label="TVA"/.test(carte));
  /**
   * LA FRÉQUENCE EST DITE EN TOUTES LETTRES, PLUS PAR UN TERNAIRE.
   *
   * `paidUpfront ? 'Annuel' : 'Mensuel'` ne savait nommer que deux offres, et
   * aurait rangé un trimestriel dans la mauvaise case — en affirmant
   * « Mensuel » sur un contrat prélevé tous les trois mois.
   */
  check('la fréquence est visible, et nommée par la récurrence',
    /\{recurrenceLabel\}/.test(carte));
  /**
   * « SUR DOUZE MOIS » NE S'AFFICHE QUE S'IL DIT AUTRE CHOSE QUE L'ÉCHÉANCE.
   *
   * La garde était `!paidUpfront`. Elle est devenue `monthsPerCycle !== 12`,
   * ce qui est la vraie question : sur un cycle de douze mois, la ligne
   * répéterait l'échéance mot pour mot.
   */
  check('le coût sur douze mois n’est montré que si différent',
    /cost\.monthsPerCycle !== 12 && \([\s\S]{0,200}Sur douze mois/.test(carte));

  check('aucun montant en dur dans la carte',
    !/\b\d{2,}\s*€/.test(carte) && !/1\s?200|1\s?440/.test(carte));
  check('la carte est utilisée côté ADMIN',
    /<SubscriptionCostCard line=\{contract\.pricing\.subscription\} variant="due" \/>/.test(admin));
  check('…et côté DEV, sur la SAISIE en cours',
    /<SubscriptionCostCard[\s\S]{0,300}amountExcludingTax: Math\.round\(\(Number\(subEur\)/.test(dev));
  /**
   * L'APERÇU DEV SUIT LA RÉCURRENCE COMPLÈTE, pas seulement son unité.
   *
   * Il passait `interval` — l'unité héritée. Il passe désormais l'objet
   * `recurrence` entier : sans lui, un « tous les 3 mois » saisi dans le
   * formulaire s'afficherait comme un mensuel dans l'aperçu juste à côté.
   */
  check('l’aperçu DEV suit la récurrence choisie',
    /recurrence,\s*\n\s*\}\}/.test(dev));

  // Responsive : les montants ne doivent pas déborder sur 320 px.
  check('les libellés passent à la ligne si nécessaire',
    /flex flex-wrap items-baseline/.test(carte));
  check('les chiffres restent alignés', /tabular-nums/.test(carte));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
