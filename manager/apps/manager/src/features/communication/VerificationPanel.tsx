// M4 — Panneau de vérification d'une identité : demander la vérif Brevo, saisir l'OTP,
// activer, rafraîchir le DNS. L'OTP n'est jamais stocké (state local éphémère).
import { useState } from 'react';
import { Button, Card } from '@bs/ui';
import type { CommunicationIdentitySummary } from '@bs/api-client';
import { IdentityStatusCard, DnsStatusPanel } from './components';

export interface VerificationPanelProps {
  identity: CommunicationIdentitySummary;
  busy?: boolean;
  errorMessage?: string | null;
  onRequest: (id: string) => void;
  onConfirm: (id: string, code: string) => void;
  onActivate: (id: string) => void;
  onRefresh: (id: string) => void;
}

export function VerificationPanel({
  identity,
  busy = false,
  errorMessage = null,
  onRequest,
  onConfirm,
  onActivate,
  onRefresh,
}: VerificationPanelProps) {
  const [code, setCode] = useState('');
  const isVerified = identity.status === 'verified';
  const isPending = identity.status === 'verification_pending';

  return (
    <Card>
      <div className="cc-form">
        <IdentityStatusCard identity={identity} />

        {!isVerified ? (
          <div className="cc-form">
            {!isPending ? (
              <div className="cc-actions">
                <Button type="button" disabled={busy} onClick={() => onRequest(identity.id)}>
                  {busy ? 'Envoi…' : 'Demander la vérification (e-mail Brevo)'}
                </Button>
              </div>
            ) : (
              <>
                <p className="cc-inline-note">
                  Un code de vérification a été envoyé à <strong>{identity.email}</strong>. Saisissez-le ci-dessous.
                </p>
                <div className="cc-field">
                  <label className="cc-label" htmlFor={`cc-otp-${identity.id}`}>Code de vérification (OTP)</label>
                  <input
                    id={`cc-otp-${identity.id}`}
                    className="cc-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                </div>
                <div className="cc-actions">
                  <Button type="button" disabled={busy || code.trim().length === 0} onClick={() => onConfirm(identity.id, code.trim())}>
                    {busy ? 'Vérification…' : 'Confirmer le code'}
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => onRequest(identity.id)}>
                    Renvoyer
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="cc-actions">
            {!identity.active ? (
              <Button type="button" disabled={busy} onClick={() => onActivate(identity.id)}>
                Activer cette identité
              </Button>
            ) : (
              <span className="cc-inline-success">Identité active — utilisée pour les envois.</span>
            )}
          </div>
        )}

        <DnsStatusPanel identity={identity} />
        <div className="cc-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onRefresh(identity.id)}>
            Rafraîchir le statut DNS / vérification
          </Button>
        </div>

        {errorMessage ? <p className="cc-inline-error">{errorMessage}</p> : null}
      </div>
    </Card>
  );
}
