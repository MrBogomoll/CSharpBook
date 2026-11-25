"""Package finalized artifacts from published desktop and optional cross-platform host builds."""
import argparse
from filecmp import cmp
from pathlib import Path
import shutil
from xml.etree import ElementTree
from zipfile import ZipFile,ZIP_DEFLATED,ZIP_STORED

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--windows',required=True,type=Path)
p.add_argument('--server',required=True,type=Path)
p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
metadata=ElementTree.parse(root/'host/CSharpBook.csproj')
version=metadata.findtext('./PropertyGroup/InformationalVersion') or metadata.findtext('./PropertyGroup/Version')
if not version:
    p.error('Укажи версию приложения в host/CSharpBook.csproj перед упаковкой.')
out=a.output.resolve()
out.mkdir(exist_ok=True,parents=True)
desktop=out/'Учебник CSharp'
desktop.mkdir(exist_ok=True)
web=root/'wwwroot'
published_exe=a.windows/'CSharpBook.exe'
desktop_exe=desktop/'CSharpBook.exe'
if not desktop_exe.is_file() or not cmp(published_exe,desktop_exe,shallow=False):
    shutil.copy2(published_exe,desktop_exe)
shutil.copy2(root/'host/Начало работы.txt',desktop)
shutil.copytree(web,desktop/'wwwroot',dirs_exist_ok=True)
shutil.copytree(root/'host/licenses',desktop/'licenses',dirs_exist_ok=True)
def pack_folder(zip_,folder,prefix=''):
    for f in sorted(folder.rglob('*')):
        if f.is_file():zip_.write(f,prefix+f.relative_to(folder).as_posix(),compress_type=ZIP_STORED if f.suffix in ['.bin','.zip'] else ZIP_DEFLATED)
with ZipFile(out/f'CSharpBook-{version}-Windows-x64.zip','w',ZIP_DEFLATED,compresslevel=3) as z:
    pack_folder(z,desktop,'CSharpBook/')
with ZipFile(out/f'CSharpBook-{version}-Web.zip','w',ZIP_DEFLATED,compresslevel=5) as z:
    pack_folder(z,web,'wwwroot/')
    for f in a.server.glob('CSharpBook.Server.*'):
        if f.suffix=='.dll' or f.name.endswith(('.runtimeconfig.json','.deps.json')):z.write(f,f.name)
    z.writestr('README.txt','Учебник C# для браузера\n\nРаспакуй архив и установи .NET SDK 10 или среду ASP.NET Core 10. Открой терминал в распакованной папке и выполни dotnet CSharpBook.Server.dll . В браузере открой http://127.0.0.1:53821/ . Для телефона в той же сети добавь к команде флаг --lan и открой на телефоне адрес, который напечатает терминал.\n\nДля установки веб-приложения на домашний экран iPhone или Android размести wwwroot на HTTPS-сервере. Для интерактивного ввода в браузерах без поддержки общей памяти подключи серверный маршрут /api/book-input вместе с маршрутами read и write. Настройки заголовков для статического хостинга приведены в wwwroot/_headers. Обновление списка автономных файлов выполняется при сборке.\n')

