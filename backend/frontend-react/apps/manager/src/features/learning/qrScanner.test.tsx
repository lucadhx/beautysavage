// C3 — QrScanner : fallback saisie manuelle (le décodage passe par onDecode, debounce inclus).
// La caméra (html5-qrcode) n'est pas disponible en jsdom : le composant doit rester utilisable via
// la saisie manuelle.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QrScanner } from './QrScanner';

describe('QrScanner', () => {
  it('saisie manuelle déclenche onDecode', async () => {
    const onDecode = vi.fn();
    render(<QrScanner onDecode={onDecode} onClose={() => {}} />);
    // Ouvre le panneau de saisie manuelle.
    fireEvent.click(screen.getByText(/Saisie manuelle/i));
    const input = screen.getByPlaceholderText(/Code/i);
    fireEvent.change(input, { target: { value: 'BS-PRESENCE:s1:abc' } });
    fireEvent.click(screen.getByText('Valider'));
    expect(onDecode).toHaveBeenCalledWith('BS-PRESENCE:s1:abc');
  });

  it('debounce : un même code consécutif n’est pas renvoyé deux fois', () => {
    const onDecode = vi.fn();
    render(<QrScanner onDecode={onDecode} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Saisie manuelle/i));
    const input = screen.getByPlaceholderText(/Code/i);
    fireEvent.change(input, { target: { value: 'dup' } });
    fireEvent.click(screen.getByText('Valider'));
    fireEvent.change(input, { target: { value: 'dup' } });
    fireEvent.click(screen.getByText('Valider'));
    expect(onDecode).toHaveBeenCalledTimes(1);
  });
});
