; Included by electron-builder's NSIS script (electron-builder.yml, nsis.include).

!macro customUnInstall
  ; Electron's setLoginItemSettings names the value "electron.app.<productName>".
  ; On an update the old version is uninstalled first; the entry is left for
  ; the new one, which sets it again from the user's setting when it starts.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Vocette"
  ${endIf}
!macroend
