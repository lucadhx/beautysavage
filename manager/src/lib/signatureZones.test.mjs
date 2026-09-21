/* Tests des opérations sur les zones de signature (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const {
  duplicateZone, changeZoneRole, clampZone, createZone, defaultZoneName,
  missingRoles, zonesEqual, DUPLICATE_OFFSET, ROLE_COLOR,
} = await import('./signatureZones.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const zone = (over = {}) => ({
  id: 'z1', name: 'Signature Développeur', signerRole: 'DEVELOPER', page: 2,
  xRatio: 0.1, yRatio: 0.1, widthRatio: 0.22, heightRatio: 0.07, type: 'SIGNATURE', ...over,
});
const inPage = (z) =>
  z.xRatio >= 0 && z.yRatio >= 0 && z.xRatio + z.widthRatio <= 1.0000001 && z.yRatio + z.heightRatio <= 1.0000001;

// --- Duplication ------------------------------------------------------------
section('Duplication');
{
  const src = zone();
  const copy = duplicateZone(src);
  check('nouvel identifiant', copy.id !== src.id);
  check('identifiant non vide', /^z-/.test(copy.id));
  check('même page', copy.page === src.page);
  check('mêmes dimensions', copy.widthRatio === src.widthRatio && copy.heightRatio === src.heightRatio);
  check('même signataire', copy.signerRole === src.signerRole);
  check('même nom', copy.name === src.name);
  check('décalage horizontal', copy.xRatio !== src.xRatio);
  check('décalage vertical', copy.yRatio !== src.yRatio);
  check('décalage = offset attendu', Math.abs(copy.xRatio - (src.xRatio + DUPLICATE_OFFSET)) < 1e-9);
  check("l'original n'est pas muté", src.xRatio === 0.1 && src.id === 'z1');
  check('copie dans la page', inPage(copy));
}

// --- Duplication en bordure -------------------------------------------------
section('Duplication en bordure de page');
{
  // Coin bas-droit : décaler vers le bas/droite sortirait de la page.
  // (0.77 + 0.22 + 0.03 = 1.02 > 1 — à 0.75 la copie tiendrait pile.)
  const corner = zone({ xRatio: 0.77, yRatio: 0.93, widthRatio: 0.22, heightRatio: 0.07 });
  const copy = duplicateZone(corner);
  check('copie reste dans la page', inPage(copy));
  check('décalage inversé horizontalement', copy.xRatio < corner.xRatio);
  check('décalage inversé verticalement', copy.yRatio < corner.yRatio);
  check('copie visible (non superposée)', copy.xRatio !== corner.xRatio && copy.yRatio !== corner.yRatio);

  // Bord droit uniquement.
  const right = zone({ xRatio: 0.78, yRatio: 0.1 });
  const rc = duplicateZone(right);
  check('bord droit : décalage inversé en x', rc.xRatio < right.xRatio);
  check('bord droit : décalage normal en y', rc.yRatio > right.yRatio);
  check('bord droit : dans la page', inPage(rc));

  // Zone occupant presque toute la page.
  const huge = zone({ xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 });
  const hc = duplicateZone(huge);
  check('zone pleine page : copie contenue', inPage(hc));
  check('zone pleine page : dimensions préservées', hc.widthRatio === 1 && hc.heightRatio === 1);
}

// --- Changement de signataire -----------------------------------------------
section('Changement de signataire');
{
  const src = zone();
  const moved = changeZoneRole(src, 'CLIENT');
  check('rôle changé', moved.signerRole === 'CLIENT');
  check('identifiant conservé', moved.id === src.id);
  check('position conservée', moved.xRatio === src.xRatio && moved.yRatio === src.yRatio);
  check('dimensions conservées', moved.widthRatio === src.widthRatio);
  check('nom par défaut suivi du rôle', moved.name === 'Signature Client');
  check("l'original n'est pas muté", src.signerRole === 'DEVELOPER' && src.name === 'Signature Développeur');
  check('couleur dérivée du rôle', ROLE_COLOR[moved.signerRole] === '#2563eb');

  // Un nom personnalisé ne doit jamais être écrasé.
  const custom = zone({ name: 'Paraphe du gérant' });
  check('nom personnalisé préservé', changeZoneRole(custom, 'CLIENT').name === 'Paraphe du gérant');

  // Aller-retour.
  const back = changeZoneRole(moved, 'DEVELOPER');
  check('aller-retour rétablit le nom', back.name === 'Signature Développeur');
  check('changement idempotent', changeZoneRole(moved, 'CLIENT').signerRole === 'CLIENT');
}

// --- Clamp ------------------------------------------------------------------
section('Maintien dans la page');
{
  check('débordement droite corrigé', inPage(clampZone(zone({ xRatio: 0.95, widthRatio: 0.22 }))));
  check('débordement bas corrigé', inPage(clampZone(zone({ yRatio: 0.99, heightRatio: 0.07 }))));
  check('valeur négative corrigée', clampZone(zone({ xRatio: -0.5 })).xRatio === 0);
  const kept = clampZone(zone({ xRatio: 0.3, yRatio: 0.3 }));
  check('zone déjà valide inchangée', kept.xRatio === 0.3 && kept.yRatio === 0.3);
  check('dimensions non rognées', clampZone(zone({ xRatio: 0.95 })).widthRatio === 0.22);
  check('largeur > page bornée à 1', clampZone(zone({ widthRatio: 1.5 })).widthRatio === 1);
}

// --- Création ---------------------------------------------------------------
section('Création');
{
  const z = createZone(3, 'CLIENT');
  check('page respectée', z.page === 3);
  check('rôle respecté', z.signerRole === 'CLIENT');
  check('nom par défaut', z.name === defaultZoneName('CLIENT'));
  check('type SIGNATURE', z.type === 'SIGNATURE');
  check('dans la page', inPage(z));
  check('identifiants uniques', createZone(1, 'DEVELOPER').id !== createZone(1, 'DEVELOPER').id);
}

// --- Rôles manquants (contrainte de validation) ------------------------------
section('Rôles manquants');
{
  check('aucune zone -> 2 rôles manquants', missingRoles([]).length === 2);
  check('DEV seul -> client manquant', missingRoles([zone()]).join() === 'CLIENT');
  check('les deux rôles -> aucun manquant', missingRoles([zone(), zone({ id: 'z2', signerRole: 'CLIENT' })]).length === 0);
  // Basculer l'unique zone DEV vers CLIENT laisse le DEV sans zone.
  const flipped = [changeZoneRole(zone(), 'CLIENT')];
  check('changement de rôle peut créer un manque', missingRoles(flipped).join() === 'DEVELOPER');
}

// --- Modifications non enregistrées -----------------------------------------
section('Détection des modifications');
{
  const a = [zone(), zone({ id: 'z2', signerRole: 'CLIENT' })];
  check('identique -> pas de modification', zonesEqual(a, [...a]));
  check('ordre différent -> pas de modification', zonesEqual(a, [a[1], a[0]]));
  check('déplacement -> modification', !zonesEqual(a, [{ ...a[0], xRatio: 0.5 }, a[1]]));
  check('changement de rôle -> modification', !zonesEqual(a, [changeZoneRole(a[0], 'CLIENT'), a[1]]));
  check('ajout -> modification', !zonesEqual(a, [...a, zone({ id: 'z3' })]));
  check('suppression -> modification', !zonesEqual(a, [a[0]]));
  check('renommage -> modification', !zonesEqual(a, [{ ...a[0], name: 'Autre' }, a[1]]));
  check('listes vides égales', zonesEqual([], []));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
