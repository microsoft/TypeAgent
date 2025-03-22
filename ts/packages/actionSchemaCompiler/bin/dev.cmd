:: Copyright (c) Microsoft Corporation.
:: Licensed under the MIT License.

@echo off

node --loader ts-node/esm --no-warnings=ExperimentalWarning "%~dp0\dev" %*
