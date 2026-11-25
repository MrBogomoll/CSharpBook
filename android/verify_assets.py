"""Check resources that the local HTTP server opens as seekable file descriptors."""
import hashlib
import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

apk, web_root = map(Path, sys.argv[1:])
with ZipFile(apk) as archive:
    for asset in sorted(path for path in web_root.rglob('*') if path.is_file()):
        name = 'assets/www/' + asset.relative_to(web_root).as_posix()
        if archive.getinfo(name).compress_type != ZIP_STORED:
            raise ValueError(f'Asset must support openFd: {name}')
        if hashlib.sha256(archive.read(name)).digest() != hashlib.sha256(asset.read_bytes()).digest():
            raise ValueError(f'Packaged asset differs: {name}')
