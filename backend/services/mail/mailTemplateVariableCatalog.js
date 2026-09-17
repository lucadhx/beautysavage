// services/mail/mailTemplateVariableCatalog.js
// P1-3 — Catalogue canonique des variables de template e-mail (source d'autorité BACKEND).
//
// Jusqu'ici, la liste des variables connues n'existait que côté front (miroir hardcodé
// `KNOWN_TEMPLATE_VARIABLES`). Ce module expose depuis le backend, pour chaque variable :
//   - description (à quoi elle sert)
//   - example (valeur d'exemple, utilisée pour l'aperçu et l'envoi de test)
//   - source (domaine métier d'où provient la valeur)
//   - raw (true si la valeur est du HTML/URL/CSS non échappé en rendu HTML — cf. P0-1)
//
// Il fournit aussi :
//   - getMailVariableCatalog() : le catalogue complet (aligné sur VARIABLE_KEYS du renderer)
//   - buildSampleTemplateData() : un jeu de données d'exemple pour TOUTES les variables connues
//     (aperçu réel + envoi de test, sans jamais utiliser de vraie donnée client ni de vrai token)
//   - validateTemplateContent() : détection des variables inconnues et des accolades mal fermées

import { VARIABLE_KEYS } from './mailRenderer.js';

// Descriptions + exemples des variables métier documentées. Les clés absentes d'ici mais présentes
// dans VARIABLE_KEYS restent connues (catalogue exhaustif garanti par getMailVariableCatalog).
const CATALOG = {
  firstname: { description: 'Prénom du client', example: 'Camille', source: 'client' },
  lastname: { description: 'Nom du client', example: 'Durand', source: 'client' },
  customername: { description: 'Nom complet du client', example: 'Camille Durand', source: 'client' },
  clientname: { description: 'Nom complet du client', example: 'Camille Durand', source: 'client' },
  email: { description: 'E-mail du client', example: 'client@example.com', source: 'client' },
  clientemail: { description: 'E-mail du client', example: 'client@example.com', source: 'client' },

  saleid: { description: 'Identifiant de la vente', example: 'VTE-2026-000123', source: 'sale' },
  amount: { description: 'Montant (formaté automatiquement)', example: '49.90', source: 'sale' },
  amountpaid: { description: 'Montant payé', example: '49.90', source: 'sale' },
  link: { description: 'Lien principal (bouton)', example: 'https://beautysavage.fr/app', source: 'url', raw: true },
  invoicedownloadurl: { description: 'Lien de téléchargement de la facture', example: 'https://beautysavage.fr/app/invoice/EX_TOKEN', source: 'url', raw: true },
  invoicepageurl: { description: 'Lien vers la facture en ligne', example: 'https://beautysavage.fr/app/invoice/EX_TOKEN', source: 'url', raw: true },
  actionurl: { description: 'Lien d\'action (réservation, décision…)', example: 'https://beautysavage.fr/app/mon-compte', source: 'url', raw: true },
  trackingurl: { description: 'Lien de suivi de remboursement', example: 'https://beautysavage.fr/app/refund-tracking/EX_TOKEN', source: 'url', raw: true },
  platformurl: { description: 'Lien espace plateforme (commissions)', example: 'https://beautysavage.fr/manager', source: 'url', raw: true },

  code: { description: 'Code (confirmation e-mail / carte cadeau)', example: '482913', source: 'auth' },
  expiresminutes: { description: 'Durée de validité du code (minutes)', example: '15', source: 'auth' },

  sitename: { description: 'Nom du site / institut', example: 'Beauty Savage', source: 'institute' },
  institutename: { description: 'Nom de l\'institut', example: 'Beauty Savage', source: 'institute' },

  formationtitle: { description: 'Titre de la formation', example: 'Extensions de cils — Niveau 1', source: 'formation' },
  formationname: { description: 'Nom de la formation', example: 'Extensions de cils — Niveau 1', source: 'formation' },
  productname: { description: 'Nom du produit', example: 'Sérum réparateur', source: 'catalog' },
  servicename: { description: 'Nom de la prestation', example: 'Pose de vernis semi-permanent', source: 'service' },

  sessiondatelabel: { description: 'Date de session (libellé)', example: 'lundi 3 août 2026', source: 'formation' },
  sessiontimelabel: { description: 'Heure de session (libellé)', example: '14h00', source: 'formation' },
  sessiondate: { description: 'Date de session', example: '03/08/2026', source: 'formation' },
  sessiontime: { description: 'Heure de session', example: '14:00', source: 'formation' },
  sessiondatetime: { description: 'Date et heure de session', example: '03/08/2026 à 14:00', source: 'formation' },

  bookingid: { description: 'Identifiant de la réservation', example: 'RDV-2026-000045', source: 'booking' },
  bookingdate: { description: 'Date du rendez-vous', example: '05/08/2026', source: 'booking' },
  bookingtime: { description: 'Heure du rendez-vous', example: '10:30', source: 'booking' },
  bookingdatetime: { description: 'Date et heure du rendez-vous', example: '05/08/2026 à 10:30', source: 'booking' },
  oldbookingdate: { description: 'Ancienne date du rendez-vous', example: '05/08/2026', source: 'booking' },
  oldbookingtime: { description: 'Ancienne heure du rendez-vous', example: '10:30', source: 'booking' },
  newbookingdate: { description: 'Nouvelle date du rendez-vous', example: '07/08/2026', source: 'booking' },
  newbookingtime: { description: 'Nouvelle heure du rendez-vous', example: '11:00', source: 'booking' },
  depositamount: { description: 'Montant de l\'acompte', example: '20.00', source: 'booking' },
  remainingamount: { description: 'Montant restant dû', example: '29.90', source: 'booking' },
  paymenttype: { description: 'Type de paiement', example: 'Acompte', source: 'booking' },
  timelabel: { description: 'Libellé horaire', example: '10h30', source: 'booking' },
  cancellationdays: { description: 'Délai d\'annulation (jours)', example: '2', source: 'booking' },
  autorefunddays: { description: 'Délai de remboursement automatique (jours)', example: '14', source: 'refund' },
  eligiblerefund: { description: 'Remboursement éligible ?', example: 'Oui', source: 'refund' },
  noshowcount: { description: 'Nombre de no-shows', example: '3', source: 'booking' },
  suspensionthreshold: { description: 'Seuil de suspension', example: '3', source: 'booking' },

  reason: { description: 'Motif', example: 'À la demande du client', source: 'divers' },
  refundreason: { description: 'Motif de remboursement', example: 'Annulation dans les délais', source: 'refund' },
  refundamount: { description: 'Montant remboursé', example: '49.90', source: 'refund' },
  refundstatus: { description: 'Statut du remboursement', example: 'Effectué', source: 'refund' },
  refunddatetime: { description: 'Date/heure du remboursement', example: '06/08/2026 à 09:00', source: 'refund' },
  refundid: { description: 'Identifiant du remboursement', example: 'RBT-2026-000012', source: 'refund' },
  refundedatformatted: { description: 'Date de remboursement (formatée)', example: '6 août 2026', source: 'refund' },
  refundsection: { description: 'Bloc HTML de remboursement (pré-construit)', example: '<p>Remboursement de 49,90&nbsp;€ effectué.</p>', source: 'refund', raw: true },
  itemdetail: { description: 'Détail prestation/formation', example: 'Pose de vernis semi-permanent', source: 'divers' },

  giftcardcode: { description: 'Code de la carte cadeau', example: 'BS-GC-4821', source: 'gift_card' },
  giftcardpassword: { description: 'Mot de passe de la carte cadeau', example: '••••', source: 'gift_card' },
  giftcardbalance: { description: 'Solde de la carte cadeau', example: '30.00', source: 'gift_card' },
  recipientname: { description: 'Nom du bénéficiaire (carte cadeau)', example: 'Léa Martin', source: 'gift_card' },
  purchasername: { description: 'Nom de l\'acheteur (carte cadeau)', example: 'Camille Durand', source: 'gift_card' },
  pin: { description: 'Code PIN de la carte cadeau', example: '••••', source: 'gift_card' },
  message: { description: 'Message personnalisé (carte cadeau)', example: 'Joyeux anniversaire !', source: 'gift_card' },
  balance: { description: 'Solde de la carte cadeau', example: '30.00', source: 'gift_card' },
  paymentlabel: { description: 'Libellé de paiement (carte cadeau)', example: 'Payé sur place', source: 'gift_card' },
  transactionreason: { description: 'Motif de transaction (carte cadeau)', example: 'Achat prestation', source: 'gift_card' },
  cardlink: { description: 'Lien vers la carte cadeau', example: 'https://beautysavage.fr/storage/giftcards/ex.html', source: 'url', raw: true },
  lessonname: { description: 'Nom de la leçon', example: 'Module 1 — Préparation', source: 'formation' },
  location: { description: 'Lieu de la session', example: 'Institut Beauty Savage, Paris 11e', source: 'formation' },
  linklabel: { description: 'Libellé du bouton/lien', example: 'Accéder', source: 'divers' },

  period: { description: 'Période (commission)', example: 'Juillet 2026', source: 'commission' },
  daysleft: { description: 'Jours restants', example: '5', source: 'commission' },
  daystotal: { description: 'Jours au total', example: '30', source: 'commission' },
  eta: { description: 'Délai estimé', example: '3 à 5 jours', source: 'divers' },
  date: { description: 'Date', example: '05/08/2026', source: 'divers' },
  startedat: { description: 'Début', example: '05/08/2026 09:00', source: 'divers' },
  endedat: { description: 'Fin', example: '05/08/2026 18:00', source: 'divers' },
  year: { description: 'Année en cours', example: '2026', source: 'system' }
};

