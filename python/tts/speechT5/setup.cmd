:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off

setlocal
set RECREATE=0

if "%1" == "--help" (
    echo Usage: setup [^<directory^>] [--recreate]
    echo Options:
    echo   ^<directory^>: The directory where the virtual environment will be created. Default is ./.venv
    echo   --recreate: If specified, the virtual environment will be recreated if it already exists.
    exit /b -1
)

IF "%1" == "--recreate" (
    set RECREATE=1
    shift /1
)

IF "%1" == "" (
    set DIR=%~dp0\.venv
) else (
    set DIR=%1\py\whisperService    

    IF "%2" == "--recreate" (
        set RECREATE=1        
    )
)

IF "%RECREATE%" == "1" (
    IF EXIST "%DIR%" (
        rmdir /s /q %DIR%
    )
)


IF NOT EXIST "%DIR%\Scripts\activate" (
    py -m venv %DIR%
    call %DIR%\Scripts\activate.bat
    pip config --site set global.extra-index-url https://download.pytorch.org/whl/cu121
    pip install -r requirements.txt
)

endlocal && %DIR%\Scripts\activate.bat
