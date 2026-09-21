/* Tests du calcul d'avancement du contrat (module pur, partagé DEV/ADMIN).
 * Runner autonome — Node strippe les types TS (--experimental-strip-types).
 * Lancement : npm run test  (depuis manager/) */
const { deriveContractProgress } = await import('./contractProgress.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

/** Contrat sérialisé minimal — mêmes champs que serializeContract + activationView. */
function contract(over = {}) {
  return {
    status: 'DRAFT',
    devSigned: false,
    adminSigned: false,
    signed: false,
    launchFeeRequired: true,
    launchFeeSatisfied: false,
    subscriptionRequired: true,
    subscriptionSatisfied: false,
    canActivate: false,
    activation: { activatedAt: null, activatedBy: null },
    signature: { signatureState: 'NONE' },
    stripe: { launchFee: { status: 'PENDING' }, subscription: { status: 'NONE' } },
    ...over,
  };
}
const byKey = (p, k) => p.steps.find((s) => s.key === k);
const statusOf = (p, k) => byKey(p, k).status;

// --- Brouillon --------------------------------------------------------------
section('Brouillon');
{
  const p = deriveContractProgress(contract());
  check('6 étapes', p.steps.length === 6);
  check('préparation = étape courante', statusOf(p, 'PREPARATION') === 'current');
  check('signature DEV à venir', statusOf(p, 'DEV_SIGNATURE') === 'upcoming');
  check('activation à venir', statusOf(p, 'ACTIVATION') === 'upcoming');
  check('index courant = 0', p.currentIndex === 0);
  check('0/6 franchies', p.completed === 0 && p.total === 6);
  check('aucun état terminal', p.outcome.kind === 'NONE');
}

// --- Attente signature DEV --------------------------------------------------
section('Validé, en attente de signature DEV');
{
  const p = deriveContractProgress(contract({ status: 'PENDING_DEV_SIGNATURE', signature: { signatureState: 'REQUESTED' } }));
  check('préparation franchie', statusOf(p, 'PREPARATION') === 'done');
  check('signature DEV courante', statusOf(p, 'DEV_SIGNATURE') === 'current');
  check('signature client à venir', statusOf(p, 'CLIENT_SIGNATURE') === 'upcoming');
  check('1/6', p.completed === 1);
}

// --- DEV signé --------------------------------------------------------------
section('DEV signé');
{
  const p = deriveContractProgress(contract({ status: 'INACTIVE', devSigned: true, signature: { signatureState: 'DEV_SIGNED' } }));
  check('signature DEV franchie', statusOf(p, 'DEV_SIGNATURE') === 'done');
  check('signature client courante', statusOf(p, 'CLIENT_SIGNATURE') === 'current');
  check('2/6', p.completed === 2);
}

// --- Client signé -----------------------------------------------------------
section('Client signé');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true, signed: true,
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('signature client franchie', statusOf(p, 'CLIENT_SIGNATURE') === 'done');
  check('frais de lancement courants', statusOf(p, 'LAUNCH_FEE') === 'current');
  check('3/6', p.completed === 3);
}

// --- Frais non requis -------------------------------------------------------
section('Frais de lancement non requis');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    launchFeeRequired: false, launchFeeSatisfied: true,
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('frais marqués « non requise »', statusOf(p, 'LAUNCH_FEE') === 'not-required');
  check('mention explicite', byKey(p, 'LAUNCH_FEE').hint === 'Non requise');
  check("une étape non requise n'est jamais courante", p.steps[p.currentIndex].key === 'SUBSCRIPTION');
  check('exclue du total requis', p.total === 5);
  check('ne bloque pas la suite', statusOf(p, 'SUBSCRIPTION') === 'current');
}

// --- Frais payés ------------------------------------------------------------
section('Frais de lancement payés');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    launchFeeSatisfied: true, stripe: { launchFee: { status: 'PAID' }, subscription: { status: 'NONE' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('frais franchis', statusOf(p, 'LAUNCH_FEE') === 'done');
  check('aucune mention « non requise »', !byKey(p, 'LAUNCH_FEE').hint);
  check('abonnement courant', statusOf(p, 'SUBSCRIPTION') === 'current');
}

// --- Abonnement non requis --------------------------------------------------
section('Abonnement non requis');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    launchFeeSatisfied: true, subscriptionRequired: false, subscriptionSatisfied: true,
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('abonnement « non requise »', statusOf(p, 'SUBSCRIPTION') === 'not-required');
  check('activation courante', statusOf(p, 'ACTIVATION') === 'current');
  check('total requis = 5', p.total === 5);
}

