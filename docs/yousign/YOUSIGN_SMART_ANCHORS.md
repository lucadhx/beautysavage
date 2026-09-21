# Yousign — Smart Anchors (référence confirmée)

> **Créé 2026-06-27** à partir du **scan API Reference live** (`developers.yousign.com`). Sources : `docs/fields-creation-with-smart-anchors`, `docs/fields`, `docs/signature-field`, `docs/text`, `docs/limits-new`, `docs/document-1`.
> **Statut** : ✅ CONFIRMÉ sauf mention contraire. **Lève le verrou « syntaxe Smart Anchors NON DOCUMENTÉE ».**

## 1. Définition

✅ Un **Smart Anchor** est un **placeholder texte** inséré dans le document, qui **positionne automatiquement un Field** (signature, texte, checkbox…) **sans coordonnées**. Yousign **scanne le document à l'activation**, reconnaît l'ancre et crée le Field.

## 2. Syntaxe (CONFIRMÉE)

Forme générale : `{{signer_index|field_type|width|height|…}}`

| Type | Pattern documenté |
|---|---|
| **Signature** | `{{s1|signature|85|37}}` → complet : `{{signer_index|signature|width|height|layout|date_time_format|show_timezone|show_signer_email}}` |
| **Texte** | `{{signer_index|text|max_length|width|height|question|instruction|optional|name}}` |
| Autres | checkbox et autres types évoqués (syntaxe complète par type non exhaustivement listée). |

- **`signer_index`** : `s1`, `s2`… = 1ᵉʳ, 2ᵉ signataire ⇒ **lie l'ancre au signataire**.
- **`width`/`height`** : en **pixels**.
- ⚠️ Une ancre référençant un **signer inexistant échoue silencieusement** (pas d'erreur).

## 3. Activation par l'API

- À l'ajout du document (`POST /signature_requests/{id}/documents`) : mettre **`parse_anchors: true`**.
- La réponse renvoie **`total_anchors`** = nombre d'ancres détectées.
- Sur un document **`sealed`**, seules les ancres **Signature** sont comptées.
- Le scan/remplacement par des Fields a lieu **à l'`activate`**.

## 4. Formats & compatibilité

| Question | Réponse |
|---|---|
| PDF supporté ? | ✅ **Oui** (PDF est un format signable). |
| DOCX supporté ? | ✅ Oui (DOCX/PNG/JPEG **convertis en PDF à l'upload** ; seul le PDF est stocké). |
| Formats signables | **PDF, DOCX** (déjà signé = PDF 1.6+). |
| PDF généré depuis HTML | ⚠️ **NON explicitement documenté** — techniquement attendu **si l'ancre est du vrai texte sélectionnable** (pas rasterisé). **À valider en sandbox.** |
| Détection dans le texte d'un PDF | ✅ Implicite : Yousign scanne le contenu du PDF à l'activation. |

## 5. Contraintes & limites (CONFIRMÉES)

- Document ≤ **50 Mo**, ≤ **150 pages**.
- **Ancre sur une seule ligne** (single-line).
- Police recommandée **Arial, 10-14 px**.
- **Couleur = couleur de fond** pour rendre l'ancre invisible dans le document final.

## 6. Toujours non documenté

- Comportement avec **ancres dupliquées** (même motif plusieurs fois).
- Comportement après **`replace` du document** (ancres/fields conservés ?).
- Liste **exhaustive des types** et de leurs paramètres positionnels complets.
- **Détection sur PDF généré depuis HTML** (point 4) → **sandbox**.

## 7. Smart Anchors vs Coordonnées (pour LYCARZ)

| Critère | Smart Anchors | Coordonnées API |
|---|---|---|
| Documenté | ✅ syntaxe confirmée | ✅ params confirmés |
| Robuste à la mise en page | ✅ (suit le texte) | ❌ (fragile si contenu variable) |
| Origine du repère | **non requise** | ❓ **NON DOCUMENTÉE** (haut/bas) |
| Manipulation visuelle (éditeur) | ❌ (texte dans le doc) | ✅ (drag) |
| PDF externe (texte non maîtrisé) | ❌ | ✅ |

➡️ **Reco** : **Smart Anchors pour les PDF générés** (Template Studio → ancre depuis le bloc Signature LYCARZ) ; **coordonnées en repli** pour la manipulation visuelle (éditeur) et les **PDF externes/uploadés**. Voir `../audits/YOUSIGN_API_REFERENCE_FULL_SCAN_AND_CRM_MAPPING_UPDATE.md` §5.3.
