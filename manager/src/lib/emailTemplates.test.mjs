/* Tests de la logique des templates e-mail côté Manager — LECTURE SEULE (L12.1).
 *
 * ── CE QUE CE FICHIER TESTAIT, ET POURQUOI IL A CHANGÉ ──────────────────────
 *
 * Il éprouvait un éditeur : état « modifié », brouillon dérivé, champs changés,
 * insertion de variable au curseur, groupement d'erreurs de validation,
 * libellés d'origine de version. Une centaine d'assertions au service d'une
 * base de modèles locale que ce projet ne possède plus.
 *
 * Ce qui compte désormais est différent, et se vérifie ici :
 *   — aucun onglet d'édition n'existe ;
 *   — un modèle inutilisable est NOMMÉ, jamais rendu par un code brut ;
 *   — ce qui demande une action se lit en premier ;
 *   — le vocabulaire des blocages d'envoi reste traduit.
 *
 * Module PUR — aucun DOM, aucun réseau. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  VIEW_TABS, TAB_LABEL, isViewTab,
  orderedTemplates, orderedVariables,
  unusableCodeLabel, UNUSABLE_CODE_LABEL,
  readinessCodeLabel, READINESS_CODE_LABEL, isSenderMissing,
  variableTypeLabel, previewWidth, PREVIEW_WIDTHS,
} = await import('./emailTemplates.ts');

/* -------------------------------------------------------------------------- */
section('Onglets — plus aucune surface d’édition');

check('trois onglets', VIEW_TABS.length === 3);
check('aucun onglet « editor »', !VIEW_TABS.includes('editor'));
check('aucun onglet « versions »', !VIEW_TABS.includes('versions'));
check('l’aperçu vient en premier', VIEW_TABS[0] === 'preview');
check('onglet Variables présent', VIEW_TABS.includes('variables'));
check('onglet Guide présent', VIEW_TABS.includes('guide'));
check('tous les onglets ont un libellé', VIEW_TABS.every((t) => Boolean(TAB_LABEL[t])));
check('isViewTab reconnaît un onglet', isViewTab('preview'));
check('isViewTab refuse l’inconnu', !isViewTab('editor'));

/* -------------------------------------------------------------------------- */
section('Le module n’expose plus aucune primitive d’édition');

const moduleExports = await import('./emailTemplates.ts');
for (const disparu of [
  'isTemplateDirty', 'draftFromTemplate', 'changedFields', 'insertVariable',
  'usedVariableKeys', 'variableUsage', 'groupErrors', 'validationSummary',
  'validationCodeLabel', 'versionOriginLabel', 'EDITOR_TABS',
]) {
  check(`« ${disparu} » a disparu`, moduleExports[disparu] === undefined);
}

/* -------------------------------------------------------------------------- */
section('Inutilisable — la cause est NOMMÉE, jamais brute');

check('modèle non configuré',
  unusableCodeLabel('EMAIL_TEMPLATE_NOT_CONFIGURED') === 'Aucun contenu configuré pour ce projet');
check('modèle non déclaré',
  unusableCodeLabel('EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT') === 'Ce projet ne déclare pas utiliser ce modèle');
check('modèle désactivé côté Panel',
  unusableCodeLabel('PANEL_EMAIL_TEMPLATE_DISABLED') === 'Modèle désactivé');
check('code inconnu -> repli lisible', unusableCodeLabel('QUELQUE_CHOSE_DE_NEUF') === 'Envoi impossible en l’état');
check('absence de code -> repli lisible', unusableCodeLabel(null) === 'Envoi impossible en l’état');
check('aucun libellé ne laisse fuir un code brut',
  Object.values(UNUSABLE_CODE_LABEL).every((l) => !/^[A-Z_]+$/.test(l)));

/* -------------------------------------------------------------------------- */
section('Ordre d’affichage — ce qui demande une action se voit');

const modeles = [
  { templateId: 'B', name: 'Bravo', usable: true, unusableReason: null },
  { templateId: 'A', name: 'Alpha', usable: true, unusableReason: null },
  { templateId: 'C', name: 'Charlie', usable: false, unusableReason: 'EMAIL_TEMPLATE_NOT_CONFIGURED' },
];
const tries = orderedTemplates(modeles);
check('les inutilisables passent devant', tries[0].templateId === 'C');
check('les autres restent triés par nom', tries[1].name === 'Alpha' && tries[2].name === 'Bravo');
check('le tri ne mute pas l’entrée', modeles[0].templateId === 'B');

const variables = [
  { key: 'z.optionnelle', type: 'TEXT', required: false },
  { key: 'a.obligatoire', type: 'URL', required: true },
];
const varsTriees = orderedVariables(variables);
check('les variables obligatoires d’abord', varsTriees[0].key === 'a.obligatoire');
check('le tri des variables ne mute pas l’entrée', variables[0].key === 'z.optionnelle');

/* -------------------------------------------------------------------------- */
section('Prérequis d’envoi');

check('expéditeur manquant traduit', readinessCodeLabel('SENDER_NOT_CONFIGURED') === 'Aucun expéditeur');
check('plateforme injoignable traduite',
  readinessCodeLabel('TEMPLATE_AUTHORITY_UNREACHABLE') === 'Plateforme injoignable');
check('code inconnu -> repli', readinessCodeLabel('XYZ') === "Condition d'envoi non remplie");
check('aucun libellé de readiness ne laisse fuir un code brut',
  Object.values(READINESS_CODE_LABEL).every((l) => !/^[A-Z_]+$/.test(l)));
check('isSenderMissing détecte le bon blocage',
  isSenderMissing({ ready: false, blockers: [{ code: 'SENDER_NOT_CONFIGURED', message: '' }], warnings: [] }));
check('isSenderMissing ignore les autres blocages',
  !isSenderMissing({ ready: false, blockers: [{ code: 'NO_RECIPIENT', message: '' }], warnings: [] }));
check('isSenderMissing tolère l’absence', !isSenderMissing(null));

/* -------------------------------------------------------------------------- */
section('Types de variables et aperçu');

check('type MONEY traduit', variableTypeLabel('MONEY') === 'Montant');
check('type inconnu -> repli neutre', variableTypeLabel('QUOI') === 'Valeur');
check('largeur bureau canonique', previewWidth('desktop') === 600);
check('largeur mobile contraignante', previewWidth('mobile') === 375);
check('les deux largeurs sont déclarées', Object.keys(PREVIEW_WIDTHS).length === 2);

/* -------------------------------------------------------------------------- */
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
