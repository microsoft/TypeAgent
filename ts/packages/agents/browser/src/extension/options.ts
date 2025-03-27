// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ExtensionSettings {
    websocketHost: string;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
    websocketHost: "ws://localhost:8080/",
};

const optionsForm = document.getElementById("optionsForm") as HTMLFormElement;
const websocketHostInput = document.getElementById(
    "websocketHost",
) as HTMLInputElement;
const saveOptionsBtn = document.getElementById(
    "saveOptions",
) as HTMLButtonElement;
const statusMessage = document.getElementById(
    "statusMessage",
) as HTMLDivElement;

// Load saved settings when the options page is opened
document.addEventListener("DOMContentLoaded", loadSavedSettings);

optionsForm.addEventListener("submit", saveOptions);

function loadSavedSettings(): void {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        websocketHostInput.value =
            items.websocketHost || DEFAULT_SETTINGS.websocketHost;
    });
}

function saveOptions(e: Event): void {
    e.preventDefault();

    const settings: ExtensionSettings = {
        websocketHost: websocketHostInput.value.trim(),
    };

    if (!isValidWebSocketUrl(settings.websocketHost)) {
        showStatus(
            "Please enter a valid WebSocket URL (ws:// or wss://)",
            "danger",
        );
        return;
    }

    chrome.storage.sync.set(settings, () => {
        showStatus("Settings saved successfully!", "success");
    });
}

function showStatus(
    message: string,
    type: "success" | "danger" | "info",
): void {
    statusMessage.textContent = message;
    statusMessage.className = `alert alert-${type}`;

    // Hide the message after 3 seconds
    setTimeout(() => {
        statusMessage.className = "alert d-none";
    }, 3000);
}

function isValidWebSocketUrl(url: string): boolean {
    return url.startsWith("ws://") || url.startsWith("wss://");
}
