from pathlib import Path
path = Path('projectContext.json')
text = path.read_text(encoding='utf-8')
old = '      "role": "Expose l"edition, la lecture et la simulation du template VENTE pour les DEV.",'
new = '      "role": "Expose l’édition, la lecture et la simulation du template VENTE pour les DEV.",' 
if old not in text:
    raise SystemExit('role string not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
