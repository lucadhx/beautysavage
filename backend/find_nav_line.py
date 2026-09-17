import pathlib
lines = pathlib.Path('architecture.md').read_text().splitlines()
for i,line in enumerate(lines):
    if 'Navigation' in line:
        print(i+1, repr(line))
