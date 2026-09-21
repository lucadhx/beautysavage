import mongoose from 'mongoose';
import { z, ZodIssueCode, ZodParsedType } from 'zod';

/**
 * LES DEUX VALIDATEURS DU BACKEND PARLENT FRANÇAIS — zod et mongoose.
 *
 * Ils ne sont pas ici par commodité de rangement : ils ferment le MÊME défaut,
 * par le MÊME moyen, et le fermer d'un seul côté n'aurait rien réglé. Les deux
 * alimentent `normalizeValidationError`, qui remonte au client le message du
 * premier champ refusé — sans savoir, ni avoir à savoir, lequel des deux
 * moteurs a parlé.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Le gestionnaire d'erreurs remonte au client le message du PREMIER champ
 * refusé (`normalizeValidationError`). C'est le bon choix : « Données
 * invalides » n'aide personne quand un champ est identifiable.
 *
 * Mais une contrainte zod sans message explicite rend celui de la bibliothèque,
 * et il est en anglais. Un propriétaire francophone qui dépassait la longueur
 * d'un libellé lisait donc, dans un Manager entièrement français :
 *
 *     String must contain at most 40 character(s)
 *
 * Ce n'était pas une faute de traduction oubliée à un endroit : sur les 156
 * contraintes des validateurs de ce backend, 97 n'ont pas de message propre —
 * et c'est normal, la plupart ne sont pas censées être atteintes par un humain.
 * Les rédiger une à une aurait laissé passer la 98ᵉ, écrite demain.
 *
 * ══ POURQUOI UNE CARTE GLOBALE, ET NON 97 MESSAGES ══════════════════════════
 *
 * `z.setErrorMap` s'applique à TOUT ce que zod refuse dans ce processus, y
 * compris aux schémas qui n'existent pas encore. Un message explicite écrit sur
 * une contrainte garde la priorité : cette carte n'est consultée que lorsque
 * personne n'a rien dit. Elle ne masque donc aucune rédaction volontaire — elle
 * remplace le SILENCE, jamais la parole.
 *
 * ══ CE QU'ELLE NE FAIT PAS ══════════════════════════════════════════════════
 *
 * Elle ne rend pas les messages « jolis » : un refus reste un refus, et le
 * champ concerné voyage à côté (`details[].path`). Elle garantit seulement
 * qu'aucune phrase anglaise ne franchit la frontière du produit.
 */

/** Les types zod, nommés en français — « une chaîne de caractères ». */
const TYPES = {
  [ZodParsedType.string]: 'une chaîne de caractères',
  [ZodParsedType.number]: 'un nombre',
  [ZodParsedType.nan]: 'un nombre',
  [ZodParsedType.bigint]: 'un nombre entier',
  [ZodParsedType.boolean]: 'un booléen',
  [ZodParsedType.date]: 'une date',
  [ZodParsedType.symbol]: 'un symbole',
  [ZodParsedType.function]: 'une fonction',
  [ZodParsedType.undefined]: 'une valeur absente',
  [ZodParsedType.null]: 'une valeur nulle',
  [ZodParsedType.array]: 'une liste',
  [ZodParsedType.object]: 'un objet',
  [ZodParsedType.unknown]: 'une valeur',
  [ZodParsedType.promise]: 'une promesse',
  [ZodParsedType.void]: 'aucune valeur',
  [ZodParsedType.never]: 'aucune valeur possible',
  [ZodParsedType.map]: 'une table',
  [ZodParsedType.set]: 'un ensemble',
};

const nomType = (t) => TYPES[t] ?? String(t);

/** « caractère » / « caractères » — un pluriel faux se remarque plus qu'un texte anglais. */
const pluriel = (n, singulier, plurielMot = `${singulier}s`) => (n > 1 ? plurielMot : singulier);

/** Les validations de chaîne nommées, telles qu'un utilisateur les comprend. */
const FORMATS = {
  email: 'Adresse e-mail invalide.',
  url: 'Adresse web invalide.',
  uuid: 'Identifiant invalide.',
  cuid: 'Identifiant invalide.',
  cuid2: 'Identifiant invalide.',
  ulid: 'Identifiant invalide.',
  regex: 'Format invalide.',
  datetime: 'Date invalide.',
  date: 'Date invalide.',
  time: 'Heure invalide.',
  duration: 'Durée invalide.',
  ip: 'Adresse IP invalide.',
  emoji: 'Émoji attendu.',
  base64: 'Contenu encodé invalide.',
};

/**
 * @param {import('zod').ZodIssueOptionalMessage} issue
 * @param {{defaultError: string, data: unknown}} ctx
 * @returns {{message: string}}
 */
