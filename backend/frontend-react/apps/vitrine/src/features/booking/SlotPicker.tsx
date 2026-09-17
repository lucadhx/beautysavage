import { LoadingState, ErrorState, EmptyState } from '@bs/ui';
import type { AvailabilitySlot } from '@bs/api-client';
import { useServiceAvailableSlots } from './hooks';
import { formatSlotTime } from './dateUtils';

export interface SlotPickerProps {
  serviceId: string;
  date: string;
  practitionerId?: string | null;
  selectedStart?: string | null;
  onSelectSlot: (slot: AvailabilitySlot) => void;
}

export function SlotPicker({ serviceId, date, practitionerId, selectedStart, onSelectSlot }: SlotPickerProps) {
  const { data, isPending, isError } = useServiceAvailableSlots(serviceId, date, practitionerId);

  if (isPending) return <LoadingState label="Chargement des créneaux…" />;
  if (isError) return <ErrorState title="Impossible de charger les créneaux." />;
  if (!data || data.length === 0) return <EmptyState label="Aucun créneau disponible ce jour." />;

  return (
    <div className="bs-slots">
      {data.map((slot) => {
        const selected = slot.start === selectedStart;
        return (
          <button
            key={`${slot.start}-${slot.practitionerId ?? 'x'}`}
            type="button"
            className={`bs-slot${selected ? ' bs-slot--selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onSelectSlot(slot)}
          >
            {formatSlotTime(slot.start)}
          </button>
        );
      })}
    </div>
  );
}