// Variables de thème/couleur : valeurs CSS injectées par withMailThemeVars au rendu réel. On les
// marque `raw` (non échappées) et on fournit un exemple neutre pour l'aperçu standalone.
const THEME_KEYS = new Set([
  'themesurfaceheader', 'themeaccent', 'themeaccentstrong', 'colortext', 'colorsurface',
  'themeprimary', 'themesecondary', 'themebackground', 'themesurface', 'themetext'
]);

/** Catalogue complet, aligné sur VARIABLE_KEYS (exhaustif). */
export function getMailVariableCatalog() {
  return Array.from(VARIABLE_KEYS).map((key) => {
    if (CATALOG[key]) {
      return { key, known: true, raw: Boolean(CATALOG[key].raw), ...CATALOG[key] };
    }
    if (THEME_KEYS.has(key)) {
      return { key, known: true, raw: true, description: 'Couleur/variable de thème (injectée au rendu)', example: '#e4b690', source: 'theme' };
    }
    return { key, known: true, raw: false, description: '', example: `[${key}]`, source: 'autre' };
  });
}

/**
 * Jeu de données d'exemple pour TOUTES les variables connues (aperçu réel + envoi de test).
 * N'utilise jamais de vraie donnée client, de vrai token, ni de secret.
 */
export function buildSampleTemplateData() {
  const data = {};
  for (const key of VARIABLE_KEYS) {
    if (CATALOG[key] && CATALOG[key].example !== undefined) {
      data[key] = CATALOG[key].example;
    } else if (THEME_KEYS.has(key)) {
      // Laissé à withMailThemeVars (thème réel) ; valeur neutre de secours.
      data[key] = '#e4b690';
    } else {
      data[key] = `[${key}]`;
    }
  }
  return data;
}

/**
 * Valide le contenu d'un template :
 *   - unknownVariables : variables `{{x}}` bien formées mais hors catalogue
 *   - malformed : présence d'accolades ouvrantes/fermantes non appariées (`{{` sans `}}`)
 * @param {string} content
 * @returns {{ unknownVariables: string[], malformed: boolean }}
 */
export function validateTemplateContent(content) {
  const str = String(content || '');
  const unknown = new Set();
  const wellFormed = /\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g;
  let m;
  while ((m = wellFormed.exec(str)) !== null) {
    const key = m[1].toLowerCase();
    if (!VARIABLE_KEYS.has(key)) unknown.add(m[1]);
  }
  // Accolades mal fermées : nombre de "{{" ≠ nombre de "}}", ou "{{" sans "}}" correct ensuite.
  const openCount = (str.match(/\{\{/g) || []).length;
  const closeCount = (str.match(/\}\}/g) || []).length;
  const malformed = openCount !== closeCount;
  return { unknownVariables: Array.from(unknown), malformed };
}

export default { getMailVariableCatalog, buildSampleTemplateData, validateTemplateContent };
