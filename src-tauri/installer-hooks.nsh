; Windows shell integration: adds "Open in Terax" to the right-click menu
; for folders, folder backgrounds, and drives. Writes per-user (HKCU) to
; match the installer's currentUser scope — no admin elevation needed.
; %V resolves to the clicked path (or the current folder for Background).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax" "" "Open in Terax"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax" "Icon" '"$INSTDIR\terax.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerax\command" "" '"$INSTDIR\terax.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerax"
!macroend
