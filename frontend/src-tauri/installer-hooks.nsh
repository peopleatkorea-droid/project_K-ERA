!macro NSIS_HOOK_PREINSTALL
  IfSilent +2 0
  MessageBox MB_OK|MB_ICONINFORMATION "K-ERA Desktop CPU build needs about 2.3 GB of total disk space after first launch.$\r$\n$\r$\nInstalled app: about 1.0 GB$\r$\nFirst-launch runtime extraction: about 1.3 GB under %LOCALAPPDATA%\KERA\runtime$\r$\n$\r$\nK-ERA Desktop CPU 배포본은 첫 실행 후 총 약 2.3 GB의 디스크 공간이 필요합니다.$\r$\n설치 직후 앱 자체는 약 1.0 GB이며, 첫 실행 때 %LOCALAPPDATA%\KERA\runtime 아래로 약 1.3 GB가 추가로 풀립니다."
!macroend
