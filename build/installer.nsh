; Windows: "Mit Gitline öffnen" im Kontextmenü von Ordnern (auf dem Ordner und im leeren Bereich darin).
; Standard-Apps fasst Gitline nie an.
; SHCTX = HKCU bei "Nur für mich" (Standard), HKLM nur bei "Für alle Benutzer".

!define GITLINE_VERB "shell\Gitline"

!macro gitlineAddVerb KEY ARG
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}" "" "$1"
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\${KEY}\${GITLINE_VERB}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}"'
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
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Directory\${GITLINE_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\${GITLINE_VERB}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
