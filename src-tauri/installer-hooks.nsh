; "Open in Terax" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

  !macro REGISTER_SHELL_VERB CLASS PARAM
    WriteRegStr HKCU "Software\Classes\${CLASS}\shell\OpenInTerax" "" "Open in Terax"
    WriteRegStr HKCU "Software\Classes\${CLASS}\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
    WriteRegStr HKCU "Software\Classes\${CLASS}\shell\OpenInTerax" "NoWorkingDirectory" ""
    WriteRegStr HKCU "Software\Classes\${CLASS}\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "${PARAM}"'
  !macroend

  !macro UNREGISTER_SHELL_VERB CLASS
    DeleteRegKey HKCU "Software\Classes\${CLASS}\shell\OpenInTerax"
  !macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro REGISTER_SHELL_VERB "Directory" "%V"
  !insertmacro REGISTER_SHELL_VERB "Directory\Background" "%V"
  !insertmacro REGISTER_SHELL_VERB "Drive" "%V"
  !insertmacro REGISTER_SHELL_VERB "*" "%1"

  ; Register Terax as a known application for the "Open with..." menu
  WriteRegStr HKCU "Software\Classes\Applications\terax.exe" "" "Terax"
  WriteRegStr HKCU "Software\Classes\Applications\terax.exe" "FriendlyAppName" "Terax"
  WriteRegStr HKCU "Software\Classes\Applications\terax.exe\shell\open" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Applications\terax.exe\shell\open\command" "" '"$INSTDIR\terax.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro UNREGISTER_SHELL_VERB "Directory"
  !insertmacro UNREGISTER_SHELL_VERB "Directory\Background"
  !insertmacro UNREGISTER_SHELL_VERB "Drive"
  !insertmacro UNREGISTER_SHELL_VERB "*"
  DeleteRegKey HKCU "Software\Classes\Applications\terax.exe"
!macroend
