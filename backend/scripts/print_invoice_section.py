from pathlib import Path

text = Path('architecture.md').read_text(encoding='iso-8859-1')
print(text.split('## 30. Factures clients', 1)[1])
