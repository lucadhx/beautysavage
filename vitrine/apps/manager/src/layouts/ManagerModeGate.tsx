// RX-BLOCKER — Garde d'entrée en mode gestion. Un admin/dev connecté a par défaut currentMode='vitrine' ;
// or les routes /api/gestion/* gardées par requireMode('gestion') redirigent (302) vers la vitrine sinon →
// toutes les pages manager tombaient en « indisponible ». On bascule le mode côté serveur (idempotent) AVANT
// de rendre l'espace, quelle que soit l'entrée (login / deep-link / refresh). Ne s'exécute qu'authentifié
// admin/dev (monté sous RequireRole).
import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { LoadingState } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { enterGestionMode } from '@bs/api-client';

export function ManagerModeGate() {
  const { user, status, refresh } = useAuth();
  const [ready, setReady] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ready || ran.current) return;
    // Attendre que l'auth soit résolue (le loader AuthProvider est asynchrone).
    if (status !== 'authenticated' || !user) return;
    ran.current = true;
    // Déjà en gestion → rendre sans appel réseau.
    if (user.currentMode === 'gestion') {
      setReady(true);
      return;
    }
    (async () => {
      try {
        await enterGestionMode();
      } catch {
        // Suspension admin / erreur : refresh re-synchronise l'auth (→ éventuel redirect login par RequireRole).
      } finally {
        await refresh();
        setReady(true);
      }
    })();
  }, [ready, status, user, refresh]);

  if (!ready) return <LoadingState label="Ouverture de l’espace gestion…" />;
  return <Outlet />;
}
