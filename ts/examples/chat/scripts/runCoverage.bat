@echo off
setlocal  
set reportDir=/data/testChat/nyc/coverage
set tempDir=/data/testChat/nyc/tempDir
set dataDir=\data\testChat\nyc\data
set testFilePath=testAll.txt

echo %cd%  

if not exist %dataDir% (
  md %dataDir%
)
xcopy /y Episode_53_AdrianTchaikovsky.txt %dataDir%\

call ..\node_modules\.bin\nyc --report-dir %reportDir% --temp-dir %tempDir% node ../dist/main.js memory batch --filePath %testFilePath% 

goto :Done  

:Done  
endlocal  
exit /b %ERROR_LEVEL%  
