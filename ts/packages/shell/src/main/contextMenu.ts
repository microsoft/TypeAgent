// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    clipboard,
    Menu,
    MenuItemConstructorOptions,
    WebContents,
} from "electron";

/**
 * Attach a native right-click context menu to a WebContents that
 * exposes the standard edit commands (Cut / Copy / Paste / Select All)
 * where appropriate. Items are enabled or hidden based on Electron's
 * `editFlags` for the click target, so cut/paste only appear in
 * editable elements and copy is gated on having a non-empty selection.
 *
 * Used by the shell to give the chat input and inline browser views
 * the same affordances users expect from any native text surface.
 */
export function attachEditContextMenu(webContents: WebContents): void {
    webContents.on("context-menu", (_event, params) => {
        const {
            isEditable,
            selectionText,
            editFlags,
            linkURL,
            mediaType,
            srcURL,
        } = params;

        const hasSelection =
            typeof selectionText === "string" && selectionText.length > 0;

        const template: MenuItemConstructorOptions[] = [];

        if (isEditable) {
            template.push(
                {
                    label: "Cut",
                    role: "cut",
                    enabled: editFlags.canCut && hasSelection,
                },
                {
                    label: "Copy",
                    role: "copy",
                    enabled: editFlags.canCopy && hasSelection,
                },
                {
                    label: "Paste",
                    role: "paste",
                    enabled: editFlags.canPaste,
                },
                { type: "separator" },
                {
                    label: "Select All",
                    role: "selectAll",
                    enabled: editFlags.canSelectAll,
                },
            );
        } else if (hasSelection) {
            template.push({
                label: "Copy",
                role: "copy",
                enabled: editFlags.canCopy,
            });
        }

        if (linkURL) {
            if (template.length > 0) template.push({ type: "separator" });
            template.push({
                label: "Copy Link Address",
                click: () => clipboard.writeText(linkURL),
            });
        }

        if (mediaType === "image" && srcURL) {
            if (template.length > 0) template.push({ type: "separator" });
            template.push({
                label: "Copy Image Address",
                click: () => clipboard.writeText(srcURL),
            });
        }

        if (template.length === 0) return;

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ x: params.x, y: params.y });
    });
}
