import pathlib
lines=pathlib.Path('public/css/app.css').read_text().splitlines()
for i in range(300, 370):
    print(f"{i+1}:{lines[i]}")
