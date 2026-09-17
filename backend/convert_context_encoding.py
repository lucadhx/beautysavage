from pathlib import Path
path = Path('projectContext.json')
text = path.read_text(encoding='cp1252')
path.write_text(text, encoding='utf-8')
