// RX3 — Tests de l'Accordion partagé (aria-expanded, region, ouverture unique par défaut).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Accordion } from './index';

const ITEMS = [
  { id: 'a', title: 'Question A', content: 'Réponse A' },
  { id: 'b', title: 'Question B', content: 'Réponse B' },
];

describe('Accordion', () => {
  // Le panneau reste monté (dropdown animé) mais `aria-hidden` le retire de l'arbre a11y
  // quand il est fermé → les requêtes par rôle `region` reflètent l'état ouvert/fermé.
  it('ouvre/ferme un panneau et expose aria-expanded + region', () => {
    render(<Accordion items={ITEMS} />);
    const btnA = screen.getByRole('button', { name: 'Question A' });
    expect(btnA).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Question A' })).toBeNull();

    fireEvent.click(btnA);
    expect(btnA).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Question A' });
    expect(region).toHaveTextContent('Réponse A');

    fireEvent.click(btnA);
    expect(screen.queryByRole('region', { name: 'Question A' })).toBeNull();
  });

  it('mode simple : ouvrir B ferme A', () => {
    render(<Accordion items={ITEMS} defaultOpen={['a']} />);
    expect(screen.getByRole('region', { name: 'Question A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Question B' }));
    expect(screen.getByRole('region', { name: 'Question B' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Question A' })).toBeNull();
  });

  it('mode multiple : A et B peuvent être ouverts ensemble', () => {
    render(<Accordion items={ITEMS} multiple defaultOpen={['a']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Question B' }));
    expect(screen.getByRole('region', { name: 'Question A' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Question B' })).toBeInTheDocument();
  });
});
