/* Tests des diagnostics DEV des soumissions de contact (Manager) : libellés de
 * décision, motifs anti-abus, détection de rejets. Module PUR. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  DECISION_META, decisionMeta, ABUSE_REASON_LABEL, abuseReasonLabel, hasRecentRejections,
} = await import('./contactDiagnostics.ts');

section('1. Décisions');
check('3 décisions avec label+cls', ['ACCEPTED', 'DUPLICATE', 'REJECTED_AS_SPAM'].every((d) => DECISION_META[d]?.label && DECISION_META[d]?.cls));
check('ACCEPTED en vert', DECISION_META.ACCEPTED.cls.includes('emerald'));
check('REJECTED_AS_SPAM en rouge', DECISION_META.REJECTED_AS_SPAM.cls.includes('red'));
check('REJECTED_AS_SPAM = « Rejetée (anti-abus) »', decisionMeta('REJECTED_AS_SPAM').label === 'Rejetée (anti-abus)');
check('décision inconnue → fallback', decisionMeta('WAT').label === 'WAT');

section('2. Motifs anti-abus');
check('HONEYPOT explicite (autofill)', /autofill/i.test(ABUSE_REASON_LABEL.HONEYPOT));
check('GLOBAL_RATE mentionne le débit', /débit/i.test(ABUSE_REASON_LABEL.GLOBAL_RATE));
check('abuseReasonLabel(null) → vide', abuseReasonLabel(null) === '');
check('abuseReasonLabel(TOO_FAST) traduit', abuseReasonLabel('TOO_FAST') === 'Formulaire soumis trop vite');
check('motif inconnu conservé', abuseReasonLabel('AUTRE') === 'AUTRE');

section('3. Détection de rejets');
check('rejet présent → true', hasRecentRejections([{ decision: 'ACCEPTED' }, { decision: 'REJECTED_AS_SPAM' }]) === true);
check('aucun rejet → false', hasRecentRejections([{ decision: 'ACCEPTED' }, { decision: 'DUPLICATE' }]) === false);
check('vide → false', hasRecentRejections([]) === false);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
