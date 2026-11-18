@echo off
setlocal
title PreguntasResponderAi - Actualizar extension
cd /d "%~dp0"

set "REPO=https://github.com/ahlanbrito/AiResponses-front"
set "EXTID=jkopcmaiobkfckfhmegpegjpomlocpdm"

echo ==================================================
echo    Actualizando PreguntasResponderAi
echo ==================================================
echo.

where git >nul 2>nul
if errorlevel 1 goto sin_git

if not exist ".git" goto sin_clon

echo [1/2] Descargando cambios (git pull)...
echo.
git pull
if errorlevel 1 goto error_pull

echo.
echo [2/2] Abriendo la pagina de extensiones de Chrome...
start "" chrome.exe "chrome://extensions/?id=%EXTID%"
if errorlevel 1 start "" chrome "chrome://extensions/?id=%EXTID%"

echo.
echo --------------------------------------------------
echo  LISTO
echo --------------------------------------------------
echo  1. En la pagina que se abrio, pulsa el boton
echo     de recargar (flecha circular) en la tarjeta
echo     de PreguntasResponderAi.
echo  2. O simplemente abre el popup de la extension:
echo     se actualiza solo si detecta archivos nuevos.
echo --------------------------------------------------
echo.
pause
exit /b 0

:error_pull
echo.
echo ERROR: no se pudieron descargar los cambios.
echo Revisa tu conexion a internet e intenta de nuevo.
echo.
echo Si el problema sigue, descarga el ZIP desde:
echo %REPO%
echo.
pause
exit /b 1

:sin_clon
echo Esta carpeta no es un clon de git.
echo Abriendo el repositorio para descargar la ultima version...
start "" "%REPO%"
echo.
pause
exit /b 0

:sin_git
echo No se encontro Git instalado en este equipo.
echo Abriendo el repositorio para descargar el ZIP...
start "" "%REPO%"
echo.
echo Descarga el ZIP, descomprimelo y reemplaza los archivos.
echo.
pause
exit /b 0
