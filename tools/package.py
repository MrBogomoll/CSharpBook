"""Package finalized artifacts from published desktop and optional cross-platform host builds."""
import argparse
from pathlib import Path
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
web=root/'wwwroot'
published_exe=a.windows/'Sharpwise.exe'
if not published_exe.is_file():
    p.error(f'Не найден {published_exe}. Сначала собери приложение для Windows.')
def pack_folder(zip_,folder,prefix=''):
    for f in sorted(folder.rglob('*')):
        if f.is_file():zip_.write(f,prefix+f.relative_to(folder).as_posix(),compress_type=ZIP_STORED if f.suffix in ['.bin','.zip'] else ZIP_DEFLATED)
with ZipFile(out/f'Sharpwise-{version}-Windows-x64-Portable.zip','w',ZIP_DEFLATED,compresslevel=3) as z:
    z.write(published_exe,'Sharpwise/Sharpwise.exe')
    z.write(root/'host/Начало работы.txt','Sharpwise/Начало работы.txt')
    z.write(root/'LICENSE','Sharpwise/licenses/Sharpwise-LICENSE.txt')
    pack_folder(z,web,'Sharpwise/wwwroot/')
    pack_folder(z,root/'host/licenses','Sharpwise/licenses/')
with ZipFile(out/f'Sharpwise-{version}-Web.zip','w',ZIP_DEFLATED,compresslevel=5) as z:
    pack_folder(z,web,'wwwroot/')
    z.write(root/'LICENSE','LICENSE')
    for f in a.server.glob('CSharpBook.Server.*'):
        if f.suffix=='.dll' or f.name.endswith(('.runtimeconfig.json','.deps.json')):z.write(f,f.name)
    z.writestr('README.txt','Sharpwise — учебник C# для браузера\n\nРаспакуй архив и установи .NET SDK 10 или среду ASP.NET Core 10. Открой терминал в распакованной папке и выполни dotnet CSharpBook.Server.dll . В браузере открой http://127.0.0.1:53821/ . Для телефона в той же сети добавь к команде флаг --lan и открой на телефоне адрес, который напечатает терминал.\n\nДля установки веб-приложения на домашний экран iPhone или Android размести wwwroot на HTTPS-сервере. Для интерактивного ввода в браузерах без поддержки общей памяти подключи серверный маршрут /api/book-input вместе с маршрутами read и write. Настройки заголовков для статического хостинга приведены в wwwroot/_headers. Обновление списка автономных файлов выполняется при сборке.\n')

