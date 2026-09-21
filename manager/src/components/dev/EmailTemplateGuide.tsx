import * as React from 'react';
import { BookOpen, Check, X, Info, AlertTriangle } from 'lucide-react';

/**
 * Onglet GUIDE de l'éditeur de templates e-mail.
 *
 * ⚠️ RÈGLE DE DÉVELOPPEMENT — CE GUIDE EST PARTIE DU CONTRAT.
 *
 * Toute modification du système d'édition de templates (variable ajoutée, balise
 * nouvellement interdite, comportement des versions, règle de sécurité, statut de
 * livraison) DOIT être répercutée ici, dans le même lot.
 *
 * Ce n'est pas de la documentation « en plus » : c'est la seule que lira le DEV
 * qui édite un template à 23 h. Un guide périmé est pire que pas de guide — il
 * fait perdre du temps ET donne une fausse assurance. Voir docs/EMAIL_TEMPLATE_EDITOR.md.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
}

function Yes({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </li>
  );
}

function No({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
      <span>{children}</span>
    </li>
  );
}

export function EmailTemplateGuide() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Ce guide décrit le fonctionnement réel de l’éditeur. Il est maintenu à jour à chaque
          évolution du système de templates.
        </p>
      </div>

      <Section title="Qu’est-ce qu’un template ?">
        <p>
          Un template est le <strong>contenu</strong> d’un e-mail : un sujet et un document HTML,
          dans lesquels des <strong>variables</strong> seront remplacées par des valeurs réelles au
          moment de l’envoi.
        </p>
        <p>C’est tout. Un template ne contient pas :</p>
        <ul className="space-y-1">
          <No><strong>le destinataire</strong> — il est résolu à l’envoi (voir plus bas) ;</No>
          <No><strong>les valeurs</strong> des variables — elles viennent du code métier ;</No>
          <No><strong>la décision d’envoyer</strong> — elle vient d’un événement ;</No>
          <No><strong>l’expéditeur</strong> — il vient de la configuration e-mail.</No>
        </ul>
      </Section>

      <Section title="Ce que vous pouvez modifier, et ce qui vient du code">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-1.5 pr-4 font-semibold text-foreground">Vous (Manager)</th>
                <th className="pb-1.5 font-semibold text-foreground">Le code (non modifiable ici)</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr>
                <td className="py-1 pr-4">Le nom</td>
                <td className="py-1">L’identifiant technique</td>
              </tr>
              <tr>
                <td className="py-1 pr-4">La description</td>
                <td className="py-1">La liste des variables autorisées</td>
              </tr>
              <tr>
                <td className="py-1 pr-4">Le sujet</td>
                <td className="py-1">Le type de chaque variable</td>
              </tr>
              <tr>
                <td className="py-1 pr-4">Le contenu HTML</td>
                <td className="py-1">Le caractère obligatoire d’une variable</td>
              </tr>
              <tr>
                <td className="py-1 pr-4">L’état actif / inactif</td>
                <td className="py-1">Le destinataire</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Il n’y a pas de bouton « Créer un template » : un identifiant inventé ici produirait un
          template que personne n’appelle. De même, une variable inventée n’aurait aucune valeur à
          l’exécution — l’enregistrement est donc refusé.
        </p>
      </Section>

      <Section title="Insérer une variable">
        <p>
          Écrivez <Code>{'{{groupe.cle}}'}</Code>, ou passez par l’onglet <strong>Variables</strong> et
          cliquez sur <strong>Insérer</strong> : la variable est placée à la position de votre
          curseur dans le contenu HTML.
        </p>
        <p>La syntaxe est volontairement pauvre. Il n’y a :</p>
        <ul className="space-y-1">
          <No>aucune condition (<Code>{'{{#if x}}'}</Code>) ;</No>
          <No>aucune boucle (<Code>{'{{#each x}}'}</Code>) ;</No>
          <No>aucun appel de fonction (<Code>{'{{formater(x)}}'}</Code>) ;</No>
          <No>aucun accès dynamique (<Code>{'{{objet["cle"]}}'}</Code>).</No>
        </ul>
        <p>
          Un moteur qui évalue des expressions est un moteur qu’on finit par détourner. Comme les
          templates s’éditent depuis le web, le risque n’est pas qu’il manque une boucle : c’est
          qu’un template devienne exécutable.
        </p>
      </Section>

      <Section title="Comment les valeurs sont résolues">
        <p>
          Chaque variable a un <strong>type</strong> (visible dans l’onglet Variables), et le type
          décide du formatage :
        </p>
        <ul className="space-y-1">
          <Yes><Code>DATE</Code> → <Code>17/07/2026</Code> (fuseau Europe/Paris)</Yes>
          <Yes><Code>DATETIME</Code> → <Code>17/07/2026 à 14:32</Code></Yes>
          <Yes><Code>MONEY</Code> → <Code>99,00 €</Code> (la valeur est en centimes)</Yes>
          <Yes><Code>BOOLEAN</Code> → <Code>Oui</Code> / <Code>Non</Code></Yes>
          <Yes><Code>EMAIL</Code>, <Code>URL</Code> → vérifiés ; une URL en <Code>javascript:</Code> est refusée</Yes>
          <Yes><Code>TEXT</Code>, <Code>PHONE</Code> → texte, <strong>échappé</strong></Yes>
        </ul>
        <p>
          <strong>Toute valeur est échappée</strong> : si un visiteur écrit <Code>&lt;script&gt;</Code> dans
          son message, le destinataire lira ces caractères, il ne les exécutera pas. Une variable ne
          peut pas devenir du HTML par accident.
        </p>
        <p>
          Une variable <strong>obligatoire</strong> absente fait échouer l’envoi. Une variable
          facultative non fournie devient une chaîne vide — jamais <Code>{'{{cle}}'}</Code> laissé en
          clair dans l’e-mail.
        </p>
      </Section>

      <Section title="Pourquoi le destinataire est séparé">
        <p>
          Un template est du contenu, éditable depuis cette page. Un destinataire est une décision
          métier (« qui doit être prévenu quand ceci arrive ? »). Les mélanger aurait deux
          conséquences :
        </p>
        <ul className="space-y-1">
          <No>une adresse deviendrait modifiable par quiconque édite un template — un e-mail
            pourrait être détourné sans toucher au code ;</No>
          <No>l’adresse serait figée dans du contenu, alors qu’elle doit être recalculée à chaque
            envoi (un administrateur ajouté hier doit recevoir l’e-mail d’aujourd’hui).</No>
        </ul>
        <p>
          C’est pourquoi aucun template ne porte d’adresse, et pourquoi vous ne pouvez pas en
          ajouter une.
        </p>
      </Section>

      <Section title="Quelles balises HTML sont autorisées">
        <p>Écrivez du HTML d’e-mail : tables, styles inline. Ce qui fonctionne partout :</p>
        <ul className="space-y-1">
          <Yes><Code>&lt;table&gt;</Code>, <Code>&lt;tr&gt;</Code>, <Code>&lt;td&gt;</Code> — la mise en page (flexbox et grid ne sont pas fiables en e-mail)</Yes>
          <Yes><Code>style="…"</Code> inline — Gmail supprime une partie du <Code>&lt;style&gt;</Code></Yes>
          <Yes><Code>&lt;style&gt;</Code> — autorisé, et nécessaire pour les <Code>@media</Code> (responsive)</Yes>
          <Yes><Code>&lt;img&gt;</Code>, <Code>&lt;a&gt;</Code>, <Code>&lt;p&gt;</Code>, <Code>&lt;h1&gt;</Code>–<Code>&lt;h6&gt;</Code>, <Code>&lt;strong&gt;</Code>…</Yes>
          <Yes>Liens en <Code>https:</Code>, <Code>mailto:</Code>, <Code>tel:</Code></Yes>
          <Yes>Images en <Code>data:image/png;base64,…</Code></Yes>
        </ul>
      </Section>

      <Section title="Quelles balises sont interdites">
        <ul className="space-y-1">
          <No><Code>&lt;script&gt;</Code> — contenu actif</No>
          <No><Code>&lt;iframe&gt;</Code>, <Code>&lt;object&gt;</Code>, <Code>&lt;embed&gt;</Code>, <Code>&lt;applet&gt;</Code> — contenu embarqué</No>
          <No><Code>&lt;svg&gt;</Code>, <Code>&lt;math&gt;</Code> — peuvent contenir du script</No>
          <No><Code>&lt;form&gt;</Code>, <Code>&lt;input&gt;</Code>, <Code>&lt;button&gt;</Code> — un formulaire dans un e-mail est un motif de hameçonnage, et les clients le neutralisent</No>
          <No><Code>&lt;link&gt;</Code>, <Code>&lt;base&gt;</Code> — ressource externe, réécriture des URL</No>
          <No>Tout attribut <Code>on…</Code> (<Code>onclick</Code>, <Code>onerror</Code>…)</No>
          <No>Les URL en <Code>javascript:</Code>, <Code>vbscript:</Code>, <Code>file:</Code>, <Code>data:text/html</Code></No>
        </ul>
        <p>
          Un template qui en contient est <strong>refusé à l’enregistrement</strong>, avec la ligne
          en cause. Rien n’est nettoyé en silence : un nettoyage automatique produirait un contenu
          que vous n’avez pas écrit et que vous ne pourriez pas relire.
        </p>
      </Section>

      <Section title="Pourquoi JavaScript est interdit">
        <p>
          Aucun client e-mail sérieux n’exécute JavaScript — Gmail, Outlook et Apple Mail le
          suppriment. Un script dans un template ne servirait donc à rien chez le destinataire.
        </p>
        <p>
          En revanche, il servirait <strong>ici</strong> : le contenu transite par cette interface,
          et un template est visible par d’autres personnes. L’interdiction protège l’application,
          pas l’e-mail.
        </p>
        <p className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            L’aperçu de cette page est rendu dans un cadre isolé (<Code>iframe sandbox</Code>) : même si
            un contournement échappait à la validation, rien ne pourrait s’exécuter dans le Manager.
          </span>
        </p>
      </Section>

      <Section title="Tester un template">
        <p>Deux choses très différentes :</p>
        <ul className="space-y-1">
          <Yes>
            <strong>L’aperçu</strong> (onglet Aperçu) — rend le template avec des données
            <strong> fictives</strong>, en direct pendant la saisie. <strong>N’envoie aucun e-mail.</strong> Gratuit,
            instantané, sans effet de bord.
          </Yes>
          <Yes>
            <strong>« Envoyer un test »</strong> — envoie un <strong>vrai e-mail</strong>, par le même
            chemin que les envois automatiques : mêmes vérifications, même expéditeur, même
            fournisseur, même journal. C’est la seule façon de savoir ce que voit réellement un
            destinataire (les clients e-mail déforment le HTML chacun à leur manière).
          </Yes>
        </ul>
        <p>
          L’envoi de test consomme un crédit Brevo réel. Il utilise les données de démonstration du
          template.
        </p>
      </Section>

      <Section title="Si l’expéditeur n’est pas vérifié">
        <p>
          <strong>Rien ne part</strong> — ni les e-mails automatiques, ni les tests. Ce n’est pas une
          règle maison : Brevo refuse d’envoyer depuis une adresse dont il n’a pas prouvé que nous
          possédons la boîte. L’envoi est donc refusé <em>avant</em> l’appel, avec un message clair
          plutôt qu’une erreur obscure du fournisseur.
        </p>
        <p>
          Une vérification vaut pour <strong>un seul mode</strong> (TEST ou PROD) : ce sont
          potentiellement deux comptes Brevo différents. Vérifier en TEST ne vérifie pas en PROD.
          Rendez-vous dans <strong>Configuration e-mail</strong> pour vérifier l’adresse.
        </p>
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            À ne pas confondre avec le <strong>domaine non authentifié</strong> : celui-ci n’empêche
            rien. Il dégrade seulement la délivrabilité (Brevo réécrit l’expéditeur). Une adresse
            Gmail, par exemple, ne pourra jamais avoir son domaine authentifié — son DNS ne nous
            appartient pas — et fonctionne pourtant très bien.
          </span>
        </p>
      </Section>

      <Section title="« En attente de confirmation » n’est pas « Livré »">
        <p>
          Juste après un envoi, le journal indique <strong>En attente de confirmation</strong> :
          Brevo a pris la demande en charge et renvoyé un identifiant de message. C’est tout ce que
          l’on peut constater à cet instant — le message peut encore rebondir, être classé en spam,
          ou être refusé par le serveur du destinataire.
        </p>
        <p>
          Le statut passe à <strong>Livré</strong> quand Brevo nous notifie la remise, par webhook.
          C’est la <strong>seule</strong> preuve acceptée : aucun écran n’affirme qu’un e-mail a été
          reçu sur la seule foi de l’envoi.
        </p>
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            Ce suivi est <strong>obligatoire</strong>, pas optionnel : si les notifications ne nous
            parviennent plus, l’envoi est <strong>refusé avant d’atteindre Brevo</strong> plutôt que
            de produire des livraisons éternellement « en attente ». Rien n’est perdu — la tentative
            porte alors le statut <strong>Envoi suspendu</strong>, et repart d’elle-même dès le suivi
            rétabli. C’est aussi pourquoi « Envoyer un test » peut être désactivé : la cause et le
            geste de réparation sont indiqués dans <strong>Configuration e-mail</strong>.
          </span>
        </p>
      </Section>

      <Section title="Comment fonctionnent les versions">
        <p>
          Chaque enregistrement réussi crée une <strong>version</strong>. L’onglet Versions permet de
          les consulter, d’en prévisualiser une, et d’en restaurer une.
        </p>
        <ul className="space-y-1">
          <Yes>Restaurer la v3 alors que vous êtes en v7 crée une <strong>v8</strong> contenant le
            contenu de la v3.</Yes>
          <Yes>Les v4 à v7 <strong>existent toujours</strong> : vous pouvez revenir sur une
            restauration.</Yes>
          <No>Rien n’est jamais écrasé ni effacé silencieusement.</No>
        </ul>
        <p>
          Une ancienne version peut être devenue <strong>irrestaurable</strong> si une variable a été
          retirée du code depuis : l’aperçu de version vous le signale, et la restauration est
          refusée.
        </p>
        <p>
          Si quelqu’un enregistre pendant que vous éditez, votre enregistrement est <strong>refusé</strong> (conflit
          de version) plutôt que d’écraser son travail. Vos modifications restent à l’écran :
          rechargez pour repartir de la dernière version.
        </p>
      </Section>

      <Section title="Bon à savoir">
        <ul className="space-y-1">
          <Yes><strong>Ctrl/⌘ + S</strong> enregistre.</Yes>
          <Yes>Au-delà d’environ 100 ko, Gmail tronque l’e-mail et affiche « [Message tronqué] » :
            l’enregistrement est refusé avant d’en arriver là.</Yes>
          <Yes>L’aperçu mobile fait 375 px (iPhone SE), le bureau 600 px — la largeur canonique d’un
            e-mail, au-delà de laquelle Outlook coupe.</Yes>
          <Yes>Le journal des envois ne conserve <strong>jamais</strong> le contenu final ni les
            adresses en clair : il sert à diagnostiquer, pas à relire des e-mails.</Yes>
        </ul>
      </Section>
    </div>
  );
}

export default EmailTemplateGuide;
