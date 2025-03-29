// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { htmlPrefilter } from "jquery";
import { setStoredPageProperty, getStoredPageProperty } from "./storage";

let recording = false;
let recordedActions: any[] = [];
let launchUrl: string | null = "";

declare global {
    interface Window {
        Prism: {
            highlightAll: () => void;
        };
    }
}

async function getActiveTabUrl(): Promise<string | null> {
    try {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        return tabs.length > 0 ? tabs[0].url || null : null;
    } catch (error) {
        console.error("Error getting active tab URL:", error);
        return null;
    }
}

async function requestSchemaUpdate(forceRefresh?: boolean) {
    const itemsList = document.getElementById(
        "detectedSchemaItemsList",
    ) as HTMLElement;

    itemsList.innerHTML = "";

    const refreshButton = document.getElementById(
        "refreshDetectedActions",
    ) as HTMLButtonElement;
    const originalHtml = refreshButton.innerHTML;

    const currentSchema = await getStoredPageProperty(
        launchUrl!,
        "detectedActions",
    );
    const currentActionDefinitions = await getStoredPageProperty(
        launchUrl!,
        "detectedActionDefinitions",
    );

    if (
        currentSchema === null ||
        currentActionDefinitions === null ||
        forceRefresh
    ) {
        refreshButton.innerHTML =
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

        try {
            const response = await chrome.runtime.sendMessage({
                type: "refreshSchema",
            });
            if (chrome.runtime.lastError) {
                console.error(
                    "Error fetching schema:",
                    chrome.runtime.lastError,
                );
                return;
            }

            await setStoredPageProperty(
                launchUrl!,
                "detectedActions",
                response.schema,
            );
            await setStoredPageProperty(
                launchUrl!,
                "detectedActionDefinitions",
                response.actionDefinitions,
            );

            renderSchemaResults(response.schema);
        } finally {
            refreshButton.innerHTML = originalHtml;
        }
    } else {
        renderSchemaResults(currentSchema);
    }

    registerTempSchema();
}

