// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let recording = false;
let recordedActions: any[] = [];

function requestSchemaUpdate() {
    const schemaAccordion = document.getElementById(
        "schemaAccordion",
    ) as HTMLDivElement;
    // const schemaText = document.getElementById("schemaText")!;
    // schemaText.textContent = "Loading...";
    schemaAccordion.innerHTML = "<p>Loading...</p>";

    chrome.runtime.sendMessage({ type: "refreshSchema" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error fetching schema:", chrome.runtime.lastError);
            return;
        }

        if (response && response.schema && response.schema.actions) {
            schemaAccordion.innerHTML = "";

            response.schema.actions.forEach((action: any, index: number) => {
                const { actionName, parameters } = action;
                const paramsText = parameters
                    ? JSON.stringify(parameters, null, 2)
                    : "{}";

                const accordionItem = document.createElement("div");
                accordionItem.classList.add("accordion-item");

                accordionItem.innerHTML = `
                    <h2 class="accordion-header" id="heading${index}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" 
                            data-bs-target="#collapse${index}" aria-expanded="false" aria-controls="collapse${index}">
                            ${actionName}
                        </button>
                    </h2>
                    <div id="collapse${index}" class="accordion-collapse collapse" aria-labelledby="heading${index}" data-bs-parent="#schemaAccordion">
                        <div class="accordion-body">
                            <pre><code class="language-json">${paramsText}</code></pre>
                        </div>
                    </div>
                `;

                schemaAccordion.appendChild(accordionItem);
            });
        } else {
            schemaAccordion.innerHTML = "<p>No schema found.</p>";
        }
    });
}

