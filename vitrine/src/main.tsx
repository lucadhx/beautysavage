import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SiteDataProvider } from '@/context/SiteDataContext';
import { applyCachedTheme } from '@/lib/theme';
import { App } from './App';
import './index.css';

/*
  AVANT TOUT RENDU — la palette mémorisée au dernier passage est posée sur le
  document. Rien n'est peint avec les couleurs par défaut d'`index.css`, qui ne
  sont celles d'aucun client.

  Au TOUT premier passage il n'y a rien à poser : `App` n'affiche alors rien du
  tout — pas même le loader — jusqu'à ce que le bootstrap donne le thème. Un
  loader peint aux mauvaises couleurs serait pire qu'un instant de fond neutre.
*/
applyCachedTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/*
      LA NAVIGATION EST UNE « TRANSITION » REACT.

      Les pages autres que l'accueil sont chargées à la demande. Sans ce
      drapeau, changer de route est une mise à jour URGENTE : React démonte la
      page précédente immédiatement et affiche le repli de `Suspense` en
      attendant le morceau de code — le temps d'un aller-retour réseau, la page
      se vide et le pied de page remonte dans le champ. Au second passage le
      morceau est en cache, il n'y a plus d'attente, et le défaut disparaît :
      c'est ce qui le rendait insaisissable.

      En transition, React garde la page COURANTE à l'écran et ne bascule que
      lorsque la suivante est prête. Le fondu ne démarre donc plus dans le vide.
    */}
    <BrowserRouter future={{ v7_startTransition: true }}>
      <SiteDataProvider>
        <App />
      </SiteDataProvider>
    </BrowserRouter>
  </React.StrictMode>
);
