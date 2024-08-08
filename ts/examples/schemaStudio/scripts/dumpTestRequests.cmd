:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off
@rem dump all current dispatcher test requests

setlocal

set dataPath=..\..\..\packages\dispatcher\test\data\player
pushd %dataPath%

@rem Loop through each file in the folder  
for %%f in (*) do (
    call agent-cli data list "%%~ff"  
)

popd

endlocal
 