@echo off
setlocal  

set outDir = \data\testChat\nyc
del /Q /S %outDir%
set reportDir=%outDir%\coverage
set tempDir=%outDir%\tempDir
set dataDir=%outDir%\data
set testFilePath=%~dp0\testAll.txt

if not exist %dataDir% (
  md %dataDir%
)
xcopy /y %~dp0\Episode_53_AdrianTchaikovsky.txt %dataDir%\

call %~dp0\..\node_modules\.bin\c8 -c %~dp0\..\.nycrc --report-dir %reportDir% --temp-dir %tempDir% node %~dp0\..\dist\main.js memory batch --filePath %testFilePath% 

goto :Done  

:Done  
endlocal  
exit /b %ERROR_LEVEL%  
