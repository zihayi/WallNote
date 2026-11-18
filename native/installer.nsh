; Assisted installer: offer a welcome page, retain user data, and clean up only
; the optional login entry that points to this installation, never another copy.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WallNote"
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${orIf} $0 == '$INSTDIR\${APP_EXECUTABLE_FILENAME}'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "WallNote"
    ${endIf}
  ${endIf}
!macroend
