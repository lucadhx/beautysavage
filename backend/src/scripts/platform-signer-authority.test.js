/**
 * LE REPRÉSENTANT DE LA PLATEFORME — une seule autorité, et jamais un compte.
 *
 * ══ CE QUE CETTE SUITE VERROUILLE ═══════════════════════════════════════════
 *
 * Le signataire qui engage l'entreprise développeur est publié par le PANEL,
 * une fois, pour tout le parc. Ce projet ne le détient pas, ne le devine pas,
 * et n'en garde aucune copie faisant autorité.
 *
 * ══ POURQUOI IL N'EST PAS DÉRIVÉ D'UN COMPTE ═══════════════════════════════
 *
 * La tentation est réelle : le Panel a des comptes, dont un souverain, et l'on
 * voudrait que « ça marche tout seul ». Mais un compte Panel porte `email`,
 * `role`, `enabled`, `displayName` — et RIEN d'autre. Ni prénom, ni nom, ni
 * fonction.
 *
 * Or une demande Yousign exige `firstName`, `lastName` et `email`, et les
 * refuse toutes trois manquantes. Dériver le signataire d'un compte imposerait
 * donc de fabriquer une identité civile à partir d'un libellé de connexion —
 * sur un document qui ENGAGE JURIDIQUEMENT une entreprise.
 *
 * C'est la raison pour laquelle le modèle du Panel écrit noir sur blanc :
 * « un compte sert à se connecter, pas à signer ». Cette suite empêche que
 * quelqu'un revienne dessus sans s'en rendre compte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const ici = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(ici, '..');

/** Lit un fichier en RETIRANT commentaires et chaînes de doc : on juge le CODE. */
function codeDe(relatif) {
  const brut = fs.readFileSync(path.join(srcRoot, relatif), 'utf8');
  return brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Parcourt le code applicatif, hors tests et hors moteurs standards. */
function fichiersApplicatifs() {
  const sortie = [];
  const ignorer = new Set(['scripts', 'deployment-engine', 'duplication-engine', 'node_modules']);
  const marcher = (dir, profondeur = 0) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (profondeur === 0 && ignorer.has(e.name)) continue;
      const complet = path.join(dir, e.name);
      if (e.isDirectory()) marcher(complet, profondeur + 1);
      else if (e.name.endsWith('.js')) sortie.push(path.relative(srcRoot, complet));
    }
  };
  marcher(srcRoot);
  return sortie;
}

