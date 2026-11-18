!include "${__FILEDIR__}\hooks.nsh"

!macro NSIS_HOOK_POSTINSTALL
  ; Приглашение не зависит от того, запустят ли приложение с последней страницы.
  ; Приложение обработает его при следующем запуске в этом профиле Windows.
  ${If} $UpdateMode != 1
    Push $0
    ClearErrors
    CreateDirectory "$APPDATA\DeskPartner"
    FileOpen $0 "$APPDATA\DeskPartner\iris-gift-invite" w
    ${IfNot} ${Errors}
      FileClose $0
    ${EndIf}
    Pop $0
  ${EndIf}
!macroend
