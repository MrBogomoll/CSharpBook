Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "x64.nsh"

Name "Sharpwise"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Sharpwise"
RequestExecutionLevel user
SetCompressor /SOLID lzma

Icon "../host/book.ico"
UninstallIcon "../host/book.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "Sharpwise"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}.0"
VIAddVersionKey /LANG=1049 "FileDescription" "Установщик Sharpwise"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Sharpwise, MIT"

!define INSTALL_DIR "$LOCALAPPDATA\Programs\Sharpwise"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sharpwise"
!define WEBVIEW_KEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

Var AppMutex
Var RuntimeVersion

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Sharpwise"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchSharpwise
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

!macro Init prefix
Function ${prefix}.onInit
    SetShellVarContext current
    SetRegView 64
    ${IfNot} ${RunningX64}
        MessageBox MB_ICONSTOP|MB_OK "Для Sharpwise требуется Windows x64." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
    ; Use the application's existing mutex so neither copy can start during file replacement.
    System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\CSharpBook.Window.v1") p.s ?e'
    Pop $0
    Pop $AppMutex
    ${If} $AppMutex == 0
    ${OrIf} $0 == 183
        MessageBox MB_ICONSTOP|MB_OK "Закрой Sharpwise и запусти установщик снова." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}
FunctionEnd
!macroend
!insertmacro Init ""
!insertmacro Init "un"

Function ReadWebViewVersion
    ; The machine-wide EdgeUpdate registration is in the 32-bit registry view.
    SetRegView 32
    ReadRegStr $RuntimeVersion HKLM "${WEBVIEW_KEY}" "pv"
    SetRegView 64
    ${If} $RuntimeVersion == ""
    ${OrIf} $RuntimeVersion == "0.0.0.0"
        ReadRegStr $RuntimeVersion HKCU "${WEBVIEW_KEY}" "pv"
    ${EndIf}
FunctionEnd

Section "Sharpwise (обязательно)"
    SectionIn RO
    StrCpy $INSTDIR "${INSTALL_DIR}"
    IfFileExists "$INSTDIR\.sharpwise-install" owned
    IfFileExists "$INSTDIR\*.*" foreignFolder
    owned:

    ; Recover the previous app if setup was interrupted between the two renames.
    IfFileExists "$INSTDIR\app.previous\Sharpwise.exe" 0 checkVersion
    IfFileExists "$INSTDIR\app\Sharpwise.exe" checkVersion
    ClearErrors
    Rename "$INSTDIR\app.previous" "$INSTDIR\app"
    IfErrors failed

    checkVersion:
    IfFileExists "$INSTDIR\app\Sharpwise.exe" 0 checkRuntime
    ${GetFileVersion} "$INSTDIR\app\Sharpwise.exe" $0
    ${VersionCompare} "$0" "${VERSION}.0" $1
    ${If} $1 == 1
        MessageBox MB_ICONSTOP|MB_OK "Уже установлена более новая версия Sharpwise ($0)." /SD IDOK
        SetErrorLevel 1
        Abort
    ${EndIf}

    checkRuntime:
    Call ReadWebViewVersion
    ${If} $RuntimeVersion == ""
    ${OrIf} $RuntimeVersion == "0.0.0.0"
        DetailPrint "Устанавливаю Microsoft Edge WebView2 Runtime…"
        InitPluginsDir
        SetOutPath "$PLUGINSDIR"
        File /oname=MicrosoftEdgeWebview2Setup.exe "${WEBVIEW2_BOOTSTRAPPER}"
        ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
        Call ReadWebViewVersion
        ${If} $RuntimeVersion == ""
        ${OrIf} $RuntimeVersion == "0.0.0.0"
            MessageBox MB_ICONSTOP|MB_OK "Для установки Sharpwise нужен Microsoft Edge WebView2 Runtime. Проверь интернет или установи компонент с сайта Microsoft и повтори установку." /SD IDOK
            SetErrorLevel 1
            Abort
        ${EndIf}
    ${EndIf}

    ClearErrors
    SetOutPath "$INSTDIR"
    FileOpen $0 "$INSTDIR\.sharpwise-install" w
    IfErrors failed
    FileWrite $0 "Sharpwise"
    FileClose $0
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    IfErrors failed

    ; Extract everything before replacing the previous application directory.
    RMDir /r "$INSTDIR\app.new"
    RMDir /r "$INSTDIR\app.previous"
    ClearErrors
    SetOutPath "$INSTDIR\app.new"
    File "${APP_DIR}/Sharpwise.exe"
    File "${APP_DIR}/Начало работы.txt"
    SetOutPath "$INSTDIR\app.new\wwwroot"
    File /r "${APP_DIR}/wwwroot/*"
    SetOutPath "$INSTDIR\app.new\licenses"
    File /r "${APP_DIR}/licenses/*"
    SetOutPath "$INSTDIR"
    IfErrors failed

    IfFileExists "$INSTDIR\app\*.*" 0 activate
    Rename "$INSTDIR\app" "$INSTDIR\app.previous"
    IfErrors failed
    activate:
    Rename "$INSTDIR\app.new" "$INSTDIR\app"
    IfErrors rollback
    RMDir /r "$INSTDIR\app.previous"

    SetOutPath "$INSTDIR\app"
    CreateShortcut "$SMPROGRAMS\Sharpwise.lnk" "$INSTDIR\app\Sharpwise.exe"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Sharpwise"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\Sharpwise.exe"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
    Goto done

    rollback:
    IfFileExists "$INSTDIR\app.previous\Sharpwise.exe" 0 failed
    Rename "$INSTDIR\app.previous" "$INSTDIR\app"

    failed:
    SetOutPath "$INSTDIR"
    RMDir /r "$INSTDIR\app.new"
    MessageBox MB_ICONSTOP|MB_OK "Не удалось установить Sharpwise в $INSTDIR." /SD IDOK
    SetErrorLevel 1
    Abort

    foreignFolder:
    MessageBox MB_ICONSTOP|MB_OK "Папка $INSTDIR занята. Перемести её и запусти установщик снова." /SD IDOK
    SetErrorLevel 1
    Abort

    done:
SectionEnd

Section /o "Ярлык на рабочем столе"
    CreateShortcut "$DESKTOP\Sharpwise.lnk" "$INSTDIR\app\Sharpwise.exe"
SectionEnd

Function LaunchSharpwise
    System::Call 'kernel32::CloseHandle(p $AppMutex)'
    Exec '"$INSTDIR\app\Sharpwise.exe"'
FunctionEnd

Section "Uninstall"
    StrCmp $INSTDIR "${INSTALL_DIR}" 0 invalidInstall
    IfFileExists "$INSTDIR\.sharpwise-install" 0 invalidInstall

    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR\app"
    RMDir /r "$INSTDIR\app.new"
    RMDir /r "$INSTDIR\app.previous"
    IfFileExists "$INSTDIR\app\*.*" invalidInstall
    IfFileExists "$INSTDIR\app.new\*.*" invalidInstall
    IfFileExists "$INSTDIR\app.previous\*.*" invalidInstall
    Delete "$SMPROGRAMS\Sharpwise.lnk"
    Delete "$DESKTOP\Sharpwise.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    Delete "$INSTDIR\.sharpwise-install"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
    Goto uninstalled

    invalidInstall:
    MessageBox MB_ICONSTOP|MB_OK "Не удалось удалить Sharpwise. Закрой приложение и попробуй снова." /SD IDOK
    SetErrorLevel 1
    Abort

    uninstalled:
SectionEnd
