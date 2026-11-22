; Windows: "Mit Gitline öffnen" im Kontextmenü von Ordnern (auf dem Ordner und im leeren Bereich darin).
; Standard-Apps fasst Gitline nie an.
; SHCTX = HKCU bei "Nur für mich" (Standard), HKLM nur bei "Für alle Benutzer".

!define GITLINE_VERB "shell\Gitline"

!macro gitlineAddVerb KEY ARG
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}" "" "$1"
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}"'
!macroend

; Desktop-Symbol: createDesktopShortcut ist aus, Gitline legt es selbst an - nur bei der Erst-Installation.
; Ein Update (über die App oder ein von Hand gestartetes Setup) fasst es nie an: es bleibt an seinem Platz,
; und wer es gelöscht hat, bekommt es nicht zurück. Entfernt wird es nur beim echten Deinstallieren.
; customInit läuft, bevor die alte Version entfernt wird: merken, ob Gitline schon installiert war und ob es das
; Symbol gab (der Deinstaller von 1.0.0 löscht es beim Update selbst - dann einmal neu anlegen).
!macro customInit
  Var /GLOBAL gitlineWasInstalled
  Var /GLOBAL gitlineDesktopLinkBefore
  Push $R0
  StrCpy $gitlineWasInstalled "0"
  StrCpy $gitlineDesktopLinkBefore ""
  ${If} ${isUpdated}
    StrCpy $gitlineWasInstalled "1"
  ${EndIf}
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
    StrCpy $gitlineWasInstalled "1"
  ${EndIf}
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R0 != ""
    StrCpy $gitlineWasInstalled "1"
  ${EndIf}
  SetShellVarContext all
  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $gitlineDesktopLinkBefore "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}
  SetShellVarContext current
  ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $gitlineDesktopLinkBefore "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  Pop $R0
!macroend

!macro gitlineDesktopLink LINK
  CreateShortCut "${LINK}" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  ; gleiche AppUserModelID wie das Fenster (app.setAppUserModelId), sonst zwei Symbole in der Taskleiste
  WinShell::SetLnkAUMI "${LINK}" "${APP_ID}"
!macroend

!macro customInstall
  Push $1
  StrCpy $1 "Open with Gitline"
  ${If} $LANGUAGE == 1031
    StrCpy $1 "Mit Gitline öffnen"
  ${EndIf}
  !insertmacro gitlineAddVerb "Directory" "%1"
  !insertmacro gitlineAddVerb "Directory\Background" "%V"
  Pop $1
  ${If} $gitlineWasInstalled == "0"
    !insertmacro gitlineDesktopLink "$newDesktopLink"
  ${ElseIf} $gitlineDesktopLinkBefore != ""
  ${AndIfNot} ${FileExists} "$gitlineDesktopLinkBefore"
    !insertmacro gitlineDesktopLink "$gitlineDesktopLinkBefore"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Directory\${GITLINE_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\${GITLINE_VERB}"
  ${ifNot} ${isUpdated}
    ; Desktop-Symbol nur beim echten Deinstallieren entfernen, nie beim Update
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${endIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
