/* AUTORITÉ UNIQUE DES MODÈLES D'E-MAIL — le Panel possède, ce projet consomme.
 *
 * ══ CE QUE CE FICHIER GARDE, ET POURQUOI IL A ÉTÉ RÉÉCRIT (L12.1) ═══════════
 *
 * Il vérifiait la convergence de QUATRE choses : les consommateurs réels, la
 * déclaration, la définition du Panel, et un registre de modèles LOCAL portant
 * sujets, HTML, variables, types et portées.
 *
 * Ce registre local a été supprimé. L'audit avait montré ce qu'il coûtait :
 * les variables restaient alignées « par chance » — rien ne le vérifiait à
 * l'exécution — mais SEPT contenus sur quatorze avaient déjà divergé de ce qui
 * partait réellement, sans le moindre signal.
 *
 * Ce que ce test garde désormais est plus court et plus fort :
 *
 *   1. la déclaration décrit exactement ce que le code envoie ;
 *   2. ce projet ne déclare QUE des modèles que le Panel accepte en portée
 *      PROJECT — un code de portée PANEL déclaré ici est un envoi qui échouera ;
 *   3. il ne subsiste AUCUNE autorité locale : ni modèle en base, ni contenu,
 *      ni route d'écriture, ni rendu de contenu ;
 *   4. la projection transporte des codes et des empreintes, JAMAIS du contenu.
 *
 * Aucune base, aucun réseau : tout est code-first, sa cohérence aussi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ENV = 'TEST';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = 'inutile';
process.env.DB_PROD = 'inutile';
process.env.JWT_SECRET = 'test';
process.env.PORT = '4159';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0'.repeat(64);

let pass = 0;
let fail = 0;
function check(nom, condition) {
  if (condition) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
}
function section(titre) { console.log(`\n${titre}`); }

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Le CODE seul, sans les commentaires.
 *
 * Indispensable ici : les fichiers de ce lot nomment précisément, dans leur
 * en-tête, les routes et les fonctions supprimées. Chercher un `router.put`
 * dans le texte brut trouverait la phrase qui explique pourquoi il n'y en a
 * plus — et le test se déclarerait rouge à cause de sa propre justification.
 */
const sansCommentaires = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '');

const usage = await import('../utils/projectEmailTemplateUsage.js');
const actions = await import('../utils/domainEventActionRegistry.js');
const { ACTION_TYPE } = await import('../utils/domainEventConstants.js');

