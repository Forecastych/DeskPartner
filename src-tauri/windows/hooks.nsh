; Хуки установщика DeskPartner (bundle.windows.nsis.installerHooks в tauri.conf.json).
; Tauri подключает этот файл в начало installer.nsi, до своих страниц.
;
; До 1.0.0 в tauri.conf.json не было publisher, и Tauri брал его из identifier: версии 0.0.x
; записали папку установки в HKCU\Software\github\DeskPartner. С 1.0.0 publisher другой, и
; установщик ищет папку в HKCU\Software\Forecastych\DeskPartner. Не найдя её, он запускал старый
; uninstall.exe с пустым `_?=`, и тот падал с «Error launching installer».
; Поэтому до первой страницы переносим старую запись на новое место. Сам старый uninstall.exe
; её не удаляет (только с галочкой «удалить данные»), так что удаляем её здесь.

!define MUI_CUSTOMFUNCTION_GUIINIT DeskPartnerMoveOldKey

Function DeskPartnerMoveOldKey
  Push $0
  ReadRegStr $0 HKCU "Software\github\DeskPartner" ""
  ${If} $0 != ""
    Push $1
    ReadRegStr $1 HKCU "Software\Forecastych\DeskPartner" ""
    ${If} $1 == ""
      WriteRegStr HKCU "Software\Forecastych\DeskPartner" "" $0
      StrCpy $INSTDIR $0
    ${EndIf}
    Pop $1
    ; старому uninstall.exe ключ не нужен: установщик передаёт ему папку через `_?=`
    DeleteRegKey HKCU "Software\github\DeskPartner"
    DeleteRegKey /ifempty HKCU "Software\github"
  ${EndIf}
  Pop $0
FunctionEnd
