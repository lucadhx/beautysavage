from pathlib import Path

path = Path('architecture.md')

data = path.read_text(encoding='iso-8859-1')

marker = '\n## 30. Factures clients'
idx = data.find(marker)
if idx == -1:
    idx = len(data)
prefix = data[:idx]
