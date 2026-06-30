// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helpers for VS Code webview hosts. Kept free of `vscode`/DOM so they
 * can be reused by any extension surface and unit-tested in isolation.
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a per-load nonce (base64) for a webview's Content-Security-Policy
 * `script-src`/`style-src`. Uses a cryptographically strong random source so
 * the nonce cannot be predicted by injected content; the value is unique per
 * call and is meant to be regenerated on every webview render.
 */
export function createWebviewNonce(): string {
    return randomBytes(16).toString("base64");
}
