// RX2.2 - Financial Timeline: sticky summary + period/type chips + cards.
// Readable at a glance, drawer details, no table.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { FinanceTimelinePeriod, FinanceTimelineTypeFilter, FinanceTimelineItem } from '@bs/api-client';
import { useFinanceTimeline } from './useFinance';
import { FinanceSkeleton, FinanceError } from './components';
import {
  FinanceTimelineSummary, FinanceTimelineFilters, FinanceTimelineList,
  FinanceTimelineEmpty,
} from './timeline';
import { FinanceMovementDrawer } from './movementDrawer';
import './finance.css';
import './timeline.css';

function parsePeriod(value: string | null): FinanceTimelinePeriod {
  return value === 'today' || value === 'week' || value === 'month'
    ? value
    : 'month';
}

function parseType(value: string | null): FinanceTimelineTypeFilter {
  return value === 'sale' || value === 'refund'
    ? value
    : 'all';
}

function buildSearchParams(period: FinanceTimelinePeriod, type: FinanceTimelineTypeFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (period !== 'month') params.set('period', period);
  if (type !== 'all') params.set('type', type);
  return params;
}

export function FinanceTimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parsePeriod(searchParams.get('period'));
  const type = parseType(searchParams.get('type'));
  const [selected, setSelected] = useState<FinanceTimelineItem | null>(null);
  const { data, isLoading, isError, refetch } = useFinanceTimeline({ period, type, limit: 100 });

  const updatePeriod = (nextPeriod: FinanceTimelinePeriod) => {
    setSearchParams(buildSearchParams(nextPeriod, type), { replace: true });
  };

  const updateType = (nextType: FinanceTimelineTypeFilter) => {
    setSearchParams(buildSearchParams(period, nextType), { replace: true });
  };

  return (
    <div className="fin-tl-page" data-testid="finance-timeline">
      <header className="fin-tl-head">
        <div className="fin-head__titles">
          <h1 className="fin-head__title">Timeline</h1>
          <p className="fin-head__subtitle">Ventes, soldes &amp; remboursements</p>
        </div>
        <Link to="/finance" className="fin-tl-iconbtn" aria-label="Retour au tableau de bord finance">
          <i className="bi-grid-1x2" aria-hidden="true" />
        </Link>
      </header>

      {data ? <FinanceTimelineSummary summary={data.summary} /> : null}

      <FinanceTimelineFilters period={period} type={type} onPeriod={updatePeriod} onType={updateType} />

      {isLoading ? <FinanceSkeleton /> : null}
      {isError ? <FinanceError onRetry={() => void refetch()} /> : null}
      {data && data.items.length === 0 ? <FinanceTimelineEmpty /> : null}
      {data && data.items.length > 0 ? <FinanceTimelineList items={data.items} onSelect={setSelected} /> : null}

      <FinanceMovementDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
