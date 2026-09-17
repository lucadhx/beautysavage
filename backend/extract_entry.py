import json
from pathlib import Path
with open('projectContext.json', encoding='utf-8') as f:
    data = json.load(f)
for entry in data['files']:
    if entry['path'] == 'app.js':
        import json
        print(json.dumps(entry, ensure_ascii=False, indent=2))
        break
