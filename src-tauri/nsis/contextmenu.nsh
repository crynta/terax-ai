Section "Add Open in Terax to folder context menu" SecOpenInTerax
  IfFileExists "$INSTDIR\terax.exe" 0 +3
    StrCpy $0 "$INSTDIR\terax.exe"
    Goto +2
    StrCpy $0 "$INSTDIR\Terax.exe"

  WriteRegStr HKCU "Software\Classes\Directory\shell\Terax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Terax" "Icon" "$0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Terax\command" "" '"$0" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Terax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Terax" "Icon" "$0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Terax\command" "" '"$0" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\Terax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Terax" "Icon" "$0"
  WriteRegStr HKCU "Software\Classes\Drive\shell\Terax\command" "" '"$0" "%1"'
SectionEnd

!macro NSIS_HOOK_POST_UNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Terax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Terax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\Terax"
!macroend
