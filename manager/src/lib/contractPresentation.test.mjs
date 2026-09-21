/* ÉTAT AFFICHÉ D'UN CONTRAT — un seul calcul, DEV et client.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * La scène DEV décidait par une cascade de ternaires terminée par un `else` :
 * « Préparation / Contrat en attente / Ce contrat n'est pas encore parti à la
 * signature. » Ce n'était pas un état, c'était le RESTE. Un contrat validé sans
 * signature requise y tombait : l'écran annonçait une signature qui n'aurait
 * jamais lieu, alors qu'il attendait un règlement.
 *
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { getContractPresentationState } = await import('./contractPresentation.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

/** Contrat validé, signature NON requise, rien de payé. */
function contract(over = {}) {
  return {
    reference: 'CTR-2026-0001',
    name: 'Contrat',
    status: 'INACTIVE',
    step: 'LAUNCH_FEE',
    signatureApplicable: true,
    devSigned: false,
    adminSigned: false,
    launchFeeRequired: false,
    launchFeeSatisfied: true,
    subscriptionRequired: false,
    subscriptionSatisfied: true,
    document: { hasOriginal: true, hasSigned: false },
    ...over,
  };
}

/** Tout le texte présenté, réuni — c'est là qu'un mensonge se voit. */
const texte = (e) => [e.badge, e.title, e.description, e.next, e.signatureNote]
  .filter(Boolean).join(' • ').toLowerCase();

