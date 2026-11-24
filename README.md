# Учебник C# с нуля

**[Скачать для Android (.apk)](https://github.com/MrBogomoll/CSharpBook/releases/download/v0.1.0/CSharpBook-0.1.0-Android.apk)** · **[Скачать для Windows x64 (.zip)](https://github.com/MrBogomoll/CSharpBook/releases/download/v0.1.0/CSharpBook-0.1.0-Windows-x64.zip)** · [Веб-версия для своего сервера](https://github.com/MrBogomoll/CSharpBook/releases/download/v0.1.0/CSharpBook-0.1.0-Web.zip)

Первый стабильный выпуск — **0.1.0**. В учебнике 13 глав, 47 тем, 94 примера с разбором и 47 самостоятельных заданий. [Все выпуски](https://github.com/MrBogomoll/CSharpBook/releases)

На Android открой ссылку на APK в браузере телефона и установи скачанный файл. Учебник и компилятор работают автономно. Для уроков C# 15 требуется Android System WebView версии 137 или новее. На Windows распакуй ZIP целиком и открой `CSharpBook.exe`. На iPhone можно подключиться через браузер к Windows-версии по одной сети Wi-Fi. Для этого в настройках Windows-приложения нажми «Открыть доступ по Wi-Fi» и отсканируй QR-код.

Русскоязычный учебник для компьютера и телефона. Оглавление, уроки, закладки и консоль используют один адаптивный интерфейс. Прогресс и черновики сохраняются на устройстве. В упражнениях и редакторе Roslyn компилирует исходный C# с дополнительными файлами и выполняет его в изолированном Web Worker с .NET WebAssembly. Базовые примеры используют .NET 10 и C# 14. Уроки по C# 15 переключаются на .NET 11.

## Структура исходников

- `wwwroot/course.json` содержит оглавление и материал уроков.
- `wwwroot/app.js`, `views.js`, `storage.js` и таблицы стилей отвечают за навигацию, уроки, оформление и хранение состояния.
- `wwwroot/console.js` и `wwwroot/editor/` содержат редактор CodeMirror и интерфейс ввода и вывода.
- `runner/` содержит исходники компилятора и правила подготовки двух пакетов WebAssembly. Копии готовых пакетов находятся в `wwwroot/runtime/`.
- `wwwroot/projects/` содержит исходники учебных примеров в ZIP, включая решение с MSTest.
- `host/` содержит Windows-приложение на WinForms и WebView2. `server/` содержит общий HTTP-сервер и переносимую команду запуска.
- `android/` содержит оболочку для Android. Она читает тот же учебник из APK и обслуживает учебную консоль на телефоне.

## Сборка

Для полной пересборки нужны .NET SDK 10 и 11, Python 3 и Node.js. На Windows выполни из корня исходников:

```powershell
python runner/build.py
python tools/verify-course-projects.py
python tools/project-tree.py
node tools/verify-course.mjs
python tools/offline.py
dotnet publish host/CSharpBook.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o dist/windows
```

Запускай `dist/windows/CSharpBook.exe` рядом с папкой `wwwroot`. Для Windows требуется установленная среда Microsoft Edge WebView2.

Для самостоятельного запуска в браузере Windows, Linux или macOS выполни `dotnet publish server/CSharpBook.Server.csproj -c Release -o dist/web`, скопируй `wwwroot` в `dist/web` и выполни `dotnet dist/web/CSharpBook.Server.dll`. Флаг `--lan` открывает доступ в локальной сети.

Для подготовки локального Android APK выполни из PowerShell `./android/Build-Apk.ps1`. Скрипт принимает путь к JDK через `-JavaHome` и путь для готового APK через `-OutputApk`. Ключ подписи локальной сборки нужно сохранить между обновлениями. В файле приложения находится только публичный сертификат.

## Выполнение кода

Один запуск получает изолированный worker с отдельным окружением .NET и временной файловой системой. Родительское окно может остановить его. Текст из Console.ReadLine передаётся через общую память, а на браузерах без подходящей изоляции — через временный канал ввода на сервере приложения. Для автономной установки веб-версии нужен HTTPS либо localhost. Service worker сохраняет материалы курса, редактор и обе среды выполнения после полной первой загрузки.

Редактируя содержимое учебника, сохраняй идентификаторы уже опубликованных тем. После изменения архива структуры перегенерируй дерево проекта. После изменения файлов в `wwwroot` обнови манифест офлайн-кэша командой `python tools/offline.py`.


