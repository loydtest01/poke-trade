@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Synchronizace s GitHubem

rem ================================================================
rem  Synchronizace s GitHubem jednim klikem
rem  1) ulozi zmeny z tohoto PC  2) stahne zmeny z GitHubu
rem  3) odesle vse na GitHub (Vercel pak sam nasadi web)
rem ================================================================

rem --- Najdi Git: nejdriv nainstalovany, jinak ten z GitHub Desktop ---
set "GIT="
where git >nul 2>nul && set "GIT=git"
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
  )
)
if not defined GIT (
  echo.
  echo  Git nenalezen. Nainstaluj Git for Windows z https://git-scm.com
  goto konec_chyba
)

"%GIT%" rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Tento skript musi lezet ve slozce naklonovaneho repozitare.
  goto konec_chyba
)

echo.
echo  [1/3] Ukladam zmeny z tohoto pocitace...
"%GIT%" add -A
"%GIT%" diff --cached --quiet
if errorlevel 1 (
  "%GIT%" commit -q -m "Zmeny z %COMPUTERNAME% %date% %time:~0,5%"
  if errorlevel 1 goto chyba
  echo        ulozeno.
) else (
  echo        zadne nove zmeny.
)

echo  [2/3] Stahuji zmeny z GitHubu...
"%GIT%" pull --rebase -q
if errorlevel 1 (
  "%GIT%" rebase --abort >nul 2>nul
  echo.
  echo  !!! KONFLIKT: stejny soubor se zmenil tady i na GitHubu.
  echo      Nic se nepokazilo, tvoje zmeny zustaly ulozene.
  echo      Otevri GitHub Desktop a konflikt vyres tam.
  goto konec_chyba
)
echo        hotovo.

echo  [3/3] Odesilam na GitHub...
"%GIT%" push -q
if errorlevel 1 goto chyba
echo        hotovo.

echo.
echo  ==== VSE SYNCHRONIZOVANO ====
echo  Posledni zmeny:
"%GIT%" log -3 --format="    %%h  %%s"
echo.
pause
exit /b 0

:chyba
echo.
echo  !!! Neco se nepovedlo - hlaska je vypsana vyse.
:konec_chyba
echo.
pause
exit /b 1
