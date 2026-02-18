// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Platform abstraction for chat UI rendering.
 *
 * The shell provides an Electron adapter (IPC to open URLs in embedded browser);
 * the Chrome extension provides one that uses chrome.tabs.create().
 */
export interface PlatformAdapter {
    /** Handle a click on an <a> link in rendered content. */
    handleLinkClick(href: string, target: string | null): void;
}

/**
 * Minimal settings interface consumed by setContent.
 * The shell's full SettingsView implements this; the extension
 * uses a simple "allow everything" implementation.
 */
export interface ChatSettingsView {
    isDisplayTypeAllowed(type: string): boolean;
}

/** Default settings that allow all display types. */
export const defaultChatSettings: ChatSettingsView = {
    isDisplayTypeAllowed() {
        return true;
    },
};
