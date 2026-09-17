import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@bs/ui';
import type { PublicService, AvailabilitySlot, SelectedServiceSlot } from '@bs/api-client';
import { useCart } from '../cart/CartProvider';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { SlotPicker } from './SlotPicker';
import { SelectedSlotSummary } from './SelectedSlotSummary';

// Sélection d'un créneau prestation puis ajout au panier (indicatif). AUCUNE réservation/lock ici.
export function ServiceBookingPanel({ service }: { service: PublicService }) {
  const { addService } = useCart();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SelectedServiceSlot | null>(null);
  const [added, setAdded] = useState(false);

  const onSelectSlot = (s: AvailabilitySlot) => {
    setSlot({ slotStart: s.start, slotEnd: s.end, practitionerId: s.practitionerId });
    setAdded(false);
  };

  const onAdd = () => {
    if (!slot) return;
    addService({
      refId: service.id,
      slug: service.slug,
      name: service.name,
      indicativePrice: service.effectivePrice ?? service.price,
      selectedSlot: slot,
      selectedOptions: [],
    });
    setAdded(true);
  };

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>Choisir un créneau</Button>
    );
  }

  return (
    <section aria-label="Choix du créneau">
      <AvailabilityCalendar
        serviceId={service.id}
        selectedDate={date}
        onSelectDate={(d) => { setDate(d); setSlot(null); setAdded(false); }}
      />
      {date ? (
        <div style={{ marginTop: 'var(--bs-space-3)' }}>
          <SlotPicker serviceId={service.id} date={date} selectedStart={slot?.slotStart ?? null} onSelectSlot={onSelectSlot} />
        </div>
      ) : (
        <p className="bs-note">Sélectionnez d’abord un jour disponible.</p>
      )}

      {slot ? (
        <div style={{ marginTop: 'var(--bs-space-3)' }}>
          <SelectedSlotSummary slot={slot} />
          {added ? (
            <p>
              Ajouté au panier. <Link to="/panier">Voir le panier →</Link>
            </p>
          ) : (
            <Button type="button" onClick={onAdd}>Ajouter au panier</Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
