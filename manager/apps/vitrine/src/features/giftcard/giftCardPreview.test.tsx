// RX3 S4 — Aperçu carte cadeau : reflète montant, bénéficiaire, message (jamais rien d'inventé).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GiftCardPreview } from './GiftCardPreview';

describe('GiftCardPreview', () => {
  it('affiche montant, bénéficiaire et message', () => {
    render(<GiftCardPreview amount={60} recipientName="Camille" message="Bravo !" />);
    expect(screen.getByText(/60,00/)).toBeInTheDocument();
    expect(screen.getByText('Pour Camille')).toBeInTheDocument();
    expect(screen.getByText('« Bravo ! »')).toBeInTheDocument();
  });

  it('sans bénéficiaire → libellé générique, pas de message vide', () => {
    render(<GiftCardPreview amount={0} />);
    expect(screen.getByText('Pour un être cher')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
