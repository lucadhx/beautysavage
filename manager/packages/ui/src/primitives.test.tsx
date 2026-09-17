// RX3 — Tests des primitives partagées extraites (@bs/ui) : Drawer, StickyBar, formulaires, Gallery.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer, StickyBar, FormField, TextInput, TextArea, Select, Checkbox, Gallery } from './index';

describe('overlay — Drawer', () => {
  it('ne rend rien quand fermé', () => {
    render(
      <Drawer open={false} title="Panier" onClose={() => {}}>
        contenu
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rend un dialog modal accessible avec titre + footer', () => {
    render(
      <Drawer open title="Panier" onClose={() => {}} footer={<button>Payer</button>}>
        <p>ligne panier</p>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Panier' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('ligne panier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer' })).toBeInTheDocument();
  });

  it('ferme via Escape et via clic sur le scrim', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="Panier" onClose={onClose}>
        x
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    const scrim = container.querySelector('.bs-scrim')!;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ferme via le bouton de fermeture', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Panier" onClose={onClose}>
        x
      </Drawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('overlay — StickyBar', () => {
  it('rend une barre inline desktop par défaut', () => {
    const { container } = render(
      <StickyBar>
        <button className="bs-btn">Réserver</button>
      </StickyBar>,
    );
    const bar = container.querySelector('.bs-stickybar')!;
    expect(bar).toBeTruthy();
    expect(bar.className).toContain('bs-stickybar--desktop-inline');
  });
});

describe('forms — primitives', () => {
  it('FormField lie label + hint, et bascule sur erreur (role alert)', () => {
    const { rerender } = render(
      <FormField label="Montant" htmlFor="amt" hint="Minimum 20 €" required>
        <TextInput id="amt" />
      </FormField>,
    );
    expect(screen.getByText('Minimum 20 €')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(
      <FormField label="Montant" htmlFor="amt" hint="Minimum 20 €" error="Trop bas" required>
        <TextInput id="amt" invalid />
      </FormField>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Trop bas');
    // le hint disparaît quand une erreur est présente
    expect(screen.queryByText('Minimum 20 €')).toBeNull();
    expect(screen.getByLabelText(/Montant/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('Checkbox associe le label cliquable à l’input', () => {
    render(<Checkbox label="J’accepte les CGV" />);
    const box = screen.getByRole('checkbox', { name: 'J’accepte les CGV' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it('Select et TextArea partagent la classe bs-input', () => {
    const { container } = render(
      <>
        <Select aria-label="Tri">
          <option value="recent">Récents</option>
        </Select>
        <TextArea aria-label="Commentaire" />
      </>,
    );
    expect(container.querySelector('select.bs-input')).toBeTruthy();
    expect(container.querySelector('textarea.bs-input')).toBeTruthy();
  });
});

describe('gallery — Gallery', () => {
  it('affiche un placeholder si aucune image', () => {
    const { container } = render(<Gallery images={[]} />);
    expect(container.querySelector('.bs-media__placeholder')).toBeTruthy();
    expect(container.querySelector('.bs-gallery__thumbs')).toBeNull();
  });

  it('change l’image principale au clic sur une vignette', () => {
    render(
      <Gallery
        images={[
          { src: 'https://x/a.jpg', alt: 'A' },
          { src: 'https://x/b.jpg', alt: 'B' },
        ]}
      />,
    );
    const main = screen.getByAltText('A');
    expect(main).toHaveAttribute('src', 'https://x/a.jpg');
    fireEvent.click(screen.getByRole('listitem', { name: 'Photo 2 sur 2' }));
    expect(screen.getByAltText('B')).toHaveAttribute('src', 'https://x/b.jpg');
  });
});
