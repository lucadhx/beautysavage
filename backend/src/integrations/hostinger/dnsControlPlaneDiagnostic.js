/**
 * DIAGNOSTIC DE LA GESTION DNS — par le plan de contrôle, et par lui seul (L9.2).
 *
 * ══ CE QU'IL REMPLACE, ET POURQUOI C'ÉTAIT DANGEREUX ════════════════════════
 *
 * Deux surfaces éprouvaient encore la clé Hostinger LOCALE : le bouton
 * « Tester » de la page Intégrations, et le garde-fou d'avant publication de
 * l'assistant de déploiement. Depuis que le DNS passe par le Panel, elles
 * mentaient toutes les deux, et dans le sens le plus coûteux :
 *
 *   · un projet SANS clé locale — l'état cible — s'affichait « gestion
 *     automatique du domaine non configurée » alors que le déploiement
 *     fonctionnait parfaitement. On envoyait l'opérateur saisir un secret dont
 *     plus personne n'a besoin ;
 *   · un projet AVEC une vieille clé locale valide s'affichait vert alors que
 *     la clé qui compte — celle du Panel — pouvait être absente ou refusée.
 *
 * Le diagnostic pose donc exactement la question que le déploiement posera.
 *
 * ══ CE QU'IL SAIT DISTINGUER ════════════════════════════════════════════════
 *
 * Un « ça ne marche pas » ne se répare pas au même endroit selon la cause. Les
 * états sont donc fermés, et chacun désigne un responsable :
 *
 *   PANEL_NOT_PAIRED          ce projet n'est relié à aucun Panel
 *   PANEL_UNREACHABLE         le Panel ne répond pas
 *   CAPABILITY_MISSING        ce Panel ne sert pas (encore) le verbe DNS
 *   CAPABILITY_NOT_GRANTED    le Panel refuse : le nom d'hôte ne relève pas de
 *                             ce projet (le « droit manquant » a disparu avec
 *                             les octrois côté Panel)
 *   PANEL_CREDENTIAL_MISSING  le Panel n'a pas de clé Hostinger exploitable
 *   PROVIDER_UNAVAILABLE      Hostinger a refusé ou n'a pas répondu
 *   PROVIDER_TIMEOUT          silence : l'issue est indéterminée
 *   ZONE_NOT_MANAGED          la zone n'est pas au portefeuille du compte
 *   OK                        la gestion automatique est utilisable
 *
 * ══ AUCUN SECRET, JAMAIS ════════════════════════════════════════════════════
 *
 * Rien de ce que rend ce module ne contient de clé, d'en-tête, ni d'URL de
 * fournisseur. Le Panel ne les livre pas, et l'on ne les reconstitue pas.
 */
import crypto from 'crypto';

/** États fermés — l'écran les traduit un à un, et le rapport les cite. */
export const DNS_DIAGNOSTIC = Object.freeze({
  OK: 'OK',
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
  PANEL_UNREACHABLE: 'PANEL_UNREACHABLE',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  CAPABILITY_NOT_GRANTED: 'CAPABILITY_NOT_GRANTED',
  PANEL_CREDENTIAL_MISSING: 'PANEL_CREDENTIAL_MISSING',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  ZONE_NOT_MANAGED: 'ZONE_NOT_MANAGED',
  NO_HOSTNAME: 'NO_HOSTNAME',
});

/**
 * Refus de la passerelle → état de diagnostic. Table, pas de devinette.
 *
 * ── LE REFUS D'APPARTENANCE A CHANGÉ DE CODE ────────────────────────────────
 *
 * Le Panel rendait `CAPABILITY_NOT_GRANTED` quand un projet visait un nom
 * d'hôte qui n'était pas le sien. Ce code mélangeait deux causes très
 * différentes — « la case n'est pas cochée » et « ce domaine est à un autre » —
 * et c'est la première qui a disparu : le Panel n'a plus de cases à cocher.
 *
 * `CAPABILITY_RESOURCE_NOT_OWNED` est donc ajouté, et l'ancien code CONSERVÉ :
 * un Panel plus ancien du parc peut encore l'émettre, et il désignait déjà ce
 * même refus pour le DNS. Le retirer ferait retomber ces réponses-là dans
 * l'état inconnu, c'est-à-dire dans un message qui n'aide personne.
 *
 * `CAPABILITY_BLOCKED_PREOPENING` a été retiré : ce refus n'existe plus nulle
 * part, et aucun Panel ne peut plus l'émettre.
 */
const PAR_CODE = Object.freeze({
  BRIDGE_NOT_PAIRED: DNS_DIAGNOSTIC.PANEL_NOT_PAIRED,
  PANEL_UNREACHABLE: DNS_DIAGNOSTIC.PANEL_UNREACHABLE,
  CAPABILITY_UNKNOWN: DNS_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_NOT_AVAILABLE: DNS_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_RESOURCE_NOT_OWNED: DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  CAPABILITY_NOT_GRANTED: DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  CAPABILITY_PROJECT_SCOPE_MISMATCH: DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  CAPABILITY_CREDENTIALS_MISSING: DNS_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING,
  CAPABILITY_TIMEOUT: DNS_DIAGNOSTIC.PROVIDER_TIMEOUT,
  CAPABILITY_PROVIDER_UNAVAILABLE: DNS_DIAGNOSTIC.PROVIDER_UNAVAILABLE,
});

/**
 * Phrase affichable. Elle dit QUI doit agir — c'est toute son utilité.
 *
 * « La plateforme n'a pas de clé » et « ce projet n'a pas le droit » envoient
 * deux personnes différentes vers deux écrans différents ; un message générique
 * les enverrait toutes les deux au mauvais.
 */
