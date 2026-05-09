// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Webview entry point for the Grammar Debug Panel.
 * This file is bundled by Vite into webview-dist/debugPanel.js.
 */

import "grammar-tools-ui";
import { WebviewBackend } from "./webviewBackend.js";
import type { GtDebugPanel } from "grammar-tools-ui";

const backend = new WebviewBackend();

// Wait for the component to be defined, then wire up the backend
customElements.whenDefined("gt-debug-panel").then(() => {
    const panel = document.getElementById("panel") as GtDebugPanel;
    if (panel) {
        panel.backend = backend;

        // Auto-load from the active editor when the panel initializes
        backend.loadGrammarFromActiveEditor().then((result) => {
            if (result.ok) {
                panel.grammar = result.grammar;
            }
        });
    }
});
