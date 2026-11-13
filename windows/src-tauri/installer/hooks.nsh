; FaLe PDF – Setup-Programm: eigene Texte auf der ersten und der letzten Seite.
;
; Tauri bindet diese Datei oben in sein installer.nsi ein (tauri.conf.json → bundle.windows.nsis.installerHooks),
; also VOR den Seiten. Was hier definiert ist, übernimmt Modern UI 2 für die Willkommens- und die Fertig-Seite.
; Die Texte selbst stehen in German.nsh / English.nsh (customLanguageFiles) – eine Sprache je Datei.
;
; Bewusst NICHT im Setup: Fremdwerbung, mitinstallierte Programme, Browser-Leisten. Die letzte Seite zeigt nur
; einen eigenen Hinweis (Handy-App, freiwillig unterstützen) als Link – wer nicht klickt, bekommt nichts davon.
; Die stille Installation (/S) zeigt keine dieser Seiten.

!define MUI_WELCOMEPAGE_TITLE "$(faleWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(faleWelcomeText)"

!define MUI_FINISHPAGE_TITLE "$(faleFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(faleFinishText)"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN_TEXT "$(faleFinishRun)"
!define MUI_FINISHPAGE_LINK "$(faleFinishLink)"
!define MUI_FINISHPAGE_LINK_LOCATION "$(faleFinishUrl)"
!define MUI_FINISHPAGE_LINK_COLOR "3448C5"
