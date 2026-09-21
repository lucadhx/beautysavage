/**
 * PUBLIER UNE ENTREPRISE CLIENTE, comme le ferait le Panel.
 *
 * ── POURQUOI CE HELPER EXISTE ───────────────────────────────────────────────
 *
 * Depuis le chantier « entreprise cliente », AUCUN paiement et AUCUNE signature
 * ne s'ouvrent pour un projet sans identité juridique de client. C'est la garde
 * centrale du lot, et elle est autoritative des deux côtés du pont.
 *
 * Conséquence pour les recettes : toute suite qui ouvre un paiement doit
 * d'abord recevoir une entreprise cliente. Recopier la préparation dans chaque
 * suite garantissait qu'un changement de forme en oublierait une — c'est
 * exactement l'histoire de `publishDeveloperIdentity`, écrit pour la même
 * raison.
 *
 * ── CE HELPER PASSE PAR LE CHEMIN DE PRODUCTION ─────────────────────────────
 *
 * Il n'écrit pas la collection à la main : il APPLIQUE un profil, exactement
 * comme le ferait une écriture reçue du pont. Une suite qui écrirait
 * directement prouverait que le stockage fonctionne, jamais que l'application
 * fonctionne.
 *
 * ── LES VALEURS SONT COHÉRENTES, ET C'EST NÉCESSAIRE ────────────────────────
 *
 * Le SIREN satisfait la clé de Luhn, le SIRET commence par lui, et le numéro de
 * TVA se termine par lui. Ce sont les règles que le Panel applique à la saisie :
 * des valeurs prises au hasard passeraient ici (le projet ne revalide rien) mais
 * ne pourraient jamais être produites par une fiche réelle — et la recette
 * éprouverait un cas qui n'existe pas.
 *
 * Rien ne désigne une entreprise réelle : ce sont des valeurs de test.
 */
import { applyClientCompanyProfile } from '../../services/panelConfiguration/clientCompany.service.js';
import { PanelClientCompanyConfiguration } from '../../models/PanelConfiguration.model.js';

export const CLIENT_SIGNER = {
  firstName: 'Marc',
  lastName: 'Client',
  jobTitle: 'Gérant',
  email: 'marc@cliente.test',
};

/** Les versions doivent MONTER : une version antérieure est ignorée. */
let version = 0;

/**
 * Publie une entreprise cliente COMPLÈTE — ou volontairement incomplète.
 *
 * @param {object} [options]
 * @param {string} [options.legalName]
 * @param {boolean} [options.billingReady]  faux pour éprouver le refus de paiement
 * @param {boolean} [options.signerReady]   faux pour éprouver le refus de signature
 */
export async function publishClientCompany({
  clientCompanyId = 'cc-test-0000000001',
  legalName = 'SARL CLIENTE DE RECETTE',
  billingReady = true,
  signerReady = true,
  signer = CLIENT_SIGNER,
} = {}) {
  version += 1;
  const adresse = {
    line1: '1 rue de la Recette', line2: null, postalCode: '06000', city: 'Nice', country: 'FR',
  };

  return applyClientCompanyProfile({
    clientCompanyId,
    version,
    environment: 'TEST',
    status: 'ACTIVE',
    legalName,
    tradingName: 'Cliente de recette',
    legalForm: 'SARL',
    siren: billingReady ? '732829320' : null,
    siret: billingReady ? '73282932000074' : null,
    vatNumber: billingReady ? 'FR44732829320' : null,
    registrationCity: 'Nice',
    registeredOffice: adresse,
    billingAddress: billingReady ? adresse : null,
    billingEmail: billingReady ? 'facturation@cliente.test' : null,
    phone: '+33 4 00 00 00 00',
    website: null,
    contractualSigner: signerReady ? signer : null,
    /**
     * LE VERDICT VIENT DU PANEL — ce helper le fabrique parce qu'il JOUE le
     * Panel. Le projet ne le recalcule jamais : c'est la règle du chantier, et
     * la respecter ici est ce qui rend la recette fidèle.
     */
    readiness: {
      state: billingReady && signerReady
        ? 'READY'
        : (!billingReady ? 'MISSING_BILLING_IDENTITY' : 'MISSING_SIGNER'),
      ready: billingReady && signerReady,
      billing: {
        ready: billingReady,
        missing: billingReady ? [] : ['SIREN', 'E-mail de facturation'],
      },
      signing: {
        ready: signerReady,
        missing: signerReady ? [] : ['Signataire — prénom', 'Signataire — nom'],
      },
    },
  }, 'SYNC');
}

/** Aucune entreprise cliente rattachée — le cas « dossier incomplet ». */
export async function clearClientCompanyFixture() {
  await PanelClientCompanyConfiguration.deleteMany({});
}

export default { CLIENT_SIGNER, publishClientCompany, clearClientCompanyFixture };
