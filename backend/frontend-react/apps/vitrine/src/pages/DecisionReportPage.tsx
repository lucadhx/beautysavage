// RX4 S3 — Report via lien e-mail (sans compte). Prestation : réutilise le calendrier de disponibilité
// (AvailabilityCalendar/SlotPicker) — JAMAIS de nouveau calendrier. Formation : choix parmi les sessions
// disponibles (embarquées) + consentement. Anti-double-booking + texte de renonciation validés côté serveur.
import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Button, Card, Checkbox, LoadingState, StickyBar } from '@bs/ui';
import { ApiError, type AvailabilitySlot, type DecisionFlow, type DecisionFormationSession } from '@bs/api-client';
import { AvailabilityCalendar, SlotPicker, SelectedSlotSummary } from '../features/booking';
import { TokenFlowLayout, TokenErrorState, DecisionHeroCard } from '../features/tokenizedFlows/components';
import { useDecisionFlow, useRescheduleService, useRescheduleFormation } from '../features/tokenizedFlows/hooks';
import { tokenStateFromError, sessionLabel, pickRenunciationText } from '../features/tokenizedFlows/format';

export function DecisionReportPage() {
  const [params] = useSearchParams();
  const flowId = params.get('flowId');
  const token = params.get('token');
  const query = useDecisionFlow(flowId, token);

  if (!flowId || !token) return <TokenFlowLayout><TokenErrorState state="invalid" /></TokenFlowLayout>;
  if (query.isPending) return <TokenFlowLayout><LoadingState label="Chargement des disponibilités…" /></TokenFlowLayout>;
  if (query.isError) { const s = tokenStateFromError(query.error); return <TokenFlowLayout><TokenErrorState state={s === 'ok' ? 'error' : s} /></TokenFlowLayout>; }

  const flow = query.data;
  if (flow.decision !== 'pending') return <TokenFlowLayout><TokenErrorState state="expired" /></TokenFlowLayout>;

  return (
    <TokenFlowLayout>
      {flow.kind === 'service'
        ? <ServiceReport flow={flow} flowId={flowId} token={token} />
        : <FormationReport flow={flow} flowId={flowId} token={token} />}
    </TokenFlowLayout>
  );
}

// ── Prestation ────────────────────────────────────────────────────────────────
function ServiceReport({ flow, flowId, token }: { flow: DecisionFlow; flowId: string; token: string }) {
  const navigate = useNavigate();
  const serviceId = flow.service?.id || '';
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const reschedule = useRescheduleService(flowId, token);

  const slotUnavailable = reschedule.error instanceof ApiError && (reschedule.error.code === 'SLOT_UNAVAILABLE' || reschedule.error.status === 409);

  if (reschedule.isSuccess) {
    return <SuccessCard title="Votre nouveau créneau est confirmé" body={`Rendez-vous : ${flow.service?.name || ''}. Vous recevrez une confirmation par e-mail.`} />;
  }

  return (
    <>
      <DecisionHeroCard icon="bi-calendar2-plus" kicker="Reporter mon rendez-vous" title={flow.service?.name || 'Prestation'} />
      <Card>
        <AvailabilityCalendar serviceId={serviceId} selectedDate={date} onSelectDate={(d) => { setDate(d); setSlot(null); }} />
        {date ? (
          <div style={{ marginTop: 'var(--bs-space-3)' }}>
            <SlotPicker serviceId={serviceId} date={date} selectedStart={slot?.start ?? null} onSelectSlot={(s) => setSlot(s)} />
          </div>
        ) : null}
      </Card>
      {slot ? <Card><SelectedSlotSummary slot={{ slotStart: slot.start, slotEnd: slot.end, practitionerId: slot.practitionerId }} /></Card> : null}
      {slotUnavailable ? <Card><p role="alert" style={{ margin: 0, color: 'var(--bs-color-danger)' }}>Ce créneau vient d’être pris. Choisissez-en un autre.</p></Card> : null}
      <StickyBar>
        <Button variant="secondary" onClick={() => navigate(`/decision?flowId=${encodeURIComponent(flowId)}&token=${encodeURIComponent(token)}`)}>Retour</Button>
        <Button disabled={!slot || reschedule.isPending} onClick={() => slot && reschedule.mutate({ chosenSlotStart: slot.start, chosenSlotEnd: slot.end })}>
          {reschedule.isPending ? 'Confirmation…' : 'Confirmer le report'}
        </Button>
      </StickyBar>
    </>
  );
}

// ── Formation ─────────────────────────────────────────────────────────────────
function FormationReport({ flow, flowId, token }: { flow: DecisionFlow; flowId: string; token: string }) {
  const navigate = useNavigate();
  const sessions = flow.availableSessions ?? [];
  const [chosen, setChosen] = useState<DecisionFormationSession | null>(null);
  const [consent, setConsent] = useState(false);
  const reschedule = useRescheduleFormation(flowId, token);

  const waiverText = chosen ? pickRenunciationText(flow, chosen) : '';
  const needsWaiver = Boolean(waiverText);

  if (reschedule.isSuccess) {
    return <SuccessCard title="Votre nouvelle session est confirmée" body="Vous recevrez une confirmation par e-mail." />;
  }

  return (
    <>
      <DecisionHeroCard icon="bi-calendar2-plus" kicker="Choisir une nouvelle date" title={flow.formation?.name || 'Formation'} />
      {sessions.length === 0 ? (
        <Card><p style={{ margin: 0 }}>Aucune session disponible pour le moment. Contactez l’institut.</p></Card>
      ) : (
        <div className="bs-tf-sessions">
          {sessions.map((s) => (
            <button key={s.id} type="button" className={`bs-tf-session${chosen?.id === s.id ? ' bs-tf-session--active' : ''}`}
              onClick={() => { setChosen(s); setConsent(false); }}>
              <span><i className="bi bi-calendar3" aria-hidden="true" /> {sessionLabel(s)}</span>
              {chosen?.id === s.id ? <i className="bi bi-check-circle-fill" aria-hidden="true" style={{ color: 'var(--bs-color-primary)' }} /> : <i className="bi bi-chevron-right" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      {chosen && needsWaiver ? (
        <Card>
          <Checkbox label={waiverText} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        </Card>
      ) : null}
      {reschedule.isError ? <Card><p role="alert" style={{ margin: 0, color: 'var(--bs-color-danger)' }}>Ce report n’a pas pu être confirmé. La session est peut-être complète ou le consentement requis.</p></Card> : null}
      <StickyBar>
        <Button variant="secondary" onClick={() => navigate(`/decision?flowId=${encodeURIComponent(flowId)}&token=${encodeURIComponent(token)}`)}>Retour</Button>
        <Button disabled={!chosen || (needsWaiver && !consent) || reschedule.isPending}
          onClick={() => chosen && reschedule.mutate({ chosenSessionId: chosen.id, acceptedCgv: true, renunciationText: waiverText })}>
          {reschedule.isPending ? 'Confirmation…' : 'Confirmer le report'}
        </Button>
      </StickyBar>
    </>
  );
}

function SuccessCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bs-card bs-tf-state" role="status">
      <i className="bi bi-check2-circle bs-tf-state__icon" aria-hidden="true" />
      <h1 className="bs-tf-state__title">{title}</h1>
      <p className="bs-tf-state__body">{body}</p>
      <Link className="bs-btn bs-btn--secondary" to="/">Retour à l’accueil</Link>
    </div>
  );
}