// ═══════════════════════════════════════════════════════════════════════════
section('1 · La déclaration décrit exactement ce que le code envoie');
{
  check('aucune anomalie de cohérence', usage.validateTemplateUsage().length === 0);

  const declares = usage.declaredTemplateCodes();
  check('la déclaration n’est pas vide', declares.length > 0);
  check('elle est triée', JSON.stringify(declares) === JSON.stringify([...declares].sort()));
  check('elle est sans doublon', new Set(declares).size === declares.length);

  /** Toute action e-mail ACTIVE doit figurer dans la déclaration. */
  const parActions = usage.templatesFromEventActions();
  const manquants = parActions.filter((c) => !declares.includes(c));
  check(`toute action active est déclarée (${manquants.join(', ') || 'aucun manque'})`,
    manquants.length === 0);

  /** Et tout consommateur direct aussi. */
  const directs = usage.DIRECT_TEMPLATE_CONSUMERS.map((c) => c.templateId);
  const oublies = directs.filter((c) => !declares.includes(c));
  check(`tout consommateur direct est déclaré (${oublies.join(', ') || 'aucun oubli'})`,
    oublies.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section('2 · Aucune portée n’est plus jugée localement');
{
  const source = lire('utils/projectEmailTemplateUsage.js');
  check('plus aucun filtre `ownerScope` dans la déclaration', !/ownerScopeOf/.test(source));
  check('plus aucun import du registre local supprimé',
    !/emailTemplateRegistry/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));

  /**
   * LA RAISON D'ÊTRE DE CE RETRAIT, ET ELLE EST CONCRÈTE.
   *
   * Le filtre écartait silencieusement les codes de portée PANEL. Il a masqué
   * pendant des mois que l'alerte d'incident technique appelait un modèle
   * PANEL : elle disparaissait de la déclaration, puis échouait à l'envoi, et
   * aucun incident du parc n'a jamais pu être notifié.
   */
  check('l’alerte d’incident n’est plus une action e-mail',
    (actions.DOMAIN_EVENT_ACTION_REGISTRY['platform.incident.raised'] ?? [])
      .every((a) => a.actionType !== ACTION_TYPE.SEND_EMAIL));
  check('elle est devenue un RAPPORT au control plane',
    (actions.DOMAIN_EVENT_ACTION_REGISTRY['platform.incident.raised'] ?? [])
      .some((a) => a.actionType === ACTION_TYPE.REPORT_INCIDENT && a.enabled));
  check('elle ne nomme plus aucun modèle',
    (actions.DOMAIN_EVENT_ACTION_REGISTRY['platform.incident.raised'] ?? [])
      .every((a) => !a.templateId));
}

// ═══════════════════════════════════════════════════════════════════════════
section('3 · Parité avec le Panel — tout code déclaré est servi en portée PROJECT');
{
  const chemin = path.resolve(
    SRC, '../../../Panel/backend/src/services/email/panelEmailTemplateDefinitions.js',
  );

  if (!fs.existsSync(chemin)) {
    /**
     * Le Panel vit dans un AUTRE dépôt. On DÉCLARE le contrôle non exécuté
     * plutôt que de le déclarer vert : le seul résultat inacceptable serait de
     * croire la parité vérifiée alors que personne ne l'a regardée.
     */
    check('⚠ registre Panel absent — parité NON VÉRIFIÉE (et non « verte »)', false);
  } else {
    const panel = await import(`file://${chemin.replace(/\\/g, '/')}`);

    const inconnus = usage.declaredTemplateCodes()
      .filter((c) => !panel.templateDefinition(c));
    check(`aucun code déclaré n’est inconnu du Panel (${inconnus.join(', ') || 'aucun'})`,
      inconnus.length === 0);

    const refuses = usage.declaredTemplateCodes()
      .filter((c) => !panel.templateDefinition(c)?.scopes.includes('PROJECT'));
    check(`tout code déclaré est acceptable en portée PROJECT (${refuses.join(', ') || 'aucun refus'})`,
      refuses.length === 0);

    /**
     * Un code que le Panel ne provisionne pas d'office ne doit pas être
     * déclaré : l'instance ne serait jamais posée, et l'envoi échouerait en
     * EMAIL_TEMPLATE_NOT_CONFIGURED — le cas exact de
     * `CONTRACT_PAYMENT_RECEIVED_ADMIN`, retiré du Panel et pourtant encore
     * résolu ici avant ce lot.
     */
    const nonProvisionnes = usage.declaredTemplateCodes()
      .filter((c) => panel.templateDefinition(c)?.provisionForProjects !== true);
    check(`tout code déclaré est provisionné d’office (${nonProvisionnes.join(', ') || 'aucun'})`,
      nonProvisionnes.length === 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('4 · AUCUNE autorité locale ne subsiste');
{
  for (const disparu of [
    'models/EmailTemplate.model.js',
    'models/EmailTemplateVersion.model.js',
    'services/email/emailTemplate.service.js',
    'services/email/emailTemplateRenderer.js',
    'services/email/emailTemplateValidator.js',
    'utils/emailTemplateRegistry.js',
  ]) {
    check(`« ${disparu} » a été supprimé`, !fs.existsSync(path.join(SRC, disparu)));
  }

  /**
   * Aucune route d'écriture de modèle — la propriété centrale du lot.
   *
   * Les commentaires sont retirés AVANT de chercher : l'en-tête du fichier
   * nomme précisément les routes supprimées, et le test se serait déclaré rouge
   * à cause de la phrase qui explique pourquoi il est vert.
   */
  const routes = sansCommentaires(lire('routes/emailTemplate.routes.js'));
  check('aucun PUT sur un modèle', !/router\.put\(/.test(routes));
  check('aucun PATCH sur un modèle', !/router\.patch\(/.test(routes));
  check('aucun DELETE sur un modèle', !/router\.delete\(/.test(routes));
  check('aucune route de restauration', !/restore/.test(routes));
  check('aucune route d’historique', !/versions/.test(routes));

  /** Le chemin d'envoi ne rend plus aucun contenu, et ne lit plus de modèle. */
  const envoi = lire('services/email/emailDelivery.service.js');
  const envoiCode = envoi.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  check('l’envoi ne rend plus de contenu localement', !/renderTemplate\(/.test(envoiCode));
  check('l’envoi ne lit plus de modèle local', !/EmailTemplate\.findOne/.test(envoiCode));

  /** Le readiness n'oppose plus aucun veto de contenu. */
  const readiness = lire('services/email/emailReadiness.service.js');
  const readinessCode = readiness.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  check('le readiness ne bloque plus sur `enabled`', !/doc\.enabled/.test(readinessCode));
  check('le readiness ne valide plus de contenu', !/validateTemplate/.test(readinessCode));
  check('le readiness ne lit plus de modèle local', !/EmailTemplate/.test(readinessCode));
}

// ═══════════════════════════════════════════════════════════════════════════
section('5 · La révision est stable et sensible');
{
  const codes = usage.declaredTemplateCodes();
  const a = usage.declarationRevision(codes);
  check('deux calculs donnent la même révision', a === usage.declarationRevision(codes));
  check('l’ordre ne change pas la révision (liste déjà triée)',
    a === usage.declarationRevision([...codes].sort()));
  check('une liste différente donne une révision différente',
    usage.declarationRevision([...codes, 'AUTRE_CHOSE']) !== a);

  /**
   * ── LA RÉVISION COUVRE LES EMPREINTES DE CONTRAT (L12.1) ─────────────────
   *
   * Le déployé a montré ce que coûtait leur absence. Quand le Panel change le
   * contrat de variables d'un modèle, la liste des CODES ne bouge pas : la
   * révision restait donc identique, la déclaration n'était jamais réémise, et
   * le Panel n'apprenait jamais la nouvelle empreinte. Le contrôle de
   * compatibilité restait aveugle précisément dans le seul cas où il sert.
   */
  const avec = { [codes[0]]: 'empreinte-a' };
  const autre = { [codes[0]]: 'empreinte-b' };
  check('une empreinte de contrat change la révision',
    usage.declarationRevision(codes, avec) !== a);
  check('une empreinte DIFFÉRENTE donne une révision différente',
    usage.declarationRevision(codes, avec) !== usage.declarationRevision(codes, autre));
  check('les mêmes empreintes donnent la même révision',
    usage.declarationRevision(codes, avec) === usage.declarationRevision(codes, { ...avec }));
  check('l’ordre des empreintes n’a pas d’effet',
    usage.declarationRevision(codes, { x: '1', y: '2' })
    === usage.declarationRevision(codes, { y: '2', x: '1' }));
}

// ═══════════════════════════════════════════════════════════════════════════
section('6 · La projection porte des CODES, jamais du contenu');
{
  const sync = await import('../services/projectBridge/projectSync.service.js');
  const change = await sync.buildEmailTemplateUsageProjection();

  check('elle porte le bon entityType', change.entityType === 'PROJECT_EMAIL_TEMPLATE_USAGE');
  check('elle porte un entityId STABLE (une seule par projet)',
    change.entityId === sync.projectEntityId());
  check('sa charge utile est exactement la déclaration',
    JSON.stringify(change.payload.templateCodes) === JSON.stringify(usage.declaredTemplateCodes()));
  check('elle porte la révision',
    change.payload.revision
    === usage.declarationRevision(change.payload.templateCodes, change.payload.contractFingerprints));
  check('elle porte le champ d’empreintes de contrat',
    typeof change.payload.contractFingerprints === 'object'
    && change.payload.contractFingerprints !== null);

  /**
   * ── ET ELLE NE LE REMPLIT QUE POUR UN PANEL QUI SAIT LE LIRE ─────────────
   *
   * Les schémas d'entrée du Panel sont `.strict()`, et sa garde de version ne
   * vérifie que la MAJEURE. Un champ inconnu ferait refuser la déclaration
   * ENTIÈRE — pas seulement le champ — et la panne serait silencieuse : les
   * instances du projet cesseraient de converger sans que rien ne le dise.
   *
   * Ce test tourne SANS pont appairé, donc sans version annoncée : le champ
   * doit être présent (la forme est stable) et VIDE (rien à publier encore).
   * C'est ce qui rend l'ordre de déploiement indifférent.
   */
  check('…mais VIDE tant qu’aucun Panel n’a annoncé savoir le lire',
    Object.keys(change.payload.contractFingerprints).length === 0);

  /**
   * ── LE CONTRAT SE RAFRAÎCHIT ICI, PAS SEULEMENT AU DÉMARRAGE (L12.1) ─────
   *
   * Il n'était lu que dans `initEmailModule`, pendant l'amorçage — avant que le
   * pont ne soit branché. Le déployé l'a dit tel quel : « contrat de variables
   * non lu (NOT_PAIRED) ». Rien ne réessayait : le cache restait vide à vie, et
   * tout le contrôle de compatibilité restait inerte, silencieusement.
   *
   * On vérifie donc que la construction de la déclaration TENTE la lecture.
   */
  const source = sansCommentaires(lire('services/projectBridge/projectSync.service.js'));
  check('la déclaration rafraîchit le contrat avant de le lire',
    /refreshContracts\(\)/.test(source));
  check('…et elle ne le fait qu’auprès d’un Panel qui sait le servir',
    /panelSpeaks\(11\)[\s\S]{0,80}refreshContracts/.test(source));
  check('elle ne porte AUCUN contenu de modèle',
    !JSON.stringify(change.payload).match(/<html|<body|"subject"/i));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
