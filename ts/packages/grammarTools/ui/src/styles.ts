// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { css } from "lit";

/** Base styles shared across all gt-* components. */
export const baseStyles = css`
    :host {
        display: block;
        font-family: var(
            --gt-font-family,
            var(--vscode-font-family, sans-serif)
        );
        font-size: var(--gt-font-size, var(--vscode-font-size, 13px));
        color: var(--gt-foreground, var(--vscode-foreground, #cccccc));
        background: var(
            --gt-background,
            var(--vscode-editor-background, #1e1e1e)
        );
    }

    .mono {
        font-family: var(
            --gt-mono-font-family,
            var(
                --vscode-editor-font-family,
                "Cascadia Code",
                Consolas,
                monospace
            )
        );
    }

    input[type="text"],
    textarea {
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, #3c3c3c);
        padding: 4px 8px;
        font-size: inherit;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
    }

    input[type="text"]:focus,
    textarea:focus {
        border-color: var(--vscode-focusBorder, #007fd4);
    }

    button {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        padding: 4px 12px;
        cursor: pointer;
        font-size: inherit;
        font-family: inherit;
    }

    button:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    button.secondary {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #cccccc);
    }

    .error-text {
        color: var(--vscode-errorForeground, #f48771);
    }

    .warning-text {
        color: var(--vscode-editorWarning-foreground, #cca700);
    }

    .info-text {
        color: var(--vscode-editorInfo-foreground, #3794ff);
    }

    .muted {
        color: var(--vscode-descriptionForeground, #9d9d9d);
    }

    a {
        color: var(--vscode-textLink-foreground, #3794ff);
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

    .empty-state {
        padding: 24px 16px;
        text-align: center;
        color: var(--vscode-descriptionForeground, #9d9d9d);
    }
`;
