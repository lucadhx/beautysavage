import pathlib
lines=pathlib.Path('app.js').read_text().splitlines()
for i in range(70, 110):
    print(f"{i+1}:{lines[i]}")
