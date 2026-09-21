/**
 * MON ENTREPRISE — ce que le Manager affiche du client, et rien de plus.
 *
 * ══ CE CONTRÔLEUR N'A QU'UNE LECTURE, ET C'EST DÉLIBÉRÉ ═════════════════════
 *
 * Voir l'en-tête de `routes/clientCompany.routes.js` : l'identité juridique du
 * client est ce qui figure sur ses factures et ses contrats. Son autorité est
 * le Panel. L'absence de verbe d'écriture n'est pas un manque à combler.
 *
 * ══ POURQUOI L'ADRESSE DE CONTACT VOYAGE AVEC ═══════════════════════════════
 *
 * Parce que l'écran doit dire quoi faire quand l'information est incorrecte ou
 * absente, et que la réponse n'est jamais « modifiez-la ici ». Elle vient de
 * `contacts.publicContactEmail`, publié par le Panel — jamais d'une constante
 * de ce projet, jamais d'une variable d'environnement, jamais de l'adresse d'un
 * compte administrateur. C'est exactement le champ que le Panel a centralisé
 * pour que le parc entier n'ait qu'une adresse à changer.
 *
 * `null` quand le Panel ne l'a pas renseignée : l'écran affiche alors le
 * message sans lien plutôt qu'un `mailto:` vide. Un lien mort apprend à ne plus
 * cliquer.
 */
import { ok } from '../utils/apiResponse.js';
import { describeClientCompany } from '../services/panelConfiguration/clientCompany.service.js';
import { getPublishedDeveloperIdentity } from '../services/panelConfiguration/developerIdentity.service.js';

export async function myCompany(req, res) {
  const [vue, prestataire] = await Promise.all([
    describeClientCompany(),
    getPublishedDeveloperIdentity(),
  ]);

  return ok(res, {
    ...vue,
    /**
     * QUI CONTACTER, ET SOUS QUEL NOM.
     *
     * Le nom du prestataire accompagne l'adresse : « Nous contacter » sans dire
     * QUI est « nous » oblige le lecteur à deviner. Les deux viennent de la
     * configuration publiée, donc de la même source que le reste.
     */
    support: {
      providerName: prestataire?.name ?? null,
      contactEmail: prestataire?.supportEmail ?? null,
    },
  });
}

export default { myCompany };
