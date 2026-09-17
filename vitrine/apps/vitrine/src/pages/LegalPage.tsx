import { Card, SectionHeader } from '@bs/ui';

// RX3 — Pages légales routées (mentions légales / CGV / confidentialité). Remplacent les liens morts
// du footer R0. Contenu structuré côté front ; le branchement sur le contenu éditable géré au panel
// (endpoint /api/vitrine/pages/:slug) est prévu pour RX4 (espace client + contenu éditorial).

export type LegalKind = 'mentions-legales' | 'cgv' | 'confidentialite';

interface LegalContent {
  title: string;
  intro: string;
}

const CONTENT: Record<LegalKind, LegalContent> = {
  'mentions-legales': {
    title: 'Mentions légales',
    intro:
      "Informations relatives à l'éditeur du site, à l'hébergement et aux conditions d'utilisation. " +
      'Le détail est renseigné dans l\'espace de gestion et sera affiché ici.',
  },
  cgv: {
    title: 'Conditions générales de vente',
    intro:
      'Les CGV encadrent les réservations de prestations, les formations, les cartes cadeaux, ' +
      'les modalités de paiement, de rétractation et de remboursement.',
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    intro:
      'Cette politique décrit les données personnelles collectées, leur finalité, leur durée de ' +
      'conservation et vos droits (accès, rectification, suppression).',
  },
};

export function LegalPage({ kind }: { kind: LegalKind }) {
  const content = CONTENT[kind];
  return (
    <section className="vitrine-page vitrine-page--legal">
      <SectionHeader title={content.title} />
      <Card>
        <p className="bs-note">{content.intro}</p>
      </Card>
    </section>
  );
}
