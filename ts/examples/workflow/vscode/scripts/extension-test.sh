#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# extension-test.sh — Run @vscode/test-electron extension integration tests.
#
# Prerequisites (NOT available in the restricted dev container):
#   - A display server: Xvfb on Linux, or a macOS/Windows desktop session.
#   - Internet access to download the VS Code binary on first run.
#
# Usage:
#   ./scripts/extension-test.sh
#
# On Linux CI (GitHub Actions), prepend:
#   Xvfb :99 &
#   export DISPLAY=:99
#
# The test runner and Mocha suite live under src/test/:
#   - src/test/runTests.ts             — downloads VS Code, launches host
#   - src/test/suite/index.ts          — Mocha bootstrap
#   - src/test/suite/extension.test.ts — smoke tests
#
# See ts/docs/design/workflowSystem/editor/lsp-decisions.md for context.

set -euo pipefail

if [[ -z "${DISPLAY:-}" && "$(uname)" == "Linux" ]]; then
    echo "⚠️  No DISPLAY set; @vscode/test-electron requires Xvfb on Linux." >&2
    echo "   Run:  Xvfb :99 & export DISPLAY=:99   then re-run this script." >&2
    exit 1
fi

exec npm run test:e2e

