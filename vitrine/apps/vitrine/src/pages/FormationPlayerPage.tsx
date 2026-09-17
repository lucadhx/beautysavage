// C2 — Page lecteur de formation (vitrine). Délègue au composant FormationPlayer.
import { useParams } from 'react-router-dom';
import { FormationPlayer } from '../features/learning/Player';

export function FormationPlayerPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <FormationPlayer formationId={id} />;
}
