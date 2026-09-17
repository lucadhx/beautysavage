import { useMemo, useState } from 'react';
import { Button, LoadingState, ErrorState } from '@bs/ui';
import { useServiceAvailableDays } from './hooks';
import { WEEKDAYS, MONTHS, monthMatrix } from './dateUtils';

export interface AvailabilityCalendarProps {
  serviceId: string;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

function startOfMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function AvailabilityCalendar({ serviceId, selectedDate, onSelectDate }: AvailabilityCalendarProps) {
  const [{ year, month }, setYm] = useState(startOfMonth);
  const { data, isPending, isError } = useServiceAvailableDays(serviceId, year, month);
  const available = useMemo(() => new Set(data ?? []), [data]);
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);

  const shift = (delta: number) => {
    const m0 = month - 1 + delta;
    setYm({ year: year + Math.floor(m0 / 12), month: ((m0 % 12) + 12) % 12 + 1 });
  };

  return (
    <div>
      <div className="bs-cal__head">
        <Button variant="secondary" type="button" onClick={() => shift(-1)} aria-label="Mois précédent">←</Button>
        <strong>{MONTHS[month - 1]} {year}</strong>
        <Button variant="secondary" type="button" onClick={() => shift(1)} aria-label="Mois suivant">→</Button>
      </div>

      {isPending ? <LoadingState label="Chargement des disponibilités…" /> : null}
      {isError ? <ErrorState title="Disponibilités indisponibles." /> : null}

      {!isPending && !isError ? (
        <>
          <div className="bs-cal__grid">
            {WEEKDAYS.map((d) => (
              <div key={d} className="bs-cal__dow">{d}</div>
            ))}
            {weeks.flat().map((day, idx) => {
              if (!day) return <div key={`e${idx}`} className="bs-cal__day bs-cal__empty" />;
              const isAvail = available.has(day);
              const isSel = day === selectedDate;
              const cls = ['bs-cal__day', isAvail ? 'bs-cal__day--available' : '', isSel ? 'bs-cal__day--selected' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={day}
                  type="button"
                  className={cls}
                  disabled={!isAvail}
                  aria-pressed={isSel}
                  onClick={() => onSelectDate(day)}
                >
                  {Number(day.slice(8, 10))}
                </button>
              );
            })}
          </div>
          {available.size === 0 ? <p className="bs-note">Aucune disponibilité ce mois-ci.</p> : null}
        </>
      ) : null}
    </div>
  );
}
