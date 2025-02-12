// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare const Prism: any;

function requestSchemaUpdate() {
    const schemaText = document.getElementById("schemaText")!;
    schemaText.textContent = "Loading...";

    chrome.runtime.sendMessage({ type: "refreshSchema" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error fetching schema:", chrome.runtime.lastError);
            return;
        }

        if (response && response.schema) {
            schemaText.textContent = JSON.stringify(response.schema, null, 2);
        } else {
            schemaText.textContent = "Failed to fetch schema.";
        }
    });
}

function registerTempSchema() {
    const schemaText = document.getElementById("schemaText")!;
    schemaText.textContent = "Loading...";

    chrome.runtime.sendMessage({ type: "registerTempSchema" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error fetching schema:", chrome.runtime.lastError);
            return;
        }

        if (response && response.schema) {
            schemaText.textContent = JSON.stringify(response.schema, null, 2);
        } else {
            schemaText.textContent = "Failed to fetch schema.";
        }
    });
}

// Attach event listener to the Refresh button
document
    .getElementById("refreshSchema")!
    .addEventListener("click", requestSchemaUpdate);

document
    .getElementById("trySchema")!
    .addEventListener("click", registerTempSchema);

// Fetch schema on panel load
requestSchemaUpdate();
