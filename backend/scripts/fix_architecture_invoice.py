from pathlib import Path

path = Path('architecture.md')
data = path.read_bytes()
marker = b'\n## 30. Factures clients'
idx = data.find(marker)
if idx == -1:
    idx = len(data)
prefix = data[:idx]
lines = [
    '',
    '## 30. Factures clients',
    '',
    "- models/Invoice.js stocke les métadonnées immuables d'une facture (invoiceId, invoiceNumber, saleId, userId, montant, pdfPath, htmlContent et invoiceDate).",
    "- services/invoiceService.js charge 	emplates/invoice.html, applique les données de vente, convertit le résultat en PDF via pdfkit, écrit le fichier dans storage/invoices et crée le document Invoice.",
    "- controllers/clientController.persistSale() déclenche la génération de facture à la confirmation, enregistre la facture et continue d'envoyer l'email ; listMySales() joint les métadonnées (numero, date, downloadUrl).",
    "- controllers/invoiceController.downloadClientInvoice() et outers/clientRouter.js sécurisent GET /api/client/sales/:saleId/invoice, vérifient la propriété et streament le PDF via es.download.",
    "- public/js/modules/myAccountModule.js propose un bouton « Télécharger la facture » dans l'historique des achats avec Facture {{number}} · {{date}}.",
    "- Les PDF restent isolés dans storage/invoices et ne sont accessibles qu'au travers de l'endpoint authentifié, ce qui prépare l'envoi par email pour la version suivante."
]
text = "\n".join(lines) + "\n"
path.write_bytes(prefix + text.encode('iso-8859-1'))
