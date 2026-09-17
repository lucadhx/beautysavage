// RX-GO-2 — Facture publique React (lien e-mail, sans compte). Réutilise GET /api/invoice/:token (polling
// génération). Affiche UNIQUEMENT les champs réels (titre / montant / date) + téléchargement PDF — aucune
// ligne/TVA inventée (le détail est dans le PDF). Layout autonome (TokenFlowLayout).
import { useState, useEffect, useRef } from 'react';
import { Card, LoadingState } from '@bs/ui';
import { formatPrice, getPublicInvoice, publicInvoiceDownloadUrl, ApiError, type PublicInvoiceStatus } from '@bs/api-client';
import { useParams } from 'react-router-dom';
import { TokenFlowLayout, TokenErrorState } from '../features/tokenizedFlows/components';

const MAX_ATTEMPTS = 5;
const POLL_MS = 10_000;
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

type View = 'loading' | 'pending' | 'ready' | 'timeout' | 'invalid';

export function InvoicePublicPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View>('loading');
  const [data, setData] = useState<PublicInvoiceStatus | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!token) { setView('invalid'); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await getPublicInvoice(token as string);
        if (!active) return;
        setData(res);
        if (res.ready) { setView('ready'); return; }
        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) { setView('timeout'); return; }
        setView('pending');
        timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!active) return;
        setView(err instanceof ApiError && err.status === 404 ? 'invalid' : 'timeout');
      }
    }
    poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [token]);

  if (view === 'invalid') return <TokenFlowLayout><TokenErrorState state="invalid" /></TokenFlowLayout>;
  if (view === 'loading') return <TokenFlowLayout><LoadingState label="Chargement de votre facture…" /></TokenFlowLayout>;

  const dateStr = data?.date ? DATE_FMT.format(new Date(data.date)) : '';

  return (
    <TokenFlowLayout>
      <Card className="bs-tf-hero">
        <span className="bs-tf-hero__kicker"><i className="bi bi-receipt" aria-hidden="true" /> Facture</span>
        <h1 className="bs-tf-hero__title">{data?.formationTitle || 'Votre facture'}</h1>
        <div className="bs-tf-hero__meta">
          <span className="bs-tf-amount">{formatPrice(data?.amount ?? 0)}</span>
          {dateStr ? <span><i className="bi bi-calendar3" aria-hidden="true" /> {dateStr}</span> : null}
        </div>
      </Card>

      {view === 'ready' && data?.invoiceUrl ? (
        <div className="bs-bk-actions" style={{ justifyContent: 'center' }}>
          <a className="bs-btn" href={data.invoiceUrl} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-download" aria-hidden="true" /> Télécharger le PDF
          </a>
          <a className="bs-btn bs-btn--secondary" href={publicInvoiceDownloadUrl(token as string)} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-printer" aria-hidden="true" /> Ouvrir / imprimer
          </a>
        </div>
      ) : view === 'pending' ? (
        <Card>
          <div className="bs-auth__notice bs-auth__notice--info" role="status">
            <i className="bi bi-hourglass-split" aria-hidden="true" />
            <div>Votre facture est en cours de génération… (tentative {attempts.current}/{MAX_ATTEMPTS})</div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="bs-auth__notice" role="status">
            <i className="bi bi-info-circle" aria-hidden="true" />
            <div>Votre facture est encore en préparation. Réessayez dans quelques minutes ou contactez l’institut.</div>
          </div>
        </Card>
      )}
    </TokenFlowLayout>
  );
}
