import { AnimatePresence, motion } from 'framer-motion';
import { PenLine, Download, Clock } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { ContractProgressTracker } from '@/components/contracts/ContractProgressTracker';
import { JourneyStage, stageMotion } from '@/components/contracts/journey/JourneyStage';
import { SignatureArt, WaitingArt, LiveArt, PreparationArt } from '@/components/contracts/journey/art';
import { getContractPresentationState } from '@/lib/contractPresentation';
import { formatDate } from '@/lib/utils';
import type { Contract } from '@/types';

/**
 * Le parcours vu par le DEV — le MÊME écran que le client, à un détail près :
 * ce que le DEV a à faire.
 *
 * Une fois le contrat validé, le DEV n'est plus un administrateur qui inspecte
 * un objet technique : il est PARTIE au contrat, avec une signature à donner
 * puis plus rien. L'écran doit le dire — il signe, puis il regarde le client
 * avancer. Le détail technique existe toujours, replié dessous.
 *
 * Le suivi vient de `ContractProgressTracker`, exactement comme côté client :
 * les deux rôles lisent le même calcul, pas deux vérités parallèles.
 */
export function DevJourney({
  contract,
  pending,
  onSign,
  onDownloadSigned,
}: {
  contract: Contract;
  pending: boolean;
  onSign: () => void;
  onDownloadSigned: () => void;
}) {
  const sub = contract.stripe.subscription;
  /**
   * L'ÉTAT vient du calcul partagé, plus d'une cascade de ternaires.
   *
   * L'ancienne cascade se terminait par un `else` — « Préparation / Contrat en
   * attente / pas encore parti à la signature » — qui ramassait tout ce qu'elle
   * n'avait pas prévu. Un contrat validé sans signature requise y tombait :
   * l'écran annonçait une signature qui n'aurait jamais lieu, alors qu'il
   * attendait en réalité un règlement. `getContractPresentationState` lit la
   * machine métier et n'a pas de « reste ».
   */
  const etat = getContractPresentationState(contract, 'DEV');

  return (
    <>
      <ContractProgressTracker contract={contract} className="mb-8" />
      <AnimatePresence mode="wait">
        <motion.div key={etat.phase} {...stageMotion}>
          {etat.phase === 'LIVE' || etat.phase === 'ENDING' ? (
            <JourneyStage
              art={<LiveArt />}
              eyebrow="Parcours terminé"
              title="Le site du client est en ligne"
              description={
                etat.phase === 'ENDING' && sub.currentPeriodEnd
                  ? `Résiliation programmée : le site reste actif jusqu'au ${formatDate(sub.currentPeriodEnd)}.`
                  : etat.description
              }
              cta={
                contract.document.hasSigned ? (
                  <Button onClick={onDownloadSigned}>
                    <Download className="h-4 w-4" /> Télécharger le contrat
                  </Button>
                ) : undefined
              }
            />
          ) : etat.phase === 'DEV_SIGNATURE' ? (
            contract.signature.hasRequest ? (
              <JourneyStage
                art={<WaitingArt />}
                eyebrow="À vous"
                title="Signature en cours"
                // Ne promettre le retour automatique que si la plateforme l'a
                // accepté : c'est un fait constaté à l'ouverture, pas un réglage.
                // Faux => le signataire devra revenir de lui-même.
                //
                // Le nom du prestataire ne figure PAS dans ces phrases : il a déjà
                // changé une fois, et le signataire le lira de toute façon sur la
                // page où il atterrit.
                description={
                  contract.signature.autoReturn
                    ? "La demande de signature est partie. Terminez-la sur la plateforme de signature : vous serez ramené ici automatiquement."
                    : "La demande de signature est partie. Terminez-la sur la plateforme de signature, puis revenez sur cette page — votre signature sera détectée automatiquement."
                }
                note={
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Cette page se met à jour toute seule.
                  </span>
                }
              />
            ) : (
              // Le tour du DEV : un seul CTA, gros, et rien d'autre à l'écran.
              // Jamais « Signer (DEV) » — sur le contrat, le DEV n'est pas un
              // rôle technique, c'est une entreprise qui signe.
              <JourneyStage
                art={<SignatureArt />}
                eyebrow="À vous"
                title="Signez le contrat"
                description="Vous signez en premier ; le client reçoit la main juste après. La signature se fait en ligne, en quelques secondes."
                cta={
                  <Button size="lg" onClick={onSign} loading={pending}>
                    <PenLine className="h-4 w-4" /> Signer
                  </Button>
                }
              />
            )
          ) : etat.phase === 'CLIENT_SIGNATURE' || etat.phase === 'LAUNCH_FEE'
            || etat.phase === 'SUBSCRIPTION' || etat.phase === 'READY_TO_ACTIVATE'
            || etat.phase === 'ACTIVATING' ? (
            // Le contrat est en vie et attend le client. Le CTA DISPARAÎT : le
            // DEV n'a plus rien à faire — l'écran doit le rendre évident, et
            // nommer ce qu'on attend RÉELLEMENT (une signature, un règlement,
            // une mise en ligne), jamais « pas encore parti à la signature ».
            <JourneyStage
              art={<WaitingArt />}
              eyebrow={etat.badge}
              title={etat.title}
              description={etat.description}
              cta={
                contract.document.hasSigned ? (
                  <Button variant="outline" onClick={onDownloadSigned}>
                    <Download className="h-4 w-4" /> Télécharger le contrat
                  </Button>
                ) : undefined
              }
              note={
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Cette page se met à jour toute seule.
                  </span>
                  {etat.signatureNote && <span>· {etat.signatureNote}</span>}
                </span>
              }
            >
              {etat.next && (
                <p className="mb-3 text-sm">
                  <span className="text-muted-foreground">Prochaine étape : </span>{etat.next}
                </p>
              )}
              <ClientProgress contract={contract} />
            </JourneyStage>
          ) : etat.phase === 'DRAFT' ? (
            <JourneyStage
              art={<PreparationArt />}
              eyebrow={etat.badge}
              title={etat.title}
              description={etat.description}
              note={etat.signatureNote ? <span>{etat.signatureNote}</span> : undefined}
            />
          ) : (
            // Contrat clos ou en échec. L'écran dit l'état terminal réel — le
            // tracker affiche déjà « Échec bloquant », les deux doivent
            // s'accorder.
            <JourneyStage
              art={<WaitingArt />}
              eyebrow={etat.badge}
              title={etat.title}
              description={etat.description}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/**
 * Ce que le client est en train de faire — en clair, pas en jargon.
 *
 * Le DEV observe : aucun bouton ici, aucune action Stripe. Le but est qu'il
 * comprenne d'un coup d'œil qui travaille et sur quoi.
 */
function ClientProgress({ contract }: { contract: Contract }) {
  const rows: { label: string; done: boolean; skipped?: boolean }[] = [
    // Sans signature requise, la ligne N'EXISTE PAS : l'afficher « en attente »
    // ferait chercher une signature que personne n'attend.
    ...(contract.signatureApplicable === false
      ? []
      : [{ label: 'Signature du client', done: Boolean(contract.adminSigned) }]),
    {
      label: 'Frais de lancement',
      done: Boolean(contract.launchFeeSatisfied),
      skipped: !contract.launchFeeRequired,
    },
    {
      label: 'Abonnement',
      done: Boolean(contract.subscriptionSatisfied),
      skipped: !contract.subscriptionRequired,
    },
    { label: 'Mise en ligne du site', done: Boolean(contract.activation.activatedAt) },
  ];

  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3">
          <span className={r.done ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
          <span
            className={
              r.skipped
                ? 'text-xs text-muted-foreground'
                : r.done
                  ? 'text-xs font-medium text-emerald-700'
                  : 'text-xs text-muted-foreground'
            }
          >
            {r.skipped ? 'Non requis' : r.done ? 'Fait' : 'En attente'}
          </span>
        </li>
      ))}
    </ul>
  );
}
