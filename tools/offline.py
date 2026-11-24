"""Update the cache manifest for a finished textbook build."""
from hashlib import sha256
from pathlib import Path
import json

web = Path(__file__).resolve().parents[1] / 'wwwroot'
files = []
digest = sha256()
for path in sorted(web.rglob('*')):
    name = path.relative_to(web).as_posix()
    if not path.is_file() or name in ('sw.js', 'offline.json', '_headers'):
        continue
    digest.update(name.encode() + path.read_bytes())
    files.append('./' + name)
worker = (web / 'sw.js').read_text(encoding='utf-8')
digest.update(worker.split('\n', 1)[1].encode())
version = digest.hexdigest()[:16]
(web / 'offline.json').write_text(json.dumps(files,ensure_ascii=False),encoding='utf-8')
(web / 'sw.js').write_text("const BOOK_CACHE='csharp-book-" + version + "';\n" + worker.split('\n',1)[1],encoding='utf-8')