/* ────────────────────────────────────────────────────────────────────────── */
section('A. Signature REQUISE — l’état signature existe toujours');
{
  const aSigner = getContractPresentationState(
    contract({ status: 'PENDING_DEV_SIGNATURE', step: 'SIGNATURE' }));
  check('le DEV doit signer', aSigner.phase === 'DEV_SIGNATURE');
  check('badge « En attente de signature »', aSigner.badge === 'En attente de signature');
  check('la prochaine action est la signature', aSigner.next === 'Signer le contrat');
  check('c’est au DEV d’agir', aSigner.actor === 'DEV');
  check('aucune mention « non requise »', aSigner.signatureNote === null);

  const clientSigne = getContractPresentationState(
    contract({ status: 'INACTIVE', step: 'SIGNATURE', devSigned: true }));
  check('DEV signé → on attend le client', clientSigne.phase === 'CLIENT_SIGNATURE');
  check('…et c’est au client d’agir', clientSigne.actor === 'CLIENT');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('B. Signature NON requise + frais de mise en service dus');
{
  const e = getContractPresentationState(contract({
    signatureApplicable: false,
    step: 'LAUNCH_FEE',
    launchFeeRequired: true,
    launchFeeSatisfied: false,
  }));
  check('état principal = frais de mise en service', e.phase === 'LAUNCH_FEE');
  check('badge exact',
    e.badge === 'En attente du règlement des frais de mise en service');
  check('sous-état « Signature non requise »', e.signatureNote === 'Signature non requise');
  check('le sous-état ne REMPLACE pas l’état principal',
    e.badge !== e.signatureNote && e.badge.includes('frais'));
  check('prochaine action = le règlement des frais',
    e.next === 'Règlement des frais de mise en service par le client');
  check('JAMAIS « en attente de signature »', !texte(e).includes('attente de signature'));
  check('JAMAIS « pas encore parti à la signature »',
    !texte(e).includes('parti à la signature'));
  check('JAMAIS « contrat en attente » tout court', !texte(e).includes('contrat en attente'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('C. Signature NON requise + aucun frais + abonnement à régler');
{
  const e = getContractPresentationState(contract({
    signatureApplicable: false,
    step: 'SUBSCRIPTION',
    launchFeeRequired: false,
    launchFeeSatisfied: true,
    subscriptionRequired: true,
    subscriptionSatisfied: false,
  }));
  check('état principal = abonnement', e.phase === 'SUBSCRIPTION');
  check('badge exact', e.badge === "En attente du règlement de l'abonnement");
  check('sous-état conservé', e.signatureNote === 'Signature non requise');
  check('prochaine action = souscription', /abonnement/i.test(e.next));
  check('aucun mot de signature en attente', !texte(e).includes('attente de signature'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('D. Signature NON requise + aucune étape financière restante');
{
  const pret = getContractPresentationState(contract({
    signatureApplicable: false, step: 'ACTIVATION',
  }));
  check('prêt à activer', pret.phase === 'READY_TO_ACTIVATE');
  check('badge « Prêt à activer »', pret.badge === 'Prêt à activer');
  check('la prochaine étape est la mise en ligne', /en ligne/i.test(pret.next));

  const enCours = getContractPresentationState(contract({
    signatureApplicable: false, status: 'ACTIVATION_IN_PROGRESS', step: 'ACTIVATION',
  }));
  check('activation lancée → « Activation en cours »', enCours.phase === 'ACTIVATING');
  check('…badge conforme au statut réel', enCours.badge === 'Activation en cours');

  const actif = getContractPresentationState(contract({
    signatureApplicable: false, status: 'ACTIVE', step: 'DONE',
  }));
  check('contrat actif', actif.phase === 'LIVE');
  check('…ton positif', actif.tone === 'success');
  check('…plus rien à attendre', actif.next === null);
  // Le contrat vit encore : dire comment il a été conclu reste utile.
  check('…le sous-état reste lisible sur un contrat actif',
    actif.signatureNote === 'Signature non requise');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('E. Contrat résilié ou terminé — jamais une étape de préparation');
{
  // La machine ne rend `DONE` que si le statut vaut ACTIVE : un contrat mort
  // garde une étape « abonnement ». Sans priorité explicite, l'écran proposerait
  // de souscrire sur un contrat terminé.
  for (const [status, phase] of [['ENDED', 'ENDED'], ['CANCELLED', 'CANCELLED'], ['FAILED', 'FAILED']]) {
    const e = getContractPresentationState(contract({
      status, step: 'SUBSCRIPTION', subscriptionRequired: true, subscriptionSatisfied: false,
    }));
    check(`${status} → état terminal, pas l’étape dérivée`, e.phase === phase);
    check(`${status} → aucune préparation annoncée`, !texte(e).includes('préparation'));
    check(`${status} → aucun règlement réclamé`, !texte(e).includes('règlement'));
  }

  const resilie = getContractPresentationState(contract({ status: 'CANCEL_AT_PERIOD_END', step: 'DONE' }));
  check('résilié à l’échéance → état propre', resilie.phase === 'ENDING');
  check('…ton d’avertissement', resilie.tone === 'warning');

  // Sur un contrat clos, « Signature non requise » n'apprend plus rien.
  const clos = getContractPresentationState(contract({ status: 'ENDED', signatureApplicable: false }));
  check('contrat clos → pas de sous-état de signature', clos.signatureNote === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('F. Brouillon — préparation, sans promesse de signature');
{
  const requise = getContractPresentationState(contract({ status: 'DRAFT', step: 'SIGNATURE' }));
  check('brouillon reconnu', requise.phase === 'DRAFT');
  check('…il partira à la signature', requise.description.includes('signature'));

  const sans = getContractPresentationState(
    contract({ status: 'DRAFT', step: 'SIGNATURE', signatureApplicable: false }));
  check('brouillon sans signature → même phase', sans.phase === 'DRAFT');
  check('…aucune signature promise', !texte(sans).includes('attente de signature'));
  check('…et le sous-état l’annonce', sans.signatureNote === 'Signature non requise');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('G. Priorité des états — rien n’écrase une étape plus actuelle');
{
  // Le filet : une charge utile qui annoncerait SIGNATURE alors que la
  // signature n'est pas requise ne doit pas ressortir en état de signature.
  const incoherent = getContractPresentationState(contract({
    signatureApplicable: false, step: 'SIGNATURE',
    launchFeeRequired: true, launchFeeSatisfied: false,
  }));
  check('étape SIGNATURE + signature non requise → étape financière réelle',
    incoherent.phase === 'LAUNCH_FEE');
  check('…sans inventer de transition', !texte(incoherent).includes('attente de signature'));

  // Le statut prime sur l'étape dérivée.
  const actifMalgreEtape = getContractPresentationState(contract({ status: 'ACTIVE', step: 'LAUNCH_FEE' }));
  check('ACTIF prime sur l’étape dérivée', actifMalgreEtape.phase === 'LIVE');

  // Les frais priment sur l'abonnement (ordre de la machine).
  const deuxDus = getContractPresentationState(contract({
    step: 'LAUNCH_FEE', signatureApplicable: false,
    launchFeeRequired: true, launchFeeSatisfied: false,
    subscriptionRequired: true, subscriptionSatisfied: false,
  }));
  check('frais avant abonnement', deuxDus.phase === 'LAUNCH_FEE');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('H. DEV et ADMIN — même état, deux vocabulaires');
{
  const cas = [
    contract({ signatureApplicable: false, step: 'LAUNCH_FEE', launchFeeRequired: true, launchFeeSatisfied: false }),
    contract({ signatureApplicable: false, step: 'SUBSCRIPTION', subscriptionRequired: true, subscriptionSatisfied: false }),
    contract({ signatureApplicable: false, step: 'ACTIVATION' }),
    contract({ status: 'PENDING_DEV_SIGNATURE', step: 'SIGNATURE' }),
    contract({ status: 'ACTIVE', step: 'DONE' }),
    contract({ status: 'ENDED', step: 'SUBSCRIPTION' }),
    contract({ status: 'DRAFT', step: 'SIGNATURE' }),
  ];
  let memePhase = true;
  let memeBadge = true;
  let textesDistincts = 0;
  for (const c of cas) {
    const dev = getContractPresentationState(c, 'DEV');
    const admin = getContractPresentationState(c, 'ADMIN');
    if (dev.phase !== admin.phase) memePhase = false;
    if (dev.badge !== admin.badge || dev.tone !== admin.tone) memeBadge = false;
    if (dev.title !== admin.title) textesDistincts += 1;
  }
  check('la PHASE est identique dans les deux vues', memePhase);
  check('le badge et le ton aussi', memeBadge);
  check('seules les phrases diffèrent', textesDistincts >= 5);

  // Le client ne lit ni statut interne, ni nom de prestataire.
  /**
   * Les DEUX prestataires de signature sont proscrits, l'ancien comme le
   * nouveau : le client n'a jamais eu à connaître celui d'hier, il n'a pas
   * davantage à connaître celui d'aujourd'hui. La bascule ne doit pas servir
   * d'occasion pour faire entrer un nom là où aucun n'était admis.
   */
  const interdits = ['yousign', 'opensign', 'stripe', 'inactive', 'draft', 'pending_dev', 'not_required', 'webhook'];
  let jargon = null;
  for (const c of cas) {
    const t = texte(getContractPresentationState(c, 'ADMIN'));
    for (const mot of interdits) if (t.includes(mot)) jargon = `${mot} → ${t}`;
  }
  if (jargon) console.error(`      → ${jargon}`);
  check('aucun jargon technique côté client', jargon === null);

  // Et surtout : sur AUCUN de ces cas sans signature, le mot interdit.
  let menteur = null;
  for (const c of cas.filter((x) => x.signatureApplicable === false)) {
    for (const vue of ['DEV', 'ADMIN']) {
      const t = texte(getContractPresentationState(c, vue));
      if (t.includes('attente de signature') || t.includes('parti à la signature')
        || t.includes('signature à préparer') || t.includes('signature manquante')) {
        menteur = `${vue}: ${t}`;
      }
    }
  }
  check('aucune vue n’annonce une signature quand elle n’est pas requise', menteur === null);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
