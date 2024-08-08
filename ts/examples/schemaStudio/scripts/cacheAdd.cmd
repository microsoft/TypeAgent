:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

setlocal

set outputFileName=%~n1.json

set outputFile="..\..\..\packages\dispatcher\test\data\player\%outputFileName%"

if NOT exist %outputFile% set outputFile="%~dp1\processed\%outputFileName%"

agent-cli data add --translator player --concurrency 4 --input "%1" --output %outputFile%

endlocal