// RX4 — Aide (P12). FAQ honnête sur le fonctionnement du hub + accès rapides. Les coordonnées de l'institut
// (téléphone/adresse/horaires) ne sont PAS exposées par un endpoint public front-only (cf. audit §5) : on
// renvoie vers les mentions légales pour les informations officielles plutôt que d'inventer des données.
import { Link } from 'react-router-dom';
import { Accordion, Card } from '@bs/ui';
import { AccountShell } from '../features/account';

const FAQ = [
  { id: 'facture', title: 'Où trouver ma facture ?', body: <p>Dans « Mes factures » : chaque achat dispose d'un bouton de téléchargement dès que la facture est disponible.</p> },
  { id: 'remboursement', title: 'Où en est mon remboursement ?', body: <p>Le suivi détaillé d'un remboursement vous est envoyé par e-mail avec un lien de suivi. Le montant remboursé apparaît aussi dans votre historique d'achats.</p> },
  { id: 'attestation', title: 'Où sont mes attestations ?', body: <p>Dans « Mes documents » : l'attestation d'une formation devient téléchargeable une fois la formation terminée à 100 %.</p> },
  { id: 'carte', title: 'Comment utiliser ma carte cadeau ?', body: <p>Le solde et le code figurent dans « Mes cartes cadeaux ». Le code s'affiche uniquement après avoir cliqué sur « Afficher le code », puis se saisit au moment du paiement.</p> },
  { id: 'mdp', title: 'Comment changer mon mot de passe ?', body: <p>Dans « Mon profil », le bouton « Modifier mon mot de passe » vous envoie un e-mail sécurisé pour en choisir un nouveau.</p> },
];

const LINKS = [
  { to: '/mon-compte/rendez-vous', icon: 'bi-calendar-heart', label: 'Mes rendez-vous' },
  { to: '/mon-compte/factures', icon: 'bi-receipt', label: 'Mes factures' },
  { to: '/mon-compte/documents', icon: 'bi-folder2-open', label: 'Mes documents' },
  { to: '/mentions-legales', icon: 'bi-info-circle', label: 'Coordonnées & informations légales' },
];

export function AccountHelpPage() {
  return (
    <AccountShell title="Aide">
      <div className="bs-hub__section">
        <h2 className="bs-hub__section-title">Questions fréquentes</h2>
        <Card>
          <Accordion items={FAQ.map((f) => ({ id: f.id, title: f.title, content: f.body }))} />
        </Card>
      </div>

      <div className="bs-hub__section">
        <h2 className="bs-hub__section-title">Accès utiles</h2>
        <div className="bs-acc-help">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="bs-acc-help__item">
              <i className={`bi ${l.icon} bs-acc-help__icon`} aria-hidden="true" />
              <span>{l.label}</span>
              <i className="bi bi-chevron-right" aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--bs-color-muted)' }} />
            </Link>
          ))}
        </div>
      </div>
    </AccountShell>
  );
}