function copySchemaToClipboard() {
    chrome.runtime.sendMessage({ type: "refreshSchema" }, (schema) => {
        const schemaText = JSON.stringify(schema, null, 2);
        navigator.clipboard
            .writeText(schemaText)
            .then(() => {
                alert("Schema copied to clipboard!");
            })
            .catch((err) => console.error("Failed to copy schema: ", err));
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

function toggleActionForm() {
    const form = document.getElementById("actionForm")!;
    form.classList.toggle("hidden");
    if (form.classList.contains("hidden")) {
        (document.getElementById("actionName") as HTMLInputElement)!.value = "";
        (document.getElementById(
            "actionDescription",
        ) as HTMLTextAreaElement)!.value = "";
        document.getElementById("stepsTimelineContainer")!.innerHTML = "";
    }
}

// Function to save user-defined actions
async function saveUserAction() {
    const actionDescription = (
        document.getElementById("actionDescription") as HTMLTextAreaElement
    ).value.trim();

    const nameField = document.getElementById("actionName") as HTMLInputElement;
    const actionName =
        nameField.value != undefined
            ? nameField.value.trim()
            : prompt("Enter a name for this action:");

    const stepsContainer = document.getElementById("stepsTimelineContainer")!;
    const steps = JSON.parse(stepsContainer.dataset.steps || "[]");

    // Retrieve existing actions from localStorage
    const storedActions = localStorage.getItem("userActions");
    const actions = storedActions ? JSON.parse(storedActions) : [];

    // Add new action
    actions.push({
        name: actionName,
        description: actionDescription,
        steps: steps,
    });

    // Save back to localStorage
    localStorage.setItem("userActions", JSON.stringify(actions));

    // Update UI
    await updateUserActionsUI();
    toggleActionForm(); // Hide form after saving
}

// Function to update user actions display
async function updateUserActionsUI() {
    showRecordedActionScreenshot();
    await showUserDefinedActionsList();
}

function startRecording() {
    chrome.runtime.sendMessage({ type: "startRecording" });
    alert("Recording started! Perform actions on the main page.");

    document.getElementById("recordAction")!.classList.add("hidden");
    document.getElementById("stopRecording")!.classList.remove("hidden");
    document.getElementById("stepsTimelineContainer")!.dataset.steps = "";
}

// Function to stop recording
async function stopRecording() {
    const response = await chrome.runtime.sendMessage({
        type: "stopRecording",
    });

    if (response && response.recordedActions) {
        const stepsContainer = document.getElementById(
            "stepsTimelineContainer",
        )!;
        stepsContainer.classList.remove("hidden");
        stepsContainer.dataset.steps = JSON.stringify(response.recordedActions);
        renderTimelineSteps(response.recordedActions, "stepsTimelineContainer");
    }

    document.getElementById("recordAction")!.classList.remove("hidden");
    document.getElementById("stopRecording")!.classList.add("hidden");
}

async function cancelRecording() {
    const response = await chrome.runtime.sendMessage({
        type: "stopRecording",
    });

    document.getElementById("recordAction")!.classList.remove("hidden");
    document.getElementById("stopRecording")!.classList.add("hidden");

    const form = document.getElementById("actionForm")!;
    form.classList.add("hidden");
}

async function clearRecordedUserAction() {
    if (localStorage.getItem("userActions")) {
        localStorage.removeItem("userActions");
    }

    await chrome.runtime.sendMessage({ type: "clearRecordedActions" });

    // Update UI
    await updateUserActionsUI();
}

function showRecordedActionScreenshot() {
    const screenshotContainer = document.getElementById(
        "screenshotContainer",
    ) as HTMLDivElement;
    const downloadButton = document.getElementById(
        "downloadScreenshot",
    ) as HTMLButtonElement;
    const downloadHTMLButton = document.getElementById(
        "downloadHTML",
    ) as HTMLButtonElement;

    // Fetch the annotated screenshot from storage
    chrome.runtime.sendMessage(
        { type: "getAnnotatedScreenshot" },
        (response) => {
            if (response) {
                const img = document.createElement("img");
                img.src = response;
                img.alt = "Annotated Screenshot";
                img.style.width = "100%";
                img.style.border = "1px solid #ccc";
                img.style.borderRadius = "8px";
                screenshotContainer.appendChild(img);

                // Enable the download button
                downloadButton.style.display = "block";
                downloadButton.addEventListener("click", () =>
                    downloadScreenshot(response),
                );

                // Enable download button
                downloadHTMLButton.style.display = "block";
                downloadHTMLButton.addEventListener("click", () =>
                    downloadHTML(response),
                );
            } else {
                screenshotContainer.innerText = "No screenshot available.";
            }
        },
    );

    // Function to download the screenshot
    function downloadScreenshot(dataUrl: string) {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = "annotated_screenshot.png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function downloadHTML(html: string) {
        const blob = new Blob([html], { type: "text/html" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "captured_page.html";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

async function showUserDefinedActionsList() {
    const userActionsListContainer = document.getElementById(
        "userActionsListContainer",
    ) as HTMLDivElement;

    // Fetch recorded actions
    const storedActions = localStorage.getItem("userActions");
    const actions = storedActions ? JSON.parse(storedActions) : [];

    userActionsListContainer.innerHTML = "";

    if (actions !== undefined && actions.length > 0) {
        actions.forEach((action: any, index: number) => {
            renderTimeline(action, index);
        });
    } else {
        userActionsListContainer.innerHTML = "<p>No user-defined actions.</p>";
    }
}

function renderTimeline(action: any, index: number) {
    const actionName = action.name;

    const userActionsListContainer = document.getElementById(
        "userActionsListContainer",
    )!;

    const timelineHeader = document.createElement("div");
    timelineHeader.classList.add("accordion-item");

    timelineHeader.innerHTML = `
                    <h2 class="accordion-header" id="userActionheading${index}">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" 
                            data-bs-target="#collapseAction${index}" aria-expanded="false" aria-controls="collapseAction${index}">
                            ${actionName}
                        </button>
                    </h2>
                    <div id="collapseAction${index}" class="accordion-collapse collapse" aria-labelledby="userActionheading${index}" data-bs-parent="#userActionsListContainer">
                        <div class="accordion-body">
                            <div class="row">
                                <div class="col-md-12">
                                    <p><i> Action description </i></h6>
                                    <h6 class="card-title">Steps</h6>
                                    <div id="content">
                                        <ul class="timeline">
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

    const stepsContainer = timelineHeader.querySelector("ul.timeline")!;
    if (action.steps != undefined && action.steps.length > 0) {
        action.steps.forEach((step: any, index: number) => {
            const card = document.createElement("li");
            card.classList.add("event");
            card.dataset.date = new Date(step.timestamp).toLocaleString();

            card.innerHTML = `        
            <h3>${index + 1}. ${step.type}</h3>
            <p>Details.</p>
            <pre class="card-text"><code class="language-json">${JSON.stringify(step, null, 2)}</code></pre>
        `;

            stepsContainer.appendChild(card);
        });
    }

    userActionsListContainer.appendChild(timelineHeader);
}

function renderTimelineSteps(steps: any[], containerId: string) {
    const userActionsListContainer = document.getElementById(containerId)!;
    userActionsListContainer.innerHTML = `
                    <div id="content">
                        <ul class="timeline">
                        </ul>
                    </div>
                `;

    const stepsContainer =
        userActionsListContainer.querySelector("ul.timeline")!;
    if (steps != undefined && steps.length > 0) {
        steps.forEach((step: any, index: number) => {
            const card = document.createElement("li");
            card.classList.add("event");
            card.dataset.date = new Date(step.timestamp).toLocaleString();

            card.innerHTML = `        
            <h3>${index + 1}. ${step.type}</h3>
            <p>Details.</p>
            <pre class="card-text"><code class="language-json">${JSON.stringify(step, null, 2)}</code></pre>
        `;

            stepsContainer.appendChild(card);
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document
        .getElementById("addPageAction")!
        .addEventListener("click", toggleActionForm);
    document
        .getElementById("saveAction")!
        .addEventListener("click", saveUserAction);

    document
        .getElementById("refreshSchema")!
        .addEventListener("click", requestSchemaUpdate);

    document
        .getElementById("trySchema")!
        .addEventListener("click", registerTempSchema);

    document
        .getElementById("recordAction")!
        .addEventListener("click", startRecording);
    document
        .getElementById("cancelAddingAction")!
        .addEventListener("click", clearRecordedUserAction);

    document
        .getElementById("stopRecording")!
        .addEventListener("click", stopRecording);

    document
        .getElementById("clearRecordedActions")!
        .addEventListener("click", clearRecordedUserAction);

    // Fetch schema on panel load
    requestSchemaUpdate();

    updateUserActionsUI(); // Load saved actions when the panel opens
});
