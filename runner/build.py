"""Build both real WebAssembly runtimes with the installed .NET 10/11 reference packs."""
from pathlib import Path
import gzip
import base64
import hashlib
import json
import re
import shutil
import struct
import subprocess
import zipfile

# Standalone Mono's prebuilt wasm defines and exports one linear memory. Set
# its actual engine-enforced maximum to 256 MiB (4,096 64-KiB pages).
def uleb(number):
    out = bytearray()
    while number >= 128:
        out.append((number & 127) | 128)
        number >>= 7
    out.append(number)
    return bytes(out)

def limit_memory(wasm):
    def read(position):
        value = shift = 0
        while True:
            octet = wasm[position]
            position += 1
            value |= (octet & 127) << shift
            if octet < 128:
                return value, position
            shift += 7
    cursor = 8
    while cursor < len(wasm):
        section = wasm[cursor]
        size, start = read(cursor + 1)
        if section == 5:
            count, pos = read(start)
            flags, pos = read(pos)
            minimum, pos = read(pos)
            maximum, pos = read(pos)
            assert count == flags == 1 and minimum <= 4096 <= maximum and pos == start + size
            data = uleb(count) + uleb(flags) + uleb(minimum) + uleb(4096)
            return wasm[:cursor+1] + uleb(len(data)) + data + wasm[pos:]
        cursor = start + size
    raise ValueError("Expected the published wasm to define its own linear memory")

root = Path(__file__).resolve().parent
output = root.parent / "wwwroot" / "runtime"
output.mkdir(parents=True, exist_ok=True)
shutil.copytree(root / "notices",output / "notices",dirs_exist_ok=True)
sdk_root = Path(subprocess.check_output(["dotnet", "--list-sdks"], text=True).splitlines()[-1].split("[")[-1].rstrip("]")).parent
packs = sdk_root / "packs" / "Microsoft.NETCore.App.Ref"
for major in (10, 11):
    target = f"net{major}.0"
    pack = max((d for d in packs.glob(f"{major}.*") if d.is_dir()), key=lambda d: tuple(map(int,d.name.split("."))))
    (root / "obj").mkdir(exist_ok=True)
    with zipfile.ZipFile(root / "obj" / f"refs-{target}.zip","w",zipfile.ZIP_DEFLATED) as refs:
        for dll in sorted((pack / "ref" / target).glob("*.dll")):
            refs.write(dll,dll.name)
    subprocess.run(["dotnet","publish","StudentRunner.csproj","-f",target,"-c","Release","--nologo","-v:q"],cwd=root,check=True)
    framework = root / "bin" / "Release" / target / "publish" / "wwwroot" / "_framework"
    assert (framework / "dotnet.js").is_file()
    loader = (framework / "dotnet.js").read_text("utf8")
    manifest = json.loads(re.search(r"/\*json-start\*/(.*?)/\*json-end\*/",loader,re.S)[1])
    descriptors = manifest["resources"]
    paths = {"dotnet.js"}
    for group in descriptors.values():
        if isinstance(group, list):
            paths.update(item["name"] for item in group)
        elif isinstance(group, dict):
            for culture, entries in group.items():
                paths.update(culture + "/" + item["name"] for item in entries)
    native = descriptors["wasmNative"][0]
    native_bytes = limit_memory((framework / native["name"]).read_bytes())
    native_hash = "sha256-" + base64.b64encode(hashlib.sha256(native_bytes).digest()).decode()
    loader = loader.replace(native["hash"],native_hash)
    filename = output / f"net{major}.bin"
    temporary = filename.with_suffix(".tmp")
    with temporary.open("wb") as dest, gzip.GzipFile(filename="",fileobj=dest, mode="wb", compresslevel=6,mtime=0) as bundle:
        for path in sorted(paths):
            name = path.encode("utf-8")
            data = loader.encode() if path == "dotnet.js" else native_bytes if path == native["name"] else (framework / path).read_bytes()
            bundle.write(struct.pack("<II",len(name),len(data)) + name + data)
        for path in (root / "portable-digest.js", root / "noble-hashes.LICENSE"):
            name, data = path.name.encode(), path.read_bytes()
            bundle.write(struct.pack("<II",len(name),len(data)) + name + data)
    temporary.replace(filename)
    print(f"{filename.name}: {filename.stat().st_size:,} bytes")
