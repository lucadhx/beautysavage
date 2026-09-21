import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button, Spinner } from '@/components/ui/primitives';

function FullscreenLoader() {
  return (
    <div className="flex min-h-[var(--m-viewport-h)] items-center justify-center bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

/**
 * Le serveur n'a pas répondu — on ne prétend pas que la session a expiré.
 *
 * Renvoyer au login serait un mensonge doublé d'une perte : l'utilisateur y
 * arrive déconnecté sans que personne ait contesté son identité. Ici, la
 * session est intacte ; il ne manque qu'une réponse.
 */
function ServeurInjoignable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[var(--m-viewport-h)] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Serveur momentanément injoignable</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Votre session reste ouverte. La connexion au serveur n'a pas abouti — cela
          arrive pendant un redémarrage.
        </p>
      </div>
      <Button onClick={onRetry}>Réessayer</Button>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, unreachable, refresh } = useAuth();
  const location = useLocation();
  if (loading) return <FullscreenLoader />;
  // L'ordre compte : « injoignable » se lit AVANT « pas d'utilisateur », sinon
  // une panne réseau redevient une déconnexion.
  if (!user && unreachable) return <ServeurInjoignable onRetry={() => refresh()} />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export function RequireDev({ children }: { children: React.ReactNode }) {
  const { isDev, loading, unreachable, refresh } = useAuth();
  if (loading) return <FullscreenLoader />;
  if (unreachable) return <ServeurInjoignable onRetry={() => refresh()} />;
  if (!isDev) return <Navigate to="/" replace />;
  return <>{children}</>;
}
