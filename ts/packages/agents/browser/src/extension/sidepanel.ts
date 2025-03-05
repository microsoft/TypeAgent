// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let recording = false;
let recordedActions: any[] = [];

async function requestSchemaUpdate() {
    const schemaAccordion = document.getElementById(
        "schemaAccordion",
    ) as HTMLDivElement;
    schemaAccordion.innerHTML = "<p>Loading...</p>";

    const response = await chrome.runtime.sendMessage({
        type: "refreshSchema",
    });
    if (chrome.runtime.lastError) {
        console.error("Error fetching schema:", chrome.runtime.lastError);
        return;
    }

    renderSchemaResults(response);
}

function renderSchemaResults(response: any) {
    const schemaAccordion = document.getElementById(
        "schemaAccordion",
    ) as HTMLDivElement;

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
    const schemaAccordion = document.getElementById(
        "schemaAccordion",
    ) as HTMLDivElement;
    schemaAccordion.innerHTML = "<p>Loading...</p>";

    const response = await chrome.runtime.sendMessage({
        type: "registerTempSchema",
    });
    if (chrome.runtime.lastError) {
        console.error("Error fetching schema:", chrome.runtime.lastError);
        return;
    }

    renderSchemaResults(response);
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

    const screenshot = JSON.parse(stepsContainer.dataset.screenshot || "");
    const html = JSON.parse(stepsContainer.dataset.html || "");

    // Retrieve existing actions from localStorage
    const storedActions = localStorage.getItem("userActions");
    const actions = storedActions ? JSON.parse(storedActions) : [];

    // Add new action
    actions.push({
        name: actionName,
        description: actionDescription,
        steps,
        screenshot,
        html,
    });

    // Save back to localStorage
    localStorage.setItem("userActions", JSON.stringify(actions));

    // Update UI
    await updateUserActionsUI();
    toggleActionForm(); // Hide form after saving
}

// Function to update user actions display
async function updateUserActionsUI() {
    await showUserDefinedActionsList();
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
            actionName,
            actionDescription,
            response.recordedActions,
            stepsContainer,
            response.recordedActionScreenshot,
            response.recordedActionHtml,
            true,
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
    if (localStorage.getItem("userActions")) {
        localStorage.removeItem("userActions");
    }

    await chrome.runtime.sendMessage({ type: "clearRecordedActions" });

    // Update UI
    await updateUserActionsUI();
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
                                    <button id="processAction" class="btn btn-sm btn-outline-primary" style="border:0px" title="Process Action">
                                        <i class="bi bi-robot"></i>
                                    </button>
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
        action.name,
        action.description,
        action.steps,
        stepsContainer,
        action.screenshot,
        action.html,
    );

    const processActionButton = timelineHeader.querySelector(
        "#processAction",
    )! as HTMLElement;

    const intentViewContainer = timelineHeader.querySelector(
        "#intentContent",
    )! as HTMLElement;

    const actionsViewContainer = timelineHeader.querySelector(
        "#planContent",
    )! as HTMLElement;

    processActionButton.style.display = "block";
    processActionButton.addEventListener("click", () =>
        getIntentFromRecording(
            action.html,
            action.screenshot,
            action.name,
            action.description,
            action.steps,
        ),
    );

    async function getIntentFromRecording(
        html: string,
        screenshot: string,
        actionName: string,
        description: string,
        steps: any[],
    ) {
        const response = await chrome.runtime.sendMessage({
            type: "getIntentFromRecording",
            html: [{ content: html, frameId: 0 }],
            screenshot,
            actionName,
            description,
            steps: JSON.stringify(steps),
        });
        if (chrome.runtime.lastError) {
            console.error("Error fetching schema:", chrome.runtime.lastError);
            return;
        }

        const card = document.createElement("div");
        card.innerHTML = `        
            <pre class="card-text"><code class="language-json">${response.intent}</code></pre>
        `;

        intentViewContainer.replaceChildren(card);

        const actionsCard = document.createElement("div");
        actionsCard.innerHTML = `        
            <pre class="card-text"><code class="language-json">${JSON.stringify(response.actions, null, 2)}</code></pre>
        `;

        actionsViewContainer.replaceChildren(actionsCard);
    }

    userActionsListContainer.appendChild(timelineHeader);
}

function renderTimelineSteps(
    actionName: string,
    actionDescription: string,
    steps: any[],
    userActionsListContainer: HTMLElement,
    screenshotData: string,
    htmlData: string,
    isEditingMode?: boolean,
) {
    userActionsListContainer.innerHTML = `
                    <div id="content">
                        <ul class="timeline">
                        </ul>
                        <div id="stepsScreenshotContainer"></div>
                    </div>
                    <div class="d-flex gap-2 mt-3 float-end">
                        <button id="downloadScreenshot" class="btn btn-sm btn-outline-primary" title="Download Image">
                            <i class="bi bi-file-earmark-image"></i>
                        </button>
                        <button id="downloadHtml" class="btn btn-sm btn-outline-primary" title="Download HTML">
                            <i class="bi bi-filetype-html"></i>
                        </button>
                        <button id="processAction" class="btn btn-sm btn-outline-primary hidden" title="Process Action">
                            <i class="bi bi-robot"></i>
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

            card.innerHTML = `        
            <h3>${index + 1}. ${step.type}</h3>
            <p>Details.</p>
            <pre class="card-text"><code class="language-json">${JSON.stringify(step, null, 2)}</code></pre>
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

    const processActionButton = userActionsListContainer.querySelector(
        "#processAction",
    )! as HTMLElement;

    if (screenshotData) {
        const img = document.createElement("img");
        img.src = screenshotData;
        img.alt = "Annotated Screenshot";
        img.style.width = "100%";
        img.style.border = "1px solid #ccc";
        img.style.borderRadius = "8px";
        screenshotContainer.appendChild(img);

        // Enable the download button
        downloadButton.style.display = "block";
        downloadButton.addEventListener("click", () =>
            downloadScreenshot(screenshotData),
        );
    }

    if (htmlData) {
        // Enable download button
        downloadHTMLButton.style.display = "block";
        downloadHTMLButton.addEventListener("click", () =>
            downloadHTML(htmlData),
        );
    }

    if (isEditingMode) {
        processActionButton.classList.remove("hidden");
        processActionButton.addEventListener("click", () =>
            getIntentFromRecording(
                htmlData,
                screenshotData,
                actionName,
                actionDescription,
                steps,
            ),
        );
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

    async function getIntentFromRecording(
        html: string,
        screenshot: string,
        actionName: string,
        description: string,
        steps: any[],
    ) {
        const response = await chrome.runtime.sendMessage({
            type: "getIntentFromRecording",
            html: [{ content: html, frameId: 0 }],
            screenshot,
            actionName,
            description,
            steps: JSON.stringify(steps),
        });
        if (chrome.runtime.lastError) {
            console.error("Error fetching schema:", chrome.runtime.lastError);
            return;
        }
        console.log(response.data);
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
        .getElementById("refreshDetectedActions")!
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
