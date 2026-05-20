#!/usr/bin/env bash
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
# This script is a documented stub.  The actual test suite lives in
# src/test/extension.test.ts (not yet written — see lsp-decisions.md for
# the @vscode/test-electron deferral rationale).
#
# When you are ready to write the tests:
#   1. npm install --save-dev @vscode/test-electron
#   2. Create src/test/runTests.ts  (uses runTests from @vscode/test-electron)
#   3. Create src/test/extension.test.ts  (uses @vscode/test-electron helpers)
#   4. Add a "test:e2e" script to package.json: "node ./dist/test/runTests.js"
#   5. Replace this stub with: node ./dist/test/runTests.js

set -euo pipefail

echo "❌  @vscode/test-electron E2E tests are not yet implemented."
echo "   See ts/docs/design/workflowSystem/editor/lsp-decisions.md"
echo "   and ts/examples/workflow/vscode/scripts/extension-test.sh for details."
exit 1