const applicatifs = fichiersApplicatifs();

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Aucun signataire développeur codé en dur');
{
  /**
   * Un signataire écrit dans le code survivrait à tout changement de
   * représentant, et signerait au nom de quelqu'un qui n'engage plus rien.
   */
  const fautifs = [];
  for (const f of applicatifs) {
    const code = codeDe(f);
    /**
     * Un signataire codé en dur, c'est les TROIS champs ensemble dans un même
     * objet. Exiger la conjonction évite de confondre avec un dictionnaire de
     * libellés (`firstName: 'prénom'`) ou un schéma de validation.
     */
    for (const m of code.matchAll(/\{[^{}]{0,400}\}/g)) {
      const obj = m[0];
      const aPrenom = /firstName\s*:\s*['"`][A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,}['"`]/.test(obj);
      const aNom = /lastName\s*:\s*['"`][A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,}['"`]/.test(obj);
      const aMail = /email\s*:\s*['"`][^'"`]+@[^'"`]+['"`]/.test(obj);
      if (aPrenom && aNom && aMail) fautifs.push(`${f} (signataire complet littéral)`);
    }
  }
  check(`aucun signataire littéral dans le code applicatif${fautifs.length ? ` — ${fautifs.join(', ')}` : ''}`,
    fautifs.length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · Aucune adresse e-mail de représentant codée en dur');
{
  const fautifs = [];
  for (const f of applicatifs) {
    const code = codeDe(f);
    for (const m of code.matchAll(/['"`]([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})['"`]/g)) {
      const adresse = m[1].toLowerCase();
      /** Les adresses d'EXEMPLE et de test sont licites : elles ne désignent personne. */
      if (/(example|exemple|entreprise|test|localhost|invalid|\.test$|@sentry|noreply|no-reply)/.test(adresse)) continue;
      fautifs.push(`${f} → ${adresse}`);
    }
  }
  check(`aucune adresse réelle codée en dur${fautifs.length ? ` — ${fautifs.slice(0, 3).join(', ')}` : ''}`,
    fautifs.length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · Le signataire n’est JAMAIS dérivé d’un compte');
{
  /**
   * Un compte Panel porte `email`, `role`, `enabled`, `displayName`. Aucune
   * identité civile. Le déduire d'un `displayName` fabriquerait un nom de
   * personne sur un acte juridique.
   */
  const contrat = codeDe('services/contract.service.js');
  check('le service de contrat ne lit aucun RÔLE de compte pour signer',
    !/SUPER_ADMIN|PANEL_ROLES/.test(contrat));
  check('il lit l’identité PUBLIÉE par le Panel',
    /getPublishedDeveloperIdentity/.test(contrat));

  const identite = codeDe('services/panelConfiguration/developerIdentity.service.js');
  check('la lecture d’identité ne dérive pas non plus d’un compte',
    !/SUPER_ADMIN|PANEL_ROLES|PanelUser/.test(identite));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · Aucun accès direct à la base du Panel, aucun credential local');
{
  const fautifs = [];
  for (const f of applicatifs) {
    const code = codeDe(f);
    /**
     * On vise un ACCÈS à la base du Panel — un modèle, une collection, une
     * base nommée. Pas la simple mention de `panelUserId`, qui est un CLAIM
     * d'assertion fédérée et voyage légitimement par le pont.
     */
    if (/mongoose\.model\(\s*['"`]PanelUser|collection\(\s*['"`]panelusers|dbName\s*:\s*['"`]panel_(test|prod)/i.test(code)) {
      fautifs.push(`${f} (accès direct à la base du Panel)`);
    }
    if (/YOUSIGN_API_KEY|yousign[_-]?secret/i.test(code)) fautifs.push(`${f} (credential Yousign local)`);
  }
  check(`aucune lecture directe du Panel ni credential local${fautifs.length ? ` — ${fautifs.join(', ')}` : ''}`,
    fautifs.length === 0);

  const yousign = codeDe('services/signature/signature.service.js');
  check('Yousign passe par la passerelle de capacités du Panel',
    /capabilityClient|invokeCapability/i.test(yousign));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · Le refus DÉSIGNE la plateforme — il n’envoie pas chercher ici');
{
  const contrat = fs.readFileSync(path.join(srcRoot, 'services/contract.service.js'), 'utf8');
  check('le refus porte un code métier stable',
    contrat.includes('PLATFORM_SIGNER_NOT_CONFIGURED'));
  check('…et nomme la plateforme dans le message',
    /plateforme \(Panel/i.test(contrat));

  /**
   * Le signataire CLIENT, lui, se configure BIEN dans ce projet : les deux
   * messages ne doivent pas se confondre, sinon on renvoie l'utilisateur au
   * mauvais endroit une fois sur deux.
   */
  check('le message CLIENT reste distinct de celui de la plateforme',
    /SIGNER_PARTY_LABEL/.test(contrat) && /party === 'developer'/.test(contrat));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · Fail closed — rien n’est envoyé sans identité complète');
{
  const yousign = codeDe('services/signature/signature.service.js');
  check('Yousign refuse un signataire sans prénom, nom ou e-mail',
    /if\s*\(!firstName\s*\|\|\s*!lastName\s*\|\|\s*!email\)/.test(yousign));

  const contrat = codeDe('services/contract.service.js');
  check('aucune identité de repli n’est fabriquée en cas d’absence',
    !/\|\|\s*['"`](Développeur|Representant|Signataire)['"`]/i.test(contrat));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
