import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/AuthContext';
import { ManagerThemeProvider } from '@/context/ManagerThemeContext';
import { SiteStatusProvider } from '@/context/SiteStatusContext';
import { NetworkConfigProvider } from '@/context/NetworkConfigContext';
import { CompanyProvider } from '@/context/CompanyContext';
import { RoleAppearanceProvider } from '@/context/RoleAppearanceContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { purgerRunsEtrangers } from '@/lib/deploymentRunId';
import { App } from './App';
// Jeu d'icônes officiel : les références publiées portent des noms `bi-*`.
// Sans cette feuille, la page Support affichait des carrés vides.
import 'bootstrap-icons/font/bootstrap-icons.css';
import './index.css';

/**
 * AVANT LE PREMIER RENDU : on oublie les exécutions qui ne sont pas d'ici.
 *
 * Un identifiant de run mémorisé survit à un rechargement complet — c'est
 * voulu, il évite de relancer une opération déjà en cours. Mais il survit aussi
 * à un changement d'outil : un identifiant d'un autre produit de l'écosystème
 * restauré ici ferait demander le suivi d'une exécution que ce backend ne
 * connaît pas, et son refus se lirait comme une session invalide.
 *
 * On le fait au démarrage, avant que le moindre écran ne le lise.
 */
purgerRunsEtrangers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ManagerThemeProvider>
        <AuthProvider>
          <SiteStatusProvider>
            <NetworkConfigProvider>
              <CompanyProvider>
                <RoleAppearanceProvider>
                  <App />
                  <Toaster position="top-right" richColors closeButton />
                </RoleAppearanceProvider>
              </CompanyProvider>
            </NetworkConfigProvider>
          </SiteStatusProvider>
        </AuthProvider>
        </ManagerThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
