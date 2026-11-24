import hashlib
import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

apk, www, dex, android = map(Path, sys.argv[1:])
with ZipFile(apk, 'a', compression=ZIP_STORED, allowZip64=False) as archive:
    for artifact in sorted(dex.glob('classes*.dex')):
        archive.write(artifact, artifact.name)
    for asset in sorted(p for p in www.rglob('*') if p.is_file()):
        archive.write(asset, 'assets/www/' + asset.relative_to(www).as_posix())
    archive.write(android / 'LICENSE-NanoHTTPD.txt', 'assets/licenses/NanoHTTPD.txt')
    for directory in [www.parent / 'host' / 'licenses', www.parent / 'licenses']:
        if directory.is_dir():
            for license_file in sorted(p for p in directory.rglob('*') if p.is_file()):
                name = 'assets/licenses/' + license_file.relative_to(directory).as_posix()
                if name not in archive.namelist():
                    archive.write(license_file, name)
with ZipFile(apk) as archive:
    for asset in sorted(p for p in www.rglob('*') if p.is_file()):
        name = 'assets/www/' + asset.relative_to(www).as_posix()
        assert archive.getinfo(name).compress_type == ZIP_STORED, f'Asset must support openFd: {name}'
        assert hashlib.sha256(archive.read(name)).digest() == hashlib.sha256(asset.read_bytes()).digest(), name
