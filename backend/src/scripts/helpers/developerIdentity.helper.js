/**
 * PUBLIER UNE ENTREPRISE DÉVELOPPEUR, comme le ferait le Panel.
 *
 * ── POURQUOI CE HELPER EXISTE ───────────────────────────────────────────────
 * Sept suites préparaient le signataire développeur en écrivant dans la fiche
 * locale `DevCompany`. Cette fiche a disparu : l'identité développeur est
 * publiée par le Panel, et le projet ne fait que l'appliquer.
 *
 * Recopier la préparation dans chaque suite garantissait qu'un changement de
 * forme en oublierait une. Elle vit donc ici, une fois.
 *
 * ── CE QUE LA FORME EXIGE ───────────────────────────────────────────────────
 * `companyId`, `slug` et `environment` ne sont pas décoratifs : sans eux,
 * `getCompanyConfiguration()` ignore le document et le test prouverait
 * l'inverse de ce qu'il croit prouver.
 */
import { PanelCompanyConfiguration } from '../../models/PanelConfiguration.model.js';

/** Le signataire type des suites contractuelles. */
export const DEV_SIGNER = {
  firstName: 'Luca',
  lastName: 'Duhoux',
  jobTitle: 'Gérant',
  email: 'dev@studio.fr',
};

/**
 * Écrit la configuration publiée par le Panel.
 *
 * @param {object} [options]
 * @param {string} [options.name]      raison affichée et figée dans les contrats
 * @param {object|null} [options.signer]
 * @param {string|null} [options.logoUrl]
 * @param {string|null} [options.websiteUrl]
 * @param {object[]} [options.references]
 * @param {object[]} [options.team]
 */
export async function publishDeveloperIdentity({
  name = 'Studio',
  signer = DEV_SIGNER,
  logoUrl = null,
  websiteUrl = null,
  references = [],
  team = [],
  version = 1,
} = {}) {
  await PanelCompanyConfiguration.updateOne(
    { key: 'SINGLETON' },
    {
      $set: {
        companyId: '11111111-1111-4111-8111-111111111111',
        slug: 'studio',
        environment: 'TEST',
        version,
        identity: { name },
        branding: { logoUrl },
        domains: { websiteUrl },
        signer,
        references,
        team,
        appliedAt: new Date(),
        source: 'SYNC',
      },
    },
    { upsert: true },
  );
}

/** Aucune entreprise publiée — le cas « projet sans Panel ». */
export async function clearDeveloperIdentity() {
  await PanelCompanyConfiguration.deleteMany({});
}

export default { publishDeveloperIdentity, clearDeveloperIdentity, DEV_SIGNER };
