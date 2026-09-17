import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Drawer, Button } from '@bs/ui';
import { formatPrice, type PublicService, type AvailabilitySlot, type SelectedServiceSlot, type SelectedServiceOption } from '@bs/api-client';
import { useCart } from '../cart';
import { AvailabilityCalendar } from '../booking/AvailabilityCalendar';
import { SlotPicker } from '../booking/SlotPicker';
import { SelectedSlotSummary } from '../booking/SelectedSlotSummary';

// RX3 — Réservation prestation dans un Drawer partagé (≤2 clics depuis le CTA sticky). Réutilise le
// calendrier + slot picker existants (M10/availability publique). AUCUN lock ici : ajout panier indicatif,
// le backend confirme au paiement. Les options sélectionnées + le total indicatif sont portés dans le panier.

export interface ServiceBookingDrawerProps {
  service: PublicService;
  open: boolean;
  onClose: () => void;
  selectedOptions: SelectedServiceOption[];
  indicativePrice: number;
}

export function ServiceBookingDrawer({ service, open, onClose, selectedOptions, indicativePrice }: ServiceBookingDrawerProps) {
  const { addService } = useCart();
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
      indicativePrice,
      selectedSlot: slot,
      selectedOptions,
    });
    setAdded(true);
  };

  return (
    <Drawer
      open={open}
      title={`Réserver — ${service.name}`}
      onClose={onClose}
      footer={
        added ? (
          <Link className="bs-btn" to="/panier">
            Voir le panier
          </Link>
        ) : (
          <Button type="button" onClick={onAdd} disabled={!slot}>
            Ajouter au panier · {formatPrice(indicativePrice)}
          </Button>
        )
      }
    >
      <AvailabilityCalendar
        serviceId={service.id}
        selectedDate={date}
        onSelectDate={(d) => {
          setDate(d);
          setSlot(null);
          setAdded(false);
        }}
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
          {added ? <p className="bs-note">Ajouté au panier.</p> : null}
        </div>
      ) : null}
    </Drawer>
  );
}
