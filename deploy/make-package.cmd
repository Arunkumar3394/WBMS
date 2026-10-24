@echo off
rem Builds the WBMS website package in publish\site (copy it to IIS) and publish\wbms-site.zip (for Azure).
rem Needs Node.js and the .NET SDK (both come with a normal Visual Studio + Node install). Run from any folder.
setlocal
cd /d "%~dp0.."

echo === Building the Angular site ===
pushd src\wbms-web
call npm ci || goto :failed
call npm run build || goto :failed
popd

echo === Building the API package ===
dotnet msbuild -restore src\Wbms.Api47 -t:PublishSite -p:Configuration=Release -v:minimal || goto :failed

if exist publish\wbms-site.zip del publish\wbms-site.zip
powershell -NoProfile -Command "Compress-Archive -Path 'publish\site\*' -DestinationPath 'publish\wbms-site.zip'" || goto :failed

echo.
echo Done. Folder: %cd%\publish\site   Zip: %cd%\publish\wbms-site.zip
echo Next: follow deploy\DEPLOY.md
exit /b 0

:failed
echo.
echo Build failed - see the messages above.
exit /b 1
