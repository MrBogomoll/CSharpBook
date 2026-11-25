# Облачная синхронизация

Каждый пользователь выбирает свой диск в настройках учебника. Общая папка, связанная пара файлов и ручная передача прогресса доступны без OAuth-регистрации. Параметры ниже нужны издателю для сборки с прямым входом в облако.

## Google Диск

1. В Google Cloud включи Google Drive API. В Google Auth Platform укажи сведения о приложении, аудиторию и разрешение `https://www.googleapis.com/auth/drive.appdata`. Для тестовой регистрации добавь тестовые аккаунты.
2. Создай в **одном проекте** два OAuth-клиента. Для Windows выбери тип Desktop app. Для Android выбери тип Android, имя пакета `ru.csharpbook.reader` и SHA-1 сертификата, которым подписан релиз. Для обновления официальной 0.2.0 это `6B:81:1B:96:C8:9B:C9:2C:E2:2F:A5:8D:84:C4:FC:C0:EC:F3:42:33`.
3. В конфигурации Windows укажи идентификатор desktop-клиента и значение desktop client secret, если его выдал Google. В конфигурации Android включи `googleAndroidConfigured` после регистрации пакета. Вход на телефоне выполняют сервисы Google Play. При выпуске для всех пользователей переключи аудиторию приложения из тестовой в рабочую.

[Папка приложения в Google Drive](https://developers.google.com/workspace/drive/api/guides/appdata) · [OAuth для настольных приложений](https://developers.google.com/identity/protocols/oauth2/native-app)

## Яндекс Диск

В кабинете Яндекс OAuth создай приложение типа **«Для авторизации пользователей»**. В разделе «Веб-сервисы» добавь оба адреса возврата. В доступах укажи «Доступ к папке приложения на Диске», `cloud_api:disk.app_folder`. Один ClientID используется на обеих платформах. Учебник использует PKCE.

| Платформа | Redirect URI |
| --- | --- |
| Windows | `http://127.0.0.1:53823/callback` |
| Android | `ru.csharpbook.reader://oauth/yandex` |

[Регистрация приложения с адресами возврата](https://yandex.ru/dev/id/doc/ru/register-auth) · [Обмен кода с PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url)

## Параметры сборки

Для Windows сохрани настройки издателя в отдельном JSON-файле за пределами репозитория.

```json
{
  "googleDesktopClientId": "",
  "googleDesktopClientSecret": "",
  "yandexClientId": ""
}
```

При публикации Windows-приложения передай полный путь через `-p:CloudSyncConfig="C:\build\windows\cloud-sync.json"`. Для локальной проверки настройки также читаются из `%LOCALAPPDATA%\CSharpBook\cloud-sync.json` текущего пользователя Windows.

Для Android скопируй `android/cloud-sync.example.json` в `android/cloud-sync.json` и укажи `googleAndroidConfigured` и `yandexClientId`. Windows-конфигурация и Android-конфигурация различаются. Собери APK скриптом `android/Build-Apk.ps1` с исходным рабочим каталогом подписи для обновления поверх прежней версии. Токены пользователь получает на своём устройстве при подключении диска.

## Проверка перед выпуском

Подключи один и тот же аккаунт на Windows и Android. Создай заметку на телефоне, дождись статуса синхронизации и проверь её на ПК. Измени один черновик на двух отключённых от сети устройствах, подключи их по очереди и выбери нужную версию в настройках. Повтори проверку со вторым сервисом. В режиме общей папки дождись также завершения передачи файлов облачным клиентом.