function renderSchemaResults(schemaActions: any) {
    const itemsList = document.getElementById(
        "detectedSchemaItemsList",
    ) as HTMLElement;
    itemsList.innerHTML = "";

    if (schemaActions !== undefined && schemaActions.length > 0) {
        schemaActions.forEach((action: any, index: number) => {
            const { actionName, parameters } = action;
            const paramsText = parameters
                ? JSON.stringify(parameters, null, 2)
                : "{}";

            const listItem = document.createElement("li");
            listItem.className = "list-group-item list-item";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = actionName;

            /*
                const toggleDiv = document.createElement('div');
                toggleDiv.className = 'form-check form-switch';
                
                const toggleInput = document.createElement('input');
                toggleInput.className = 'form-check-input';
                toggleInput.type = 'checkbox';
                toggleInput.id = `toggle-${index}`;
                toggleInput.checked = true;
                
                toggleInput.addEventListener('change', () => {
                    // toggleOption(index);
                });
                
                toggleDiv.appendChild(toggleInput);
                */
            listItem.appendChild(nameSpan);
            //listItem.appendChild(toggleDiv);

            itemsList.appendChild(listItem);
        });
    } else {
        itemsList.innerHTML = "<p>No schema found.</p>";
    }
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

async function registerTempSchema() {
    await chrome.runtime.sendMessage({
        type: "registerTempSchema",
    });

    if (chrome.runtime.lastError) {
        console.error("Error fetching schema:", chrome.runtime.lastError);
        return;
    }
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
    let actionDescription = (
        document.getElementById("actionDescription") as HTMLTextAreaElement
    ).value.trim();

    const nameField = document.getElementById("actionName") as HTMLInputElement;
    const actionName =
        nameField.value != undefined
            ? nameField.value.trim()
            : prompt("Enter a name for this action:");

    const stepsContainer = document.getElementById("stepsTimelineContainer")!;
    const steps = JSON.parse(stepsContainer.dataset?.steps || "[]");

    const screenshot = JSON.parse(stepsContainer.dataset?.screenshot || "[]");
    let html = JSON.parse(stepsContainer.dataset?.html || '""');

    if (html === undefined || html === "[]") {
        const htmlFragments = await chrome.runtime.sendMessage({
            type: "captureHtmlFragments",
        });
        if (htmlFragments !== undefined && htmlFragments.length > 0) {
            html = [htmlFragments[0].content];
        }
    }

    const stepsDescription = (
        document.getElementById("actionStepsDescription") as HTMLTextAreaElement
    ).value.trim();

    if (stepsDescription !== undefined && stepsDescription !== "") {
        actionDescription += " " + stepsDescription;
    }

    const button = document.getElementById("saveAction") as HTMLButtonElement;
    const originalContent = button.innerHTML;
    const originalClass = button.className;

    function showTemporaryStatus(text: string, newClass: string) {
        button.innerHTML = text;
        button.className = `btn btn-sm ${newClass}`;

        setTimeout(() => {
            button.innerHTML = originalContent;
            button.className = originalClass;
            button.disabled = false;
        }, 5000);
    }

    button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...`;
    button.disabled = true;

    const detectedActions = new Map(
        Object.entries(
            (await getStoredPageProperty(
                launchUrl!,
                "detectedActionDefinitions",
            )) ?? {},
        ),
    );
    const authoredActions = new Map(
        Object.entries(
            (await getStoredPageProperty(
                launchUrl!,
                "authoredActionDefinitions",
            )) ?? {},
        ),
    );

    const existingActionNames: string[] = [
        ...detectedActions.keys(),
        ...authoredActions.keys(),
    ];

    // Get schema based on the recorded action info
    const response = await chrome.runtime.sendMessage({
        type: "getIntentFromRecording",
        html: html.map((str: string) => ({ content: str, frameId: 0 })),
        screenshot,
        actionName,
        actionDescription,
        existingActionNames,
        steps: JSON.stringify(steps),
    });
    if (chrome.runtime.lastError) {
        console.error("Error fetching schema:", chrome.runtime.lastError);
        showTemporaryStatus("✖ Failed", "btn-outline-danger");
    } else {
        const processedActionName = response.intentJson.actionName;
        await addEntryToStoredPageProperties(
            processedActionName,
            "userActions",
            {
                name: processedActionName,
                description: actionDescription,
                steps,
                screenshot,
                html,
                intentSchema: response.intent,
                actionsJson: response.actions,
            },
        );

        await addEntryToStoredPageProperties(
            processedActionName,
            "authoredActionDefinitions",
            response.intentTypeDefinition,
        );
        await addEntryToStoredPageProperties(
            processedActionName,
            "authoredActionsJson",
            response.actions,
        );
        await addEntryToStoredPageProperties(
            processedActionName,
            "authoredIntentJson",
            response.intentJson,
        );
        showTemporaryStatus("✔ Succeeded", "btn-outline-success");
    }

    toggleActionForm();
    await updateUserActionsUI();
    registerTempSchema();
}

async function addEntryToStoredPageProperties(
    actionName: string,
    key: string,
    value: any,
) {
    let currentActionJson = new Map(
        Object.entries((await getStoredPageProperty(launchUrl!, key)) ?? {}),
    );
    currentActionJson.set(actionName!, value);
    await setStoredPageProperty(
        launchUrl!,
        key,
        Object.fromEntries(currentActionJson),
    );
}

async function removeEntryFromStoredPageProperties(
    actionName: string,
    key: string,
) {
    let currentActionJson = new Map(
        Object.entries((await getStoredPageProperty(launchUrl!, key)) ?? {}),
    );
    if (currentActionJson.has(actionName)) {
        currentActionJson.delete(actionName);
        await setStoredPageProperty(
            launchUrl!,
            key,
            Object.fromEntries(currentActionJson),
        );
    }
}

// Function to update user actions display
async function updateUserActionsUI() {
    await showUserDefinedActionsList();
    if (window.Prism) {
        window.Prism.highlightAll();
    }
}

function startRecording() {
    chrome.runtime.sendMessage({ type: "startRecording" });
    document.getElementById("recordAction")!.classList.add("hidden");
    document.getElementById("stopRecording")!.classList.remove("hidden");
    document.getElementById("stepsTimelineContainer")!.dataset.steps = "";
    document.getElementById("stepsTimelineContainer")!.dataset.screenshot = "";
    document.getElementById("stepsTimelineContainer")!.dataset.html = "";
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
        stepsContainer.dataset.screenshot = JSON.stringify(
            response.recordedActionScreenshot,
        );
        stepsContainer.dataset.html = JSON.stringify(
            response.recordedActionHtml,
        );

        const actionDescription = (
            document.getElementById("actionDescription") as HTMLTextAreaElement
        ).value.trim();

        const actionName = (
            document.getElementById("actionName") as HTMLInputElement
        ).value.trim();

        renderTimelineSteps(
            response.recordedActions,
            stepsContainer,
            response.recordedActionScreenshot,
            response.recordedActionHtml,
        );
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
    await chrome.runtime.sendMessage({ type: "clearRecordedActions" });
    await setStoredPageProperty(launchUrl!, "userActions", null);
    await setStoredPageProperty(launchUrl!, "authoredActionDefinitions", null);
    await setStoredPageProperty(launchUrl!, "authoredActionsJson", null);
    await setStoredPageProperty(launchUrl!, "authoredIntentJson", null);
    // Update UI
    await updateUserActionsUI();
    registerTempSchema();
}

async function showUserDefinedActionsList() {
    const userActionsListContainer = document.getElementById(
        "userActionsListContainer",
    ) as HTMLDivElement;

    // Fetch recorded actions
    const storedActions = new Map(
        Object.entries(
            (await getStoredPageProperty(launchUrl!, "userActions")) ?? {},
        ),
    );

    const actions = Array.from(storedActions.values());

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
                                    <p><i> ${action.description} </i></h6>
                                    
                                    <div class="tab-container">
                                        <ul class="nav nav-tabs" id="sidePanelTabs${index}">
                                            <li class="nav-item">
                                            <a class="nav-link active" data-bs-toggle="tab" href="#stepsTab${index}">Steps</a>
                                            </li>
                                            <li class="nav-item">
                                            <a class="nav-link" data-bs-toggle="tab" href="#intentTab${index}">Intent</a>
                                            </li>
                                            <li class="nav-item">
                                            <a class="nav-link" data-bs-toggle="tab" href="#planTab${index}">Actions</a>
                                            </li>
                                        </ul>
                                    </div>

                                    <!-- Tab Content -->
                                        <div class="tab-content mt-3">
                                            <!-- Steps Tab -->
                                            <div class="tab-pane fade show active" id="stepsTab${index}">
                                                <div id="Stepscontent"></div>
                                            </div>

                                            <!-- Intent Tab -->
                                            <div class="tab-pane fade" id="intentTab${index}">
                                                <div id="intentContent"></div>
                                            </div>

                                            <!-- Plan Tab -->
                                            <div class="tab-pane fade" id="planTab${index}">
                                                <div id="planContent"></div>
                                            </div>
                                        </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

    const stepsContainer = timelineHeader.querySelector(
        "#Stepscontent",
    )! as HTMLElement;
    renderTimelineSteps(
        action.steps,
        stepsContainer,
        action.screenshot,
        action.html,
        true,
        actionName,
    );

    if (action.intentSchema !== undefined) {
        const card = document.createElement("div");
        card.innerHTML = `        
            <pre class="card-text"><code class="language-typescript">${action.intentSchema}</code></pre>
        `;

        const intentViewContainer = timelineHeader.querySelector(
            "#intentContent",
        )! as HTMLElement;

        intentViewContainer.replaceChildren(card);
    }

    if (action.actionsJson !== undefined) {
        const actionsViewContainer = timelineHeader.querySelector(
            "#planContent",
        )! as HTMLElement;

        const actionsCard = document.createElement("div");
        actionsCard.innerHTML = `        
            <pre class="card-text"><code class="language-json">${JSON.stringify(action.actionsJson, null, 2)}</code></pre>
        `;

        actionsViewContainer.replaceChildren(actionsCard);
    }

    userActionsListContainer.appendChild(timelineHeader);
}

function renderTimelineSteps(
    steps: any[],
    userActionsListContainer: HTMLElement,
    screenshotData: string[],
    htmlData: string[],
    enableEdits?: boolean,
    actionName?: string,
) {
    userActionsListContainer.innerHTML = `
                    <div id="content">
                        <ul class="timeline">
                        </ul>
                        <div id="stepsScreenshotContainer"></div>
                    </div>
                    <div class="d-flex gap-2 mt-3 float-end">
                        <button id="downloadScreenshot" class="btn btn-sm btn-outline-primary hidden" title="Download Image">
                            <i class="bi bi-file-earmark-image"></i>
                        </button>
                        <button id="downloadHtml" class="btn btn-sm btn-outline-primary hidden" title="Download HTML">
                            <i class="bi bi-filetype-html"></i>
                        </button>
                        <button id="editAction" class="btn btn-sm btn-outline-primary hidden" title="Edit Action">
                            <i class="bi bi-pencil-fill"></i>
                        </button>
                        <button id="deleteAction" class="btn btn-sm btn-outline-danger hidden" title="Delete Action">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                `;

    const stepsContainer =
        userActionsListContainer.querySelector("ul.timeline")!;
    if (steps != undefined && steps.length > 0) {
        steps.forEach((step: any, index: number) => {
            const card = document.createElement("li");
            card.classList.add("event");
            card.dataset.date = new Date(step.timestamp).toLocaleString();

            // only display a subset of fields in the UI
            const { boundingBox, timestamp, id, ...filteredObject } = step;

            card.innerHTML = `        
            <h3>${index + 1}. ${step.type}</h3>
            <p>Details.</p>
            <pre class="card-text"><code class="language-json">${JSON.stringify(filteredObject, null, 2)}</code></pre>
        `;

            stepsContainer.appendChild(card);
        });
    }

    const screenshotContainer = userActionsListContainer.querySelector(
        "#stepsScreenshotContainer",
    )!;

    const downloadButton = userActionsListContainer.querySelector(
        "#downloadScreenshot",
    )! as HTMLElement;

    const downloadHTMLButton = userActionsListContainer.querySelector(
        "#downloadHtml",
    )! as HTMLElement;

    if (screenshotData !== undefined && screenshotData.length > 0) {
        screenshotData.forEach((screenshot) => {
            const img = document.createElement("img");
            img.src = screenshot;
            img.alt = "Annotated Screenshot";
            img.style.width = "100%";
            img.style.border = "1px solid #ccc";
            img.style.borderRadius = "8px";
            screenshotContainer.appendChild(img);

            // Enable the download button
            downloadButton.classList.remove("hidden");
            downloadButton.style.display = "block";
            downloadButton.addEventListener("click", () =>
                // TODO: update downloads
                downloadScreenshot(screenshot),
            );
        });
    }

    if (enableEdits && actionName !== undefined && actionName !== "") {
        const deleteButton = userActionsListContainer.querySelector(
            "#deleteAction",
        )! as HTMLElement;

        deleteButton.classList.remove("hidden");
        deleteButton.style.display = "block";
        deleteButton.addEventListener("click", () => deleteAction(actionName));
    }

    if (window.Prism) {
        window.Prism.highlightAll();
    }

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

    async function deleteAction(name: string) {
        await removeEntryFromStoredPageProperties(name, "userActions");
        await removeEntryFromStoredPageProperties(
            name,
            "authoredActionDefinitions",
        );
        await removeEntryFromStoredPageProperties(name, "authoredActionsJson");
        await removeEntryFromStoredPageProperties(name, "authoredIntentJson");

        await updateUserActionsUI();
        registerTempSchema();
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    document
        .getElementById("addPageAction")!
        .addEventListener("click", toggleActionForm);
    document
        .getElementById("saveAction")!
        .addEventListener("click", saveUserAction);

    document
        .getElementById("refreshDetectedActions")!
        .addEventListener("click", () => requestSchemaUpdate(true));

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

    launchUrl = await getActiveTabUrl();

    // Fetch schema on panel load
    requestSchemaUpdate();

    updateUserActionsUI(); // Load saved actions when the panel opens
});
