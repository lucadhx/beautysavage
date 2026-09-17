import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import '@bs/ui/tokens.css';
import '@bs/ui/polish.css';
// RX-FIX — Bootstrap Icons (classes `bi bi-*` utilisées partout). Sans cet import, toutes les icônes React
// s'affichaient en carrés vides (la vitrine Vanilla les chargeait via CDN ; React ne les importait pas).
import 'bootstrap-icons/font/bootstrap-icons.css';
import { VitrineThemeProvider } from './features/theme/VitrineThemeProvider';
import { CartProvider } from './features/cart/CartProvider';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <VitrineThemeProvider>
          <CartProvider>
            {/* RX1 — basename = base Vite (/app/ en prod, / en dev) pour le serving sous-chemin. */}
            <BrowserRouter basename={import.meta.env.BASE_URL}>
              <App />
            </BrowserRouter>
          </CartProvider>
        </VitrineThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
