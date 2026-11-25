# Android-приложение «Sharpwise»

Папка содержит Android-оболочку для того же учебника из соседнего `wwwroot`. В APK входят уроки, архивы проектов, редактор и обе среды выполнения. Приложение открывает содержимое во встроенном Android System WebView. Для сетевых сокетов локального сервера используется разрешение INTERNET. Сервер слушает только 127.0.0.1. Внешние ссылки открывает выбранный на телефоне браузер, а проекты ZIP сохраняются через системный выбор файла.

Для запуска примеров C# 15 на .NET 11 нужен Android System WebView версии 137 или новее. Версию компонента можно открыть в настройках приложений Android.

## Сборка на Windows

Нужны PowerShell, JDK 17–25, Python 3 и команды curl.exe и tar.exe. Из корня исходного проекта выполни:

```powershell
pwsh -File ./android/Build-Apk.ps1 -WebRoot ./wwwroot -WorkDir ./build-android
```

Путь к JDK можно передать через `-JavaHome`, к итоговому APK — через `-OutputApk`. Первая сборка скачивает Gradle 9.1.0 и Android SDK 36. Gradle получает NanoHTTPD, Google Play services Auth и их зависимости из Google Maven и Maven Central. В последующих сборках используются локальные копии. Перед созданием пакета подготовь итоговые `course.json`, `sw.js` и каталоги `runtime` и `projects` в `wwwroot`.

Для сборки с настроенным облаком скопируй `cloud-sync.example.json` в `android/cloud-sync.json` или передай путь параметром `-CloudConfig`. В файл входят флаг настройки Google для текущих имени пакета и сертификата и публичный идентификатор клиента Яндекса. Без регистрации клиентов оба провайдера по умолчанию выключены. Файл с настройками попадает в `assets/cloud-sync.json` в APK.

Вызов `./android/Build-Apk.ps1 -Preview` (задача Gradle `assemblePreview`) собирает отдельное приложение «Sharpwise · Тест» (`ru.csharpbook.reader.preview`) с тестовой подписью. У него собственный прогресс и ручное обновление APK. По умолчанию для тестовой сборки используется пустой `cloud-sync.example.json`, в том числе при наличии `android/cloud-sync.json`. Чтобы включить прямой вход, зарегистрируй тестовый пакет и его сертификат в Google и адрес возврата `ru.csharpbook.reader.preview://oauth/yandex` в Яндексе. Передай конфигурацию, подготовленную для этой сборки:

```powershell
./android/Build-Apk.ps1 -Preview -CloudConfig C:\build\preview\cloud-sync.json
```

При вызове Gradle напрямую укажи `-PpreviewCloudConfig=<путь>` для `assemblePreview` или `-PcloudConfig=<путь>` для `assembleRelease`. Для повторных обновлений тестовой сборки сохрани её исходный `debug.keystore`: регистрация Google Android привязана к паре «имя пакета и SHA-1 сертификата».

[Регистрация приложений Google и Яндекс](../docs/cloud-sync.md)

Версия 0.3.2 использует versionCode 8. В версии 0.3.1 использовался versionCode 7. Версия 0.3.0 использовала versionCode 6. Стабильная версия 0.2.0 использовала versionCode 5. Первый стабильный выпуск 0.1.0 использовал versionCode 2. Для установки обновления поверх прежней версии нужен больший versionCode и тот же ключ подписи. Скрипт сверяет содержимое APK с исходниками и проверяет подпись и выравнивание файла.
