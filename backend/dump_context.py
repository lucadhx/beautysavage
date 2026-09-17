import json
from pathlib import Path
with open('projectContext.json', encoding='utf-8') as f:
    data = json.load(f)
print('id:', data.get('id'))
print('files count:', len(data.get('files', [])))
for entry in data['files'][:5]:
    print('-', entry['path'], entry['type'])
