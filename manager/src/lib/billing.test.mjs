/* Tests d'affichage de la facturation (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { invoiceIdentity, upcomingInvoice } = await import('./billing.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// --- Identité des factures --------------------------------------------------
section('Identité des factures');
{
  const launch = invoiceIdentity({ type: 'LAUNCH_FEE', label: '', addedManually: false });
  check('frais de lancement : titre', launch.title === 'Frais de lancement');
  check('frais de lancement : icône', launch.icon === 'Rocket');

  const sub = invoiceIdentity({ type: 'SUBSCRIPTION', label: '', addedManually: false });
  check('abonnement : titre distinct des frais', sub.title === 'Abonnement mensuel');
  check('abonnement : icône', sub.icon === 'RotateCw');
  check('deux types -> deux libellés différents', launch.title !== sub.title);
  check('deux types -> deux icônes différentes', launch.icon !== sub.icon);
  check('deux types -> deux couleurs différentes', launch.tone !== sub.tone);

  const manual = invoiceIdentity({ type: 'LAUNCH_FEE', label: 'Migration', addedManually: true });
  check('ajout manuel : nom libre affiché', manual.title === 'Migration');
  check('ajout manuel : icône outil', manual.icon === 'Wrench');
  check('ajout manuel : prime sur le type', manual.title !== 'Frais de lancement');

  const manualNoLabel = invoiceIdentity({ type: null, label: '', addedManually: true });
  check('ajout manuel sans nom : libellé de repli', manualNoLabel.title === 'Facture ajoutée manuellement');
  check('nom vide (espaces) traité comme absent', invoiceIdentity({ type: null, label: '   ', addedManually: true }).title === 'Facture ajoutée manuellement');

  const other = invoiceIdentity({ type: null, label: '', addedManually: false });
  check('type inconnu : libellé neutre', other.title === 'Facture');
  check('type inconnu : icône générique', other.icon === 'FileText');
}

// --- Prochaine facture ------------------------------------------------------
section('Prochaine facture');
const group = (over = {}) => ({
  pricing: { subscription: { enabled: true, amountExcludingTax: 24900 }, launchFee: { enabled: true } },
  subscription: { status: 'ACTIVE', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: false },
  ...over,
});
{
  const next = upcomingInvoice(group());
  check('abonnement actif -> prochaine facture annoncée', Boolean(next));
  check('date = fin de période courante', next.date === '2026-09-05T00:00:00Z');
  check('montant HT de l’abonnement', next.amountExcludingTax === 24900);

  check(
    "période d'essai -> annoncée aussi",
    Boolean(upcomingInvoice(group({ subscription: { status: 'TRIALING', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: false } })))
  );

  // Résiliation programmée : aucune facture suivante ne sera émise.
  check(
    'résiliation programmée -> aucune carte',
    upcomingInvoice(group({ subscription: { status: 'ACTIVE', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: true } })) === null
  );
  check(
    'statut CANCEL_AT_PERIOD_END -> aucune carte',
    upcomingInvoice(group({ subscription: { status: 'CANCEL_AT_PERIOD_END', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: true } })) === null
  );
  check(
    'abonnement terminé -> aucune carte',
    upcomingInvoice(group({ subscription: { status: 'ENDED', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: false } })) === null
  );
  check(
    'impayé -> aucune carte',
    upcomingInvoice(group({ subscription: { status: 'PAST_DUE', currentPeriodEnd: '2026-09-05T00:00:00Z', cancelAtPeriodEnd: false } })) === null
  );
  check(
    'abonnement non requis -> aucune carte',
    upcomingInvoice(group({ pricing: { subscription: { enabled: false, amountExcludingTax: 0 }, launchFee: { enabled: true } } })) === null
  );
  check(
    'aucune échéance connue -> aucune carte',
    upcomingInvoice(group({ subscription: { status: 'ACTIVE', currentPeriodEnd: null, cancelAtPeriodEnd: false } })) === null
  );
  check('payload partiel toléré', upcomingInvoice({}) === null);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
