// RX3 — Tests du shell vitrine : header (nav active, badge panier, burger drawer), footer légal, routes légales.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { App } from '../App';
import type { CartItem } from '../features/cart/cartTypes';

afterEach(() => vi.unstubAllGlobals());

function stubCatalog() {
  stubFetch((url) => {
    if (url.includes('/api/vitrine/shop')) return jsonResponse({ ok: true, formations: [], products: [] });
    if (url.includes('/api/vitrine/services')) return jsonResponse({ ok: true, services: [] });
    if (url.includes('/api/site-status')) return jsonResponse({ ok: true, status: 'active' });
    return jsonResponse({ ok: true }, 404);
  });
}

const CART_ITEM: CartItem = { lineId: 'l1', kind: 'service', refId: 's1', name: 'Soin', indicativePrice: 50 };

describe('VitrineHeader', () => {
  it('affiche la marque, la navigation et le lien panier', () => {
    stubCatalog();
    renderWithProviders(<App />, '/');
    expect(screen.getByRole('link', { name: /Beauty Savage — accueil/ })).toBeInTheDocument();
    // Navigation principale présente (desktop nav rendue dans le DOM même si masquée en CSS mobile).
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getByRole('link', { name: 'Prestations' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Formations' })).toBeInTheDocument();
  });

  it('affiche le nombre d’articles du panier dans un badge', () => {
    stubCatalog();
    renderWithProviders(<App />, '/', [CART_ITEM]);
    const cart = screen.getByRole('link', { name: /Panier, 1 article/ });
    expect(within(cart).getByText('1')).toBeInTheDocument();
  });

  it('ouvre le menu mobile (drawer) au clic sur le burger', () => {
    stubCatalog();
    renderWithProviders(<App />, '/');
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(dialog).getByRole('link', { name: 'Mes formations' })).toBeInTheDocument();
  });
});

describe('VitrineFooter + pages légales', () => {
  it('le footer expose les liens légaux', () => {
    stubCatalog();
    renderWithProviders(<App />, '/');
    const footer = screen.getByRole('navigation', { name: 'Informations légales' });
    expect(within(footer).getByRole('link', { name: 'CGV' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Mentions légales' })).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: 'Confidentialité' })).toBeInTheDocument();
  });

  it('la route /cgv rend une vraie page (plus de lien mort)', async () => {
    stubCatalog();
    renderWithProviders(<App />, '/cgv');
    // RX-GO-2 — LegalPage est désormais lazy → attendre le chargement du chunk.
    expect(await screen.findByRole('heading', { name: 'Conditions générales de vente' })).toBeInTheDocument();
  });
});
