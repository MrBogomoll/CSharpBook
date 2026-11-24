"""Create the in-lesson project browser from the actual downloadable example."""
from pathlib import Path
from zipfile import ZipFile
import json

root=Path(__file__).resolve().parents[1]/'wwwroot/projects'
archive=root/'ExpenseTracker-structure.zip'
with ZipFile(archive) as source:
    files={name:source.read(name).decode('utf-8-sig') for name in sorted(source.namelist())
           if not name.endswith('/') and Path(name).suffix.lower() in {'.cs','.csproj','.slnx','.sln','.md'}}
if not any(name.endswith('Program.cs') for name in files):
    raise ValueError('В примере отсутствует Program.cs')
(root/'structure.json').write_text(json.dumps(files,ensure_ascii=False),encoding='utf-8')