// --- Abonnement actif -------------------------------------------------------
section('Abonnement actif');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    launchFeeSatisfied: true, subscriptionSatisfied: true,
    stripe: { launchFee: { status: 'PAID' }, subscription: { status: 'ACTIVE' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('abonnement franchi', statusOf(p, 'SUBSCRIPTION') === 'done');
  check('activation courante (dernier clic ADMIN)', statusOf(p, 'ACTIVATION') === 'current');
  check('5/6', p.completed === 5);
}

// --- Site actif -------------------------------------------------------------
section('Site actif');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVE', devSigned: true, adminSigned: true, signed: true,
    launchFeeSatisfied: true, subscriptionSatisfied: true,
    activation: { activatedAt: '2026-07-16T10:00:00Z', activatedBy: 'u1' },
    stripe: { launchFee: { status: 'PAID' }, subscription: { status: 'ACTIVE' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('toutes les étapes franchies', p.steps.every((s) => s.status === 'done'));
  check('parcours terminé (index -1)', p.currentIndex === -1);
  check('6/6', p.completed === 6 && p.total === 6);
  check('aucun état terminal', p.outcome.kind === 'NONE');
}

// --- Résiliation programmée -------------------------------------------------
section('Résiliation programmée');
{
  const p = deriveContractProgress(contract({
    status: 'CANCEL_AT_PERIOD_END', devSigned: true, adminSigned: true,
    launchFeeSatisfied: true, subscriptionSatisfied: true,
    activation: { activatedAt: '2026-07-16T10:00:00Z', activatedBy: 'u1' },
    stripe: { launchFee: { status: 'PAID' }, subscription: { status: 'CANCEL_AT_PERIOD_END' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('activation reste franchie', statusOf(p, 'ACTIVATION') === 'done');
  check('état résiliation signalé', p.outcome.kind === 'CANCEL_AT_PERIOD_END');
  check("mention « actif jusqu'à l'échéance »", /échéance/.test(p.outcome.label));
}

// --- Contrat terminé --------------------------------------------------------
section('Contrat terminé');
{
  const p = deriveContractProgress(contract({
    status: 'ENDED', devSigned: true, adminSigned: true,
    launchFeeSatisfied: true, subscriptionSatisfied: true,
    activation: { activatedAt: '2026-01-01T10:00:00Z', activatedBy: 'u1' },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('état terminé', p.outcome.kind === 'ENDED');
  check('site suspendu mentionné', /suspendu/.test(p.outcome.label));
  check('activation reste franchie (le passé ne se réécrit pas)', statusOf(p, 'ACTIVATION') === 'done');
}

// --- Erreur de signature ----------------------------------------------------
section('Erreur de signature');
{
  const refused = deriveContractProgress(contract({
    status: 'FAILED', signature: { signatureState: 'DECLINED' },
  }));
  check('signature DEV en erreur', statusOf(refused, 'DEV_SIGNATURE') === 'error');
  check('mention « Refusée »', byKey(refused, 'DEV_SIGNATURE').hint === 'Refusée');
  check('état FAILED signalé', refused.outcome.kind === 'FAILED');

  // L'erreur se porte sur la partie qui n'a pas signé, pas sur celle qui a signé.
  const clientRefused = deriveContractProgress(contract({
    status: 'FAILED', devSigned: true, signature: { signatureState: 'DECLINED' },
  }));
  check('DEV signé reste franchi', statusOf(clientRefused, 'DEV_SIGNATURE') === 'done');
  check('erreur portée sur la signature client', statusOf(clientRefused, 'CLIENT_SIGNATURE') === 'error');

  const expired = deriveContractProgress(contract({ status: 'FAILED', signature: { signatureState: 'EXPIRED' } }));
  check('mention « Expirée »', byKey(expired, 'DEV_SIGNATURE').hint === 'Expirée');
}

// --- Erreur de paiement -----------------------------------------------------
section('Erreur de paiement');
{
  const p = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    stripe: { launchFee: { status: 'FAILED' }, subscription: { status: 'NONE' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('frais en erreur', statusOf(p, 'LAUNCH_FEE') === 'error');
  check('mention « Paiement échoué »', byKey(p, 'LAUNCH_FEE').hint === 'Paiement échoué');

  // Un échec sur une étape NON requise n'a pas de sens : elle reste « non requise ».
  const notRequired = deriveContractProgress(contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true,
    launchFeeRequired: false, launchFeeSatisfied: true,
    stripe: { launchFee: { status: 'FAILED' }, subscription: { status: 'NONE' } },
    signature: { signatureState: 'FULLY_SIGNED' },
  }));
  check('étape non requise jamais en erreur', statusOf(notRequired, 'LAUNCH_FEE') === 'not-required');
}

// --- Contrat annulé ---------------------------------------------------------
section('Contrat annulé');
{
  const p = deriveContractProgress(contract({ status: 'CANCELLED' }));
  check('état annulé', p.outcome.kind === 'CANCELLED');
  check('libellé explicite', p.outcome.label === 'Contrat annulé');
}

// --- Rendu DEV et ADMIN identiques ------------------------------------------
section('DEV et ADMIN : même calcul');
{
  // Le backend sérialise le MÊME contrat pour les deux rôles, à ceci près que
  // l'ADMIN n'a pas les identifiants techniques Stripe/Yousign (réservés DEV).
  const devPayload = contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true, launchFeeSatisfied: true,
    signature: { signatureState: 'FULLY_SIGNED', signatureRequestId: 'sr_1' },
    stripe: {
      launchFee: { status: 'PAID', paymentIntentId: 'pi_1', checkoutSessionId: 'cs_1' },
      subscription: { status: 'NONE', subscriptionId: 'sub_1' },
    },
  });
  const adminPayload = contract({
    status: 'ACTIVATION_IN_PROGRESS', devSigned: true, adminSigned: true, launchFeeSatisfied: true,
    signature: { signatureState: 'FULLY_SIGNED' },
    stripe: { launchFee: { status: 'PAID' }, subscription: { status: 'NONE' } },
  });
  const a = deriveContractProgress(devPayload);
  const b = deriveContractProgress(adminPayload);
  check('étapes identiques', JSON.stringify(a.steps) === JSON.stringify(b.steps));
  check('étape courante identique', a.currentIndex === b.currentIndex);
  check('compteurs identiques', a.completed === b.completed && a.total === b.total);
  check('état terminal identique', JSON.stringify(a.outcome) === JSON.stringify(b.outcome));
}

// --- Libellés des signatures : noms d'entreprises ---------------------------
section('Libellés de signature');
{
  const named = deriveContractProgress(contract({
    status: 'PENDING_DEV_SIGNATURE',
    signersSnapshot: {
      developer: { companyName: 'Lycarz', firstName: 'A', lastName: 'B', email: 'a@b.fr', jobTitle: '' },
      client: { companyName: 'SB Auto', firstName: 'C', lastName: 'D', email: 'c@d.fr', jobTitle: '' },
    },
  }));
  check('signature DEV nommée d’après l’entreprise', byKey(named, 'DEV_SIGNATURE').label === 'Signature Lycarz');
  check('signature client nommée d’après l’entreprise', byKey(named, 'CLIENT_SIGNATURE').label === 'Signature SB Auto');
  check('les autres étapes sont inchangées', byKey(named, 'ACTIVATION').label === 'Activation');

  // Repli sur la vue éditeur quand le snapshot n'existe pas encore.
  const fromSigners = deriveContractProgress(contract({
    signatureConfiguration: { signers: [
      { role: 'DEVELOPER', companyName: 'Studio', displayName: '', email: '', logo: '', color: '' },
      { role: 'CLIENT', companyName: 'Garage Dupont', displayName: '', email: '', logo: '', color: '' },
    ] },
  }));
  check('repli sur la config de signature (DEV)', byKey(fromSigners, 'DEV_SIGNATURE').label === 'Signature Studio');
  check('repli sur la config de signature (client)', byKey(fromSigners, 'CLIENT_SIGNATURE').label === 'Signature Garage Dupont');

  // Brouillon sans aucun nom figé : libellés génériques.
  const generic = deriveContractProgress(contract());
  check('sans nom connu -> libellé générique DEV', byKey(generic, 'DEV_SIGNATURE').label === 'Signature DEV');
  check('sans nom connu -> libellé générique client', byKey(generic, 'CLIENT_SIGNATURE').label === 'Signature client');

  // Nom vide/espaces = pas de nom.
  const blank = deriveContractProgress(contract({
    signersSnapshot: { developer: { companyName: '   ' }, client: null },
  }));
  check('nom vide traité comme absent', byKey(blank, 'DEV_SIGNATURE').label === 'Signature DEV');
}

// --- Robustesse -------------------------------------------------------------
section('Robustesse');
{
  // Un contrat incomplet (payload partiel) ne doit jamais faire planter le suivi.
  const p = deriveContractProgress({ status: 'DRAFT' });
  check('payload minimal toléré', p.steps.length === 6 && p.currentIndex === 0);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
