@echo off
setlocal

IF "%1" == "" (
    call :Error No storage account specified.
    exit /B 1
)

set STORAGE=%1
IF "%2" == "" (
    set CONTAINER=%1
) ELSE (
    set CONTAINER=%2
)

IF "%3" == "" (
    set CHANNEL=lkg
) ELSE (
    set CHANNEL=%3
)

set DEST=%TEMP%\install-shell
mkdir %DEST% > nul 2>&1
IF ERRORLEVEL 1 (
    call :Error Failed to create %DEST% directory.
    exit /B 1
)
del /Q /S %DEST%\* > nul 2>&1
IF ERRORLEVEL 1 (
    call :Error Failed to delete files in %DEST% directory.
    exit /B 1
)

call :Info Getting TypeAgent Shell from [30m[96m%CHANNEL%[0m channel in [30m[93m%STORAGE%/%CONTAINER%[0m.
call :DownloadYml %PACKAGE%
IF ERRORLEVEL 1 (    
    call :Cleanup
    exit /B 1
)

FOR /F "tokens=1-2 delims=:" %%i IN (%DEST%\%CHANNEL%.yml) DO (
    IF "%%i" == "path" (      
      set PACKAGE=%%j      
    )
)

IF "%PACKAGE%" == "" (
    call :Error Failed to find path in %CHANNEL%.yml.  Ensure that the file is valid.
    call :Cleanup
    exit /B 1
)

call :DownloadPackage %PACKAGE%
IF ERRORLEVEL 1 (    
    call :Cleanup
    exit /B 1
)

call :Install %PACKAGE%
IF ERRORLEVEL 1 (
    call :Cleanup    
    exit /B 1
)

call :Cleanup
exit /B 0

:DownloadYml
call :Info Downloading %CHANNEL%.yml
call az storage blob download --account-name %STORAGE% --container-name %CONTAINER% --name %CHANNEL%.yml --file %DEST%\%CHANNEL%.yml --overwrite --auth-mode login > %DEST%\install-shell.log 2>&1
IF ERRORLEVEL 1 (
    call :Error Failed to download %CHANNEL%.yml from %STORAGE%/%CONTAINER%.
    call :Error Ensure you that you are logged into azure cli with 'az login' and have access to the storage account.
    call :Error See %DEST%\install-shell.log for more details.
    exit /B 1
)
exit /B 0

:DownloadPackage
call :Info Downloading %1
call az storage blob download --account-name %STORAGE% --container-name %CONTAINER% --name %1 --file %DEST%\%1 --overwrite --auth-mode login > %DEST%\install-shell.log 2>&1
IF ERRORLEVEL 1 (
    call :Error Failed to download %1 from %STORAGE%/%CONTAINER%.
    call :Error See %DEST%\install-shell.log for more details.
    exit /B 1
)
exit /B 0

:Install
call :Info Running %1
%DEST%\%1 > %DEST%\install-shell.log 2>&1
IF ERRORLEVEL 1 (
    call :Error Failed to install %1
    call :Error See %DEST%\install-shell.log for more details.    
    exit /B 1
)

call :Success %1 installed successfully.
call :Success TypeAgent Shell will start automatically.
exit /B 0

:Usage
echo Usage: %0 ^<storage^> [^<container^>] [^<channel^>]
echo   ^<storage^>   - The name of the storage account to use.
echo   ^<container^> - The name of the container to use. ^<storage^> will be used if not specified.
echo   ^<channel^>   - The channel to use. Default to 'lkg' if not specified.
exit /B 0

:Info
echo [30m[90mINFO: %*[0m
exit /B 0

:Success
echo [30m[92mSUCCESS: %*[0m
exit /B 0

:Error
echo [30m[91mERROR: %*[0m
exit /B 0

:Cleanup
del /Q /S %DEST%\* > nul 2>&1
rmdir /S /Q %DEST% > nul 2>&1
exit /B 0