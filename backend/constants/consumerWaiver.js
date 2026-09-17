export const CHECKOUT_CGV_TEXT = "J ai lu et j accepte les CGV";

export const DISTANT_LEARNING_WAIVER_TEXT =
  'Je demande l acces immediat a la formation et renonce a mon droit de retractation de 14 jours';

export const PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT =
  'Je renonce a mon droit de retractation car la formation a lieu dans moins de 14 jours';

export const PRESENTIEL_WAIVER_WITHIN_7_TEXT =
  'Je reconnais que la reservation est ferme et non remboursable';

export const PRESENTIEL_FREE_CANCELLATION_NOTICE =
  'Vous pouvez annuler gratuitement jusqu au delai de remboursement defini pour la formation';

export const RETRACTATION_DAYS = 14;
export const PRESENTIEL_RETRACT_WINDOW_DAYS = RETRACTATION_DAYS;

export const CONSUMER_WAIVER_INFO_CONTENT = {
  title: 'Plus d informations sur les remboursements',
  presentielWhy:
    'Pourquoi ? Les places, ressources et couts logistiques sont engages a l avance.',
  sections: {
    presentiel: {
      title: 'Formations presencielles',
      intro:
        'Quand la formation a lieu dans moins de 14 jours, une renonciation legale est requise avant paiement.',
      reminder:
        'L annulation et le remboursement restent possibles selon le delai de remboursement defini pour la formation.',
      bullets: [
        'Annulation avant le delai de remboursement de la formation -> remboursement total',
        'En dehors du delai de remboursement -> pas de remboursement (sauf force majeure)'
      ]
    },
    distanciel: {
      title: 'Formations en ligne (video)',
      bullets: [
        'Acces immediat au contenu apres paiement',
        'Renonciation au droit de retractation',
        'Pas de remboursement apres acces sauf probleme technique bloquant'
      ]
    },
    institute: {
      title: 'Si l institut annule',
      text: 'Vous beneficiez d un remboursement integral ou d une nouvelle date.'
    },
    summary: {
      title: 'En resume',
      bullets: [
        'Presentiel -> remboursement possible selon le delai de la formation',
        'Video -> pas de remboursement apres acces',
        'Institut annule -> remboursement garanti'
      ]
    }
  }
};