export function carteErreursFrancaise(issue, ctx) {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) return { message: 'Champ obligatoire.' };
      if (issue.received === ZodParsedType.null) return { message: 'Ce champ ne peut pas être vide.' };
      return {
        message: `Type attendu : ${nomType(issue.expected)} (reçu : ${nomType(issue.received)}).`,
      };

    case ZodIssueCode.invalid_literal:
      return { message: 'Valeur non autorisée pour ce champ.' };

    case ZodIssueCode.unrecognized_keys:
      return {
        message: `Champ non reconnu : ${(issue.keys ?? []).join(', ')}.`,
      };

    case ZodIssueCode.invalid_union:
      return { message: 'Aucun des formats acceptés ne correspond à cette valeur.' };

    case ZodIssueCode.invalid_enum_value:
      return {
        message: `Valeur inconnue. Attendu l’une de : ${(issue.options ?? []).join(', ')}.`,
      };

    case ZodIssueCode.invalid_arguments:
      return { message: 'Arguments invalides.' };

    case ZodIssueCode.invalid_return_type:
      return { message: 'Valeur de retour invalide.' };

    case ZodIssueCode.invalid_date:
      return { message: 'Date invalide.' };

    case ZodIssueCode.invalid_string: {
      const v = issue.validation;
      if (typeof v === 'object' && v !== null) {
        if ('startsWith' in v) return { message: `Doit commencer par « ${v.startsWith} ».` };
        if ('endsWith' in v) return { message: `Doit finir par « ${v.endsWith} ».` };
        if ('includes' in v) return { message: `Doit contenir « ${v.includes} ».` };
      }
      return { message: FORMATS[v] ?? 'Format invalide.' };
    }

    case ZodIssueCode.too_small: {
      const n = Number(issue.minimum);
      if (issue.type === 'string') {
        if (n === 1) return { message: 'Champ obligatoire.' };
        return {
          message: `${n} ${pluriel(n, 'caractère')} au minimum.`,
        };
      }
      if (issue.type === 'array') {
        if (n === 1) return { message: 'Au moins un élément est requis.' };
        return { message: `${n} ${pluriel(n, 'élément')} au minimum.` };
      }
      if (issue.type === 'date') return { message: 'Date trop ancienne.' };
      return {
        message: issue.inclusive
          ? `La valeur doit être supérieure ou égale à ${n}.`
          : `La valeur doit être strictement supérieure à ${n}.`,
      };
    }

    case ZodIssueCode.too_big: {
      const n = Number(issue.maximum);
      if (issue.type === 'string') {
        return { message: `${n} ${pluriel(n, 'caractère')} au maximum.` };
      }
      if (issue.type === 'array') {
        return { message: `${n} ${pluriel(n, 'élément')} au maximum.` };
      }
      if (issue.type === 'date') return { message: 'Date trop lointaine.' };
      return {
        message: issue.inclusive
          ? `La valeur doit être inférieure ou égale à ${n}.`
          : `La valeur doit être strictement inférieure à ${n}.`,
      };
    }

    case ZodIssueCode.not_multiple_of:
      return { message: `La valeur doit être un multiple de ${issue.multipleOf}.` };

    case ZodIssueCode.not_finite:
      return { message: 'La valeur doit être un nombre fini.' };

    case ZodIssueCode.custom:
      /*
        Un refinement SANS message est le seul cas où l'on ne peut rien dire de
        précis : personne n'a nommé la règle. On reste explicite sur ce point
        plutôt que d'inventer une raison.
      */
      return { message: ctx.defaultError === 'Invalid input' ? 'Valeur invalide.' : ctx.defaultError };

    default:
      return { message: 'Valeur invalide.' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   MONGOOSE — la seconde source de phrases anglaises
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * MONGOOSE VALIDE APRÈS ZOD, ET SES MESSAGES SORTAIENT AUSSI EN ANGLAIS.
 *
 * Les validateurs zod de ce backend sont volontairement `passthrough()` :
 * ils refusent ce qui décide d'un refus et laissent la structure profonde au
 * schéma mongoose, qui la connaît (cf. `content.validator.js`). Autrement dit,
 * une part des refus que voit l'utilisateur ne vient PAS de zod — elle vient de
 * mongoose, dont les messages par défaut disent :
 *
 *     Path `value` is required.
 *     Path `label` (`…`) is longer than the maximum allowed length (40).
 *
 * `mongoose.Error.messages` est la table que mongoose consulte lorsqu'un
 * `required`, `min`, `max`, `minlength`, `maxlength` ou `enum` n'a pas reçu de
 * message explicite. Un message écrit dans un modèle garde la priorité — ici
 * encore, on remplace le silence, jamais la parole.
 *
 * Les jetons `{PATH}`, `{VALUE}`, `{MINLENGTH}`, `{MAXLENGTH}` sont substitués
 * par mongoose. On garde `{PATH}` : un refus qui ne nomme pas son champ oblige
 * à deviner lequel des vingt champs de l'écran est en cause.
 */
/**
 * LES PHRASES ANGLAISES D'ORIGINE — relevées AVANT de les remplacer.
 *
 * Elles servent à réparer les schémas déjà compilés (voir plus bas). Le relevé
 * est fait à l'import de CE module, donc forcément avant toute traduction :
 * personne d'autre ne touche à cette table.
 */
const ANGLAIS_ORIGINE = JSON.parse(JSON.stringify(mongoose.Error.messages));

export function installerMessagesMongooseFrancais() {
  const m = mongoose.Error.messages;

  m.general.default = 'Valeur invalide.';
  m.general.required = 'Le champ « {PATH} » est obligatoire.';

  m.Number.min = 'Le champ « {PATH} » doit être supérieur ou égal à {MIN}.';
  m.Number.max = 'Le champ « {PATH} » doit être inférieur ou égal à {MAX}.';
  m.Number.enum = 'Valeur non autorisée pour le champ « {PATH} ».';

  m.Date.min = 'La date « {PATH} » est antérieure à la limite ({MIN}).';
  m.Date.max = 'La date « {PATH} » est postérieure à la limite ({MAX}).';

  m.String.enum = 'Valeur non autorisée pour le champ « {PATH} ».';
  m.String.match = 'Le format du champ « {PATH} » est invalide.';
  m.String.minlength = 'Le champ « {PATH} » doit compter au moins {MINLENGTH} caractères.';
  m.String.maxlength = 'Le champ « {PATH} » dépasse la longueur maximale de {MAXLENGTH} caractères.';
}

/**
 * RÉPARE LES SCHÉMAS DÉJÀ COMPILÉS — parce que mongoose FIGE ses phrases.
 *
 * ══ LE PIÈGE ═══════════════════════════════════════════════════════════════
 *
 * `mongoose.Error.messages` n'est pas consulté au moment du refus : il l'est
 * au moment où le SCHÉMA EST DÉFINI. `required: true` copie la phrase dans le
 * validateur, une fois pour toutes. Traduire la table après l'import du
 * premier modèle ne change donc RIEN aux modèles déjà chargés — et le premier
 * essai de cette correction rendait encore « Path `value` is required. ».
 *
 * Imposer un ordre d'import aurait été une règle invisible, qu'une recette
 * écrite dans six mois violerait sans que rien ne le signale. On rend donc
 * l'ordre INDIFFÉRENT : les modèles chargés ensuite lisent la table traduite,
 * ceux chargés avant sont réparés ici.
 *
 * ══ ON NE TOUCHE QU'AUX PHRASES QUE PERSONNE N'A ÉCRITES ═══════════════════
 *
 * Le remplacement n'a lieu que si la phrase du validateur est EXACTEMENT l'une
 * des phrases par défaut relevées à l'import. Un message rédigé dans un modèle
 * — « Le mot de passe est requis pour un compte actif. » — ne correspond à
 * aucune, et reste donc intact.
 */
function traduireSchemasDejaCompiles() {
  const correspondances = [];
  for (const [famille, entrees] of Object.entries(ANGLAIS_ORIGINE)) {
    if (!entrees || typeof entrees !== 'object') continue;
    for (const [regle, anglais] of Object.entries(entrees)) {
      const francais = mongoose.Error.messages?.[famille]?.[regle];
      if (typeof anglais === 'string' && typeof francais === 'string' && anglais !== francais) {
        correspondances.push([anglais, francais]);
      }
    }
  }
  if (correspondances.length === 0) return;
  const table = new Map(correspondances);

  /*
    LA DESCENTE DANS LES SOUS-SCHÉMAS N'EST PAS UN LUXE.

    Les champs qui refusent vraiment sont presque tous DANS des sous-documents :
    `keyFigures[].value`, `media[].key`, `blocks[].type`. `eachPath` sur le
    schéma racine ne rend qu'un type « tableau de documents » — la première
    version de cette réparation ne voyait donc AUCUN des champs concernés, et
    « Path `value` is required. » sortait toujours en anglais.

    `vus` protège des schémas partagés (`mediaDescriptor.schema.js` est monté
    par cinq modèles) et de tout cycle.
  */
  const vus = new Set();
  const parcourir = (schema) => {
    if (!schema || vus.has(schema)) return;
    vus.add(schema);
    schema.eachPath((_chemin, type) => {
      for (const validateur of type?.validators ?? []) {
        if (typeof validateur.message === 'string' && table.has(validateur.message)) {
          validateur.message = table.get(validateur.message);
        }
      }
      parcourir(type?.schema ?? type?.caster?.schema);
    });
    for (const enfant of schema.childSchemas ?? []) parcourir(enfant?.schema);
  };

  for (const modele of Object.values(mongoose.models)) parcourir(modele.schema);
}

/**
 * Installe les DEUX cartes. Appelée une fois par processus — `setErrorMap` et
 * `Error.messages` sont des états de processus ; les rappeler à chaud ne ferait
 * que masquer un appel manquant ailleurs.
 *
 * Deux points d'appel, et c'est délibéré : `createApp()` couvre l'API, et
 * `connectDatabase()` couvre les scripts, migrations et recettes qui écrivent
 * en base SANS monter le serveur HTTP. Aucun chemin d'écriture n'échappe aux
 * deux à la fois.
 */
export function installerMessagesDeValidationFrancais() {
  z.setErrorMap(carteErreursFrancaise);
  installerMessagesMongooseFrancais();
  traduireSchemasDejaCompiles();
}

export default installerMessagesDeValidationFrancais;
