import * as React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

/**
 * FILET DE RENDU — et il DIT ce qu'il a attrapé.
 *
 * ══ POURQUOI CE FICHIER A CHANGÉ ════════════════════════════════════════════
 *
 * Il n'affichait que « Une erreur est survenue — vous pouvez recharger la
 * page ». L'erreur réelle partait dans `console.error` et nulle part ailleurs :
 * un opérateur qui rencontrait ce mur ne pouvait rien rapporter, et personne
 * ne pouvait donc rien corriger. Un incident invisible se reproduit
 * indéfiniment.
 *
 * Le filet reste : mieux vaut un écran de secours qu'un arbre démonté. Mais il
 * porte désormais le nom de l'erreur, son message et la pile de composants —
 * repliés, parce que c'est un détail technique, et copiables en un geste,
 * parce que c'est exactement ce qu'on demandera à celui qui l'a vu.
 *
 * ══ CE QU'IL NE FAIT PAS ════════════════════════════════════════════════════
 *
 * Il n'avale rien : l'erreur reste journalisée telle quelle. Et il ne remplace
 * aucun cas métier — une ressource supprimée n'est pas une panne de rendu,
 * c'est un état normal que l'écran doit savoir traverser.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
    this.setState({ componentStack: info?.componentStack ?? null });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    window.location.reload();
  };

  handleCopy = () => {
    const { error, componentStack } = this.state;
    void navigator.clipboard?.writeText(
      [
        `Error : ${error?.name ?? 'Error'}`,
        `Message : ${error?.message ?? '—'}`,
        `URL : ${window.location.pathname}${window.location.search}`,
        '',
        'Stack :',
        error?.stack ?? '—',
        '',
        'Composants :',
        componentStack ?? '—',
      ].join('\n'),
    );
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, componentStack } = this.state;
    return (
      <div className="flex min-h-[var(--m-viewport-h)] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold">Une erreur est survenue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            L'interface a rencontré un problème inattendu. Vous pouvez recharger la page pour
            continuer.
          </p>

          {/* LE DÉTAIL, REPLIÉ — visible pour qui le cherche, discret sinon. */}
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Détail technique
            </summary>
            <div className="mt-2 max-h-64 overflow-auto overscroll-contain rounded-lg bg-muted/50 p-3 font-mono text-[11px]">
              <div className="font-semibold">{error?.name ?? 'Error'}</div>
              <div className="mt-1 break-words">{error?.message ?? '—'}</div>
              {error?.stack ? (
                <pre className="mt-2 whitespace-pre-wrap break-words">{error.stack}</pre>
              ) : null}
              {componentStack ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                  {componentStack}
                </pre>
              ) : null}
            </div>
          </details>

          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={this.handleReload}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Recharger la page
            </button>
            <button
              onClick={this.handleCopy}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium"
            >
              Copier le détail
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
