import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/**
 * LE RETOUR DE SIGNATURE — une seule porte, pour les deux signataires.
 *
 * ══ POURQUOI CETTE PAGE EXISTE ══════════════════════════════════════════════
 *
 * La plateforme de signature n'accepte qu'UNE adresse de retour pour tout le
 * document, et n'y ajoute aucun paramètre. Le développeur et le client
 * atterrissent donc au même endroit — là où, avant, chacun avait la sienne.
 *
 * Les envoyer sur la page du client ferait arriver le développeur dans un écran
 * qui n'est pas le sien ; les envoyer sur la liste des contrats ferait arriver
 * le client dans un écran auquel il n'a pas accès. Cette page ne suppose rien :
 * elle lit la session, puis renvoie chacun chez lui.
 *
 * ══ ELLE NE CONCLUT RIEN ════════════════════════════════════════════════════
 *
 * Elle ne dit ni « signé » ni « échoué ». Revenir de la plateforme ne prouve
 * pas qu'on a signé — on peut avoir fermé l'onglet, refusé, ou être revenu en
 * arrière. Seul le webhook fait foi, et c'est l'écran de destination qui
 * l'attend, comme il le faisait déjà.
 *
 * C'est la même règle que les pages de retour de paiement, et elle est plus
 * nécessaire ici : aucun paramètre d'URL ne pourrait plus servir de prétexte,
 * puisqu'il n'y en a plus.
 */
export default function SignatureReturnPage() {
  const { isDev, loading, unreachable } = useAuth();

  /**
   * ON ATTEND DE SAVOIR QUI REVIENT.
   *
   * Rediriger avant que la session soit lue enverrait tout le monde du côté
   * client — c'est-à-dire le développeur dans un écran qu'il n'utilise pas, et
   * une impression de bogue au moment précis où il vient de signer.
   */
  if (loading || unreachable) {
    return (
      <div className="flex min-h-[calc(var(--m-viewport-h)*0.5)] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Retour de signature…</p>
      </div>
    );
  }

  /**
   * `replace` : cette page ne doit pas rester dans l'historique. Un
   * « Précédent » depuis le contrat y repasserait pour rien, et donnerait
   * l'impression d'une navigation qui tourne en rond.
   */
  return <Navigate to={isDev ? '/dev/contrats' : '/contrat/retour-signature'} replace />;
}