const MESSAGES = Object.freeze({
  [DNS_DIAGNOSTIC.OK]: 'Gestion automatique du domaine disponible via la plateforme.',
  [DNS_DIAGNOSTIC.PANEL_NOT_PAIRED]:
    'Ce projet n’est relié à aucune plateforme : la gestion automatique du domaine passe par elle, et ne peut pas être faite localement.',
  [DNS_DIAGNOSTIC.PANEL_UNREACHABLE]:
    'La plateforme ne répond pas. Le DNS ne sera pas administré automatiquement — aucune clé locale ne prend le relais.',
  [DNS_DIAGNOSTIC.CAPABILITY_MISSING]:
    'Cette plateforme ne sert pas encore la gestion DNS. Mettez-la à jour avant de publier ce domaine.',
  /**
   * Le message ne parle plus d'un droit « accordé » : la plateforme n'accorde
   * plus la gestion DNS projet par projet, elle vérifie à qui appartient le nom.
   * Envoyer un exploitant chercher une case à cocher qui n'existe plus le
   * ferait tourner en rond devant un écran qui ne la propose pas.
   */
  [DNS_DIAGNOSTIC.CAPABILITY_NOT_GRANTED]:
    'La plateforme refuse : ce nom de domaine n’est pas rattaché à ce projet.',
  [DNS_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING]:
    'La plateforme ne détient aucune clé de gestion de domaines exploitable.',
  [DNS_DIAGNOSTIC.PROVIDER_UNAVAILABLE]:
    'Le fournisseur de domaines a refusé la demande ou n’est pas joignable depuis la plateforme.',
  [DNS_DIAGNOSTIC.PROVIDER_TIMEOUT]:
    'Le fournisseur de domaines n’a pas répondu à temps : l’état est indéterminé, aucune reprise automatique.',
  [DNS_DIAGNOSTIC.ZONE_NOT_MANAGED]:
    'Ce domaine n’est pas au portefeuille de la plateforme : le DNS devra pointer vers le serveur manuellement.',
  [DNS_DIAGNOSTIC.NO_HOSTNAME]:
    'Aucun nom d’hôte à diagnostiquer.',
});

const resultat = (code, extra = {}) => ({
  authority: 'PANEL',
  code,
  available: code === DNS_DIAGNOSTIC.OK,
  message: MESSAGES[code],
  zone: null,
  zoneSource: null,
  wildcard: null,
  checkedAt: new Date().toISOString(),
  ...extra,
});

/**
 * La gestion DNS est-elle utilisable pour cet hôte, ici et maintenant ?
 *
 * ── DEUX APPELS, ET LE SECOND EST FACULTATIF ────────────────────────────────
 *
 * `dns.zone.resolve` répond à la question qui bloque une publication. La lecture
 * des enregistrements ne sert qu'à dire si une wildcard couvre déjà l'hôte —
 * une information utile à l'opérateur, jamais une condition. Son échec ne
 * dégrade donc pas le verdict : on rend `wildcard: null`, qui se lit
 * « inconnu », et surtout pas « absente ».
 *
 * @param {object} args
 * @param {string} args.hostname             l'hôte à publier
 * @param {Function|null} [args.invoke]      façade de capacités, `null` si non appairé
 * @param {boolean} [args.withRecords]       lire aussi les enregistrements
 */
export async function diagnoseDnsAutomation({ hostname, invoke = null, withRecords = true }) {
  if (!hostname) return resultat(DNS_DIAGNOSTIC.NO_HOSTNAME);
  if (typeof invoke !== 'function') return resultat(DNS_DIAGNOSTIC.PANEL_NOT_PAIRED);

  let zone;
  try {
    zone = await invoke('dns.zone.resolve', { hostname, operationId: operationId('zone') });
  } catch (err) {
    const code = PAR_CODE[err?.code ?? ''] ?? DNS_DIAGNOSTIC.PROVIDER_UNAVAILABLE;
    return resultat(code, { capabilityErrorCode: err?.code ?? null });
  }

  const resolue = zone?.result ?? zone;
  /**
   * `psl` signifie que la zone a été DÉDUITE de la liste publique des suffixes,
   * faute de la trouver au portefeuille. La publication reste possible, mais
   * l'écriture échouera : mieux vaut le dire avant de lancer un déploiement.
   */
  if (resolue?.source !== 'managed') {
    return resultat(DNS_DIAGNOSTIC.ZONE_NOT_MANAGED, {
      zone: resolue?.zone ?? null,
      zoneSource: resolue?.source ?? null,
    });
  }

  const base = { zone: resolue.zone, zoneSource: resolue.source };
  if (!withRecords) return resultat(DNS_DIAGNOSTIC.OK, base);

  try {
    const lus = await invoke('dns.records.read', { hostname, operationId: operationId('read') });
    const enregistrements = (lus?.result ?? lus)?.records ?? [];
    return resultat(DNS_DIAGNOSTIC.OK, {
      ...base,
      wildcard: enregistrements.some((r) => String(r?.name ?? '') === '*'),
    });
  } catch {
    // Information de confort : son absence ne change pas le verdict.
    return resultat(DNS_DIAGNOSTIC.OK, base);
  }
}

/** Clé de corrélation d'un diagnostic. Une lecture : la rejouer est sans effet. */
function operationId(etape) {
  return `dns-diag-${etape}-${crypto.randomUUID()}`.slice(0, 64);
}

export default { DNS_DIAGNOSTIC, diagnoseDnsAutomation };
