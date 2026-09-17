import pathlib
lines = pathlib.Path('architecture.md').read_text().splitlines()
for i,line in enumerate(lines):
    if 'Navigation vitrine' in line:
        print(i+1, repr(line))
        break
else:
    print('not found')
