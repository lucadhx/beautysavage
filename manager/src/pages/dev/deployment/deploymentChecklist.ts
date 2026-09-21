import * as React from 'react';
import { api } from '@/lib/api';
import type { DeploymentStepContract, DeploymentRunMode } from '@/types';

/**
 * LA CHECKLIST DE DÉPLOIEMENT — DÉRIVÉE, jamais écrite à la main.
 *
 * ══ CE QUE CE MODULE REMPLACE ═══════════════════════════════════════════════
 *
 * Trois listes vivaient dans `friendly.ts` :
 *
 *   · `CHECKLIST_STEPS` — la checklist du déploiement, ids + libellés + icônes
 *     + ordre, recopiés à la main depuis le catalogue du moteur ;
 *   · `PRECHECK_STEPS` — le sous-ensemble du préflight, avec des libellés
 *     DIFFÉRENTS pour les mêmes identifiants ;
 *   · `PIPELINE_PHASES` / `PIPELINE_ORDER` — une table indexée par les
 *     identifiants BRUTS internes au pipeline distant (`dirs`, `certbot`,
 *     `reload`), que l'interface n'a aucune raison de connaître.
 *
 * Elles ont dérivé : le moteur a renommé `dns.manager` en `dns.apps`, et
 * l'écran a continué d'afficher une ligne qui ne recevait plus d'événement.
 * Elle restait « en attente » sur un déploiement pourtant réussi.
 *
 * ══ CE QUI LES REMPLACE ═════════════════════════════════════════════════════
 *
 * Une projection du registre backend (`GET /deployment/phases`), filtrée par
 * MODE. Une ligne n'existe que si le contrat la déclare ; un état n'existe que
 * si un événement l'a dit.
 */

export type DeploymentChecklistRow = {
  id: string;
  label: string;
  icon: string;
  group: string;
  conditional?: boolean;
};

/**
 * Les étapes visibles d'un mode, dans l'ordre canonique, avec le libellé qui
 * convient à ce mode.
 *
 * Le libellé alternatif du préflight est DÉCLARÉ dans le registre — en
 * préflight, « Préparation du déploiement » serait mensonger, rien n'étant
 * déployé. Le choix appartient au contrat, pas à l'écran.
 */
export function checklistFor(
  contract: DeploymentStepContract[],
  mode: DeploymentRunMode,
): DeploymentChecklistRow[] {
  return [...contract]
    .filter((s) => s.visible && s.modes.includes(mode))
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.id,
      label: mode === 'PRECHECK' && s.precheckLabel ? s.precheckLabel : s.label,
      icon: s.icon,
      group: s.group,
      ...(s.conditional ? { conditional: true } : {}),
    }));
}

/**
 * LE CONTRAT, DEMANDÉ UNE FOIS.
 *
 * ══ AUCUN REPLI FIGÉ, ET C'EST DÉLIBÉRÉ ═════════════════════════════════════
 *
 * La tentation, quand un appel réseau peut échouer, est d'embarquer une copie
 * « au cas où ». Ce serait exactement recréer la liste parallèle qu'on vient de
 * supprimer — avec la garantie qu'elle dérivera, puisqu'elle ne servirait que
 * les jours où personne ne regarde.
 *
 * Sans contrat, la checklist est donc VIDE et l'écran le DIT. Le déploiement,
 * lui, continue : la progression est un confort, pas une dépendance.
 */
export function useDeploymentStepContract(): {
  contract: DeploymentStepContract[];
  unavailable: boolean;
} {
  const [contract, setContract] = React.useState<DeploymentStepContract[]>([]);
  const [unavailable, setUnavailable] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    void api.deployment
      .phases()
      .then((rows) => { if (vivant) { setContract(rows); setUnavailable(false); } })
      .catch(() => { if (vivant) setUnavailable(true); });
    return () => { vivant = false; };
  }, []);

  return { contract, unavailable };
}

export default checklistFor;
