from pathlib import Path 
path = Path('projectContext.json') 
text = path.read_text(encoding='latin-1') 
replacements = [ 
