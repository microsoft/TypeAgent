// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Webview entry point for the Grammar Debug Panel.
 * This file is bundled by Vite into webview-dist/debugPanel.js.
 */

import "grammar-tools-ui";
import {
    WebviewBackend,
    hydrateLoadResult,
    type SerializedLoadResult,
} from "./webviewBackend.js";
import type { GtDebugPanel } from "grammar-tools-ui";

const backend = new WebviewBackend();

// Wait for the component to be defined, then wire up the backend
customElements.whenDefined("gt-debug-panel").then(() => {
    const panel = document.getElementById("panel") as GtDebugPanel;
    if (panel) {
        panel.backend = backend;
        panel.showPicker = false;

        // Auto-load from the active editor when the panel initializes
        backend.loadGrammarFromActiveEditor().then((result) => {
            if (result.ok) {
                panel.grammar = result.grammar;
            }
        });

        // Listen for grammar pushes from the extension host (e.g. when
        // the user clicks the debug button on a specific .agr file).
        window.addEventListener("message", (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.type === "grammarLoaded" && msg.result?.ok) {
                const result = hydrateLoadResult(
                    msg.result as SerializedLoadResult,
                );
                if (result.ok) {
                    panel.grammar = result.grammar;
                }
            }
        });
    }
});
