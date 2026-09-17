import type { SelectedServiceSlot } from '@bs/api-client';
import { formatSlotLabel } from './dateUtils';

export function SelectedSlotSummary({ slot }: { slot: SelectedServiceSlot }) {
  return (
    <p>
      Créneau choisi : <strong>{formatSlotLabel(slot.slotStart)}</strong>
      <br />
      <span className="bs-note">Ce créneau n’est pas réservé : il sera confirmé après paiement / validation.</span>
    </p>
  );
}
