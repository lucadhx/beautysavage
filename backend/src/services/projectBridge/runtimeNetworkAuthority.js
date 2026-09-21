/**
 * CE QUE CE PROJET SERT RÉELLEMENT — l'autorité de ses adresses publiques.
 *
 * ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════
 *
 * Le Panel conservait l'adresse publique posée au jour de l'appairage. Après
 * une migration de domaine, sa fiche annonçait donc une adresse morte —
 * `api.demo-sbauto.lycarz.com` conservée des semaines après le passage à
 * `api.demo-sbauto06.ly-solution.com`. La seule correction possible était un
 * RÉAPPAIRAGE : détruire une relation de confiance pour rafraîchir une donnée
 * d'exploitation.
 *
 * Le contrat 1.9.0 ouvre le canal manquant. Ce module dit CE QU'ON Y MET.
 *
 * ══ UNE SEULE SOURCE, ET C'EST CELLE QUI EST APPLIQUÉE ══════════════════════
 *
 *     SystemConfiguration.network   ← l'autorité, et rien d'autre
 *
 * C'est la configuration que le déploiement écrit et que le runtime applique :
 * elle décrit les adresses auxquelles ce projet répond, pas celles qu'on
 * aurait souhaité qu'il serve. C'est aussi la source que la projection
 * `PROJECT_PRESENTATION` publie déjà — les deux canaux disent donc la même
 * chose, lue au même endroit, ce qui est la seule façon qu'ils ne divergent
 * jamais.
 *
 * ══ CE QUI N'EST JAMAIS UNE SOURCE ══════════════════════════════════════════
 *
 *   · `APP_URL` — un audit antérieur a retiré ces dépendances. Les
 *     réintroduire ici en filet ferait déclarer une adresse d'ambiance à la
 *     place de l'adresse servie, et le défaut renaîtrait sous un autre nom ;
 *   · `localhost` / la boucle locale — une adresse joignable depuis le seul
 *     serveur n'est PAS une adresse publique. La déclarer ferait appeler le
 *     Panel dans le vide ;
 *   · un ancien domaine codé en dur, quel qu'il soit ;
 *   · une recomposition « base + chemin » faite ici. Recomposer, c'est
 *     inventer une adresse que personne n'a configurée.
 *
 * ══ UN CHAMP VIDE S'OMET ════════════════════════════════════════════════════
 *
 * « Non configuré » et « vide » ne sont pas la même chose. En omettant, on
 * laisse le Panel conserver ce qu'il savait — mieux vaut une adresse datée
 * qu'un effacement provoqué par une configuration incomplète.
 */
import { getSingleton } from '../../utils/singleton.js';
import SystemConfiguration from '../../models/SystemConfiguration.model.js';

/**
 * Une adresse PUBLIQUE absolue, ou `null`.
 *
 * La boucle locale est refusée explicitement plutôt que par omission : un
 * projet lancé en local déclarerait sinon `http://localhost:4000` au Panel,
 * qui l'appellerait — et conclurait que le projet est en panne, alors qu'il
 * n'a simplement jamais été joignable depuis l'extérieur.
 */
export function publicUrlOrNull(valeur) {
  const brut = String(valeur ?? '').trim();
  if (!/^https?:\/\//i.test(brut)) return null;

  let parsed;
  try {
    parsed = new URL(brut);
  } catch {
    return null;
  }

  const hote = parsed.hostname.toLowerCase();
  if (hote === 'localhost' || hote === '127.0.0.1' || hote === '::1'
      || hote === '[::1]' || hote === '0.0.0.0') {
    return null;
  }

  // Sans slash final : deux écritures de la même adresse ne doivent pas
  // ressembler à deux adresses différentes de part et d'autre du pont.
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.replace(/\/+$/, '');
}

/**
 * LE RÉSEAU COURANT DE CE PROJET — prêt pour `Heartbeat.runtime.network`.
 *
 * Ne lève JAMAIS : un battement ne doit pas échouer parce qu'une lecture de
 * configuration a échoué. En cas de doute, on ne déclare rien — et le Panel
 * garde ce qu'il savait.
 *
 * @returns {Promise<object|undefined>} l'objet à publier, ou `undefined`.
 */
export async function currentRuntimeNetwork() {
  let cfg = null;
  try {
    cfg = await getSingleton(SystemConfiguration);
  } catch {
    return undefined;
  }

  const reseau = cfg?.network ?? {};
  const publicBackendUrl = publicUrlOrNull(reseau.backendUrl);
  const publicSiteUrl = publicUrlOrNull(reseau.websiteUrl);
  const managerUrl = publicUrlOrNull(reseau.managerUrl);

  /**
   * LES TROIS ADRESSES VOYAGENT ENSEMBLE, ET CE N'EST PAS UN ÉLARGISSEMENT.
   *
   * Le Panel ne range pas une adresse isolée : il tient une DESTINATION, dont
   * le modèle exige les trois (`website`, `manager`, `backend`) et qui se
   * déclare incomplète quand l'une manque. Ne publier que le backend ferait
   * donc arriver, à chaque battement, une photographie réseau amputée.
   */
  if (!publicBackendUrl && !publicSiteUrl && !managerUrl) return undefined;

  return {
    ...(publicBackendUrl ? { publicBackendUrl } : {}),
    ...(publicSiteUrl ? { publicSiteUrl } : {}),
    ...(managerUrl ? { managerUrl } : {}),
    declaredAt: new Date().toISOString(),
  };
}

export default { currentRuntimeNetwork, publicUrlOrNull };
