// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { HTMLReducer } from "./htmlReducer";
import { SkeletonLoadingDetector } from "./loadingDetector";
import { convert } from "html-to-text";
import DOMPurify from "dompurify";

function isVisible(element: HTMLElement) {
    var html = document.documentElement;
    var rect = element.getBoundingClientRect();

    return (
        !!rect &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.left <= html.clientWidth &&
        rect.top <= html.clientHeight
    );
}

function matchString(s: string, re: RegExp) {
    return s && s.match(re);
}

function matchElement(element: HTMLElement, re: RegExp) {
    return (
        matchString(element.innerHTML, re) ||
        matchString(element.id, re) ||
        matchString(element.innerText, re)
    );
}

function matchLinks(pattern: string) {
    let re: RegExp | undefined;
    try {
        re = pattern ? new RegExp(pattern, "i") : undefined;
    } catch (err: any) {
        re = undefined;
        console.log(
            "Error building matching regular expression: " + err.toString(),
        );
    }

    //let allLinks = document.querySelectorAll("a, input, button");
    let allLinks = document.querySelectorAll("a");
    let matchedLinks = Array();

    allLinks.forEach((element: HTMLElement) => {
        if (re && isVisible(element) && matchElement(element, re)) {
            matchedLinks.push(element);
        }
    });

    let selectedLink = null;
    if (matchedLinks.length > 0) {
        selectedLink = matchedLinks[0];
    }

    return selectedLink;
}

function matchLinksByPostion(position: number) {
    //let allLinks = document.querySelectorAll("a, input, button");
    let allLinks = document.querySelectorAll("a");
    let matchedLinks = Array();

    allLinks.forEach((element: HTMLElement) => {
        if (isVisible(element)) {
            matchedLinks.push(element);
        }
    });

    let selectedLink = null;
    if (matchedLinks.length > position) {
        selectedLink = matchedLinks[position];
    }

    return selectedLink;
}

function getTextInNode(currentNode: Node, sentences: string[]): string[] {
    if (currentNode.nodeType == Node.TEXT_NODE && currentNode.textContent) {
        sentences.push(currentNode.textContent);
    }

    if (currentNode.hasChildNodes()) {
        currentNode.childNodes.forEach((node) => {
            sentences = getTextInNode(node, sentences);
        });
    }

    return sentences;
}

function getReadablePageContent() {
    if (isProbablyReaderable(document)) {
        // readability updates the document object passed in - create a clone
        // to prevent modifying the live page
        var documentClone = document.cloneNode(true) as Document;
        var article = new Readability(documentClone).parse();

        // build usable text, with line breaks.
        if (article?.content) {
            let formattedText: string[] = [];
            var contentRoot = document.createElement("div");
            contentRoot.innerHTML = article?.content;

            formattedText = getTextInNode(contentRoot, formattedText);

            return {
                ...article,
                formattedText,
            };
        }
    }
    return { error: "Page content cannot be read" };
}

function markInvisibleNodesForCleanup() {
    const allElements = Array.from(document.body.getElementsByTagName("*"));
    allElements.forEach((element: Element) => {
        if (
            element instanceof HTMLElement &&
            element.nodeType == Node.ELEMENT_NODE
        ) {
            if (element.hidden) {
                element.setAttribute("data-deleteInReducer", "");
            } else if (element.hasAttribute("data-deleteInReducer")) {
                // previously hidden element is now visible
                element.removeAttribute("data-deleteInReducer");
            }
        }
    });
}

function getPageHTML(
    fullSize?: boolean,
    documentHtml?: string,
    frameId?: number,
    useTimestampIds?: boolean,
) {
    if (!documentHtml) {
        setIdsOnAllElements(frameId!, useTimestampIds);
        markInvisibleNodesForCleanup();
        documentHtml = document.children[0].outerHTML;
    }

    if (fullSize) {
        return documentHtml;
    }

    const reducer = new HTMLReducer();
    reducer.removeDivs = false;
    const reducedHtml = reducer.reduce(documentHtml);
    return reducedHtml;
}

function getPageText(documentHtml: string, frameId: number) {
    if (!documentHtml) {
        setIdsOnAllElements(frameId, false);
        documentHtml = document.body.outerHTML;
    }

    const options = {
        wordwrap: 130,
    };

    const text = convert(documentHtml, options);
    return text;
}

function getPageHTMLSubFragments(
    documentHtml: string,
    cssSelectors: string,
    frameId: number,
) {
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );
    const elements = doc.documentElement.querySelectorAll(cssSelectors);
    let htmlFragments = [];
    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            htmlFragments.push({
                frameId: frameId,
                content: elements[i].outerHTML,
            });
        }
    }

    return htmlFragments;
}

function getPageHTMLFragments(
    documentHtml: string,
    frameId: number,
    useTimestampIds: boolean,
    maxSize: 16000,
) {
    if (!documentHtml) {
        documentHtml = getPageHTML(
            false,
            documentHtml,
            frameId,
            useTimestampIds,
        );
    }
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );
    let htmlFragments = [];
    let node = doc.body;
    while (node) {
        if (node.outerHTML.length > maxSize) {
            if (node.children.length > 0) {
                let largestIndex = 0;
                let largestSize = 0;
                for (let i = 0; i < node.children.length; i++) {
                    if (node.children[i].outerHTML.length > largestSize) {
                        largestIndex = i;
                        largestSize = node.children[i].outerHTML.length;
                    }
                }
                node = node.children[largestIndex] as HTMLElement;
            } else {
                break;
            }
        } else {
            htmlFragments.push({
                frameId: frameId,
                content: node.outerHTML,
            });

            node.remove();

            if (node == doc.body) {
                break;
            } else {
                node = doc.body;
            }
        }
    }

    return htmlFragments;
}

function getFullSelector(e: HTMLElement) {
    var s = "",
        t,
        i,
        c,
        p,
        n;
    do {
        t = e.tagName.toLowerCase();
        i = e.hasAttribute("id") ? "#" + e.id : "";
        c = e.hasAttribute("class")
            ? "." + e.className.split(/\s+/).join(".")
            : "";
        p = e.parentElement;
        n =
            Array.prototype.filter
                .call(e.parentNode?.childNodes, function (x) {
                    return x.nodeType == Node.ELEMENT_NODE;
                })
                .indexOf(e) + 1;
        s = t + i + c + ":nth-child(" + n + ") > " + s;
    } while (!p || !(e = p).tagName.match(/^HTML$/i));
    return s.slice(0, -3);
}

function getInteractiveElementsBoundingBoxes() {
    const allElements = Array.from(document.getElementsByTagName("*"));
    let textInputBounds = Array();
    let clickBounds = Array();
    let scrollBounds = Array();
    let tableRowBounds = Array();
    let tableColBounds = Array();
    let tableCellBounds = Array();
    let index = 0;
    let rowIndex = 0;
    let colIndex = 0;
    let isFirstRow = true;

    allElements.forEach((element: Element) => {
        if (element instanceof HTMLElement) {
            if (
                isVisible(element) &&
                !element.hidden &&
                element.checkVisibility({
                    checkVisibilityCSS: true,
                    checkOpacity: true,
                })
            ) {
                const bounds = element.getBoundingClientRect();
                if (element instanceof HTMLInputElement) {
                    if (element.tagName == "TEXT") {
                        textInputBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    } else {
                        clickBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    }

                    index += 1;
                } else if (
                    element instanceof HTMLAnchorElement ||
                    element instanceof HTMLButtonElement ||
                    element.getAttribute("onclick") != null
                    // (typeof element.click === 'function')
                ) {
                    clickBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });

                    index += 1;
                } else if (element instanceof HTMLTableRowElement) {
                    tableRowBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: rowIndex,
                    });
                    rowIndex += 1;
                    if (isFirstRow) {
                        // add all cells as columns
                        for (const col of element.children) {
                            const colBounds = col.getBoundingClientRect();
                            tableColBounds.push({
                                top: colBounds.top,
                                right: colBounds.right,
                                bottom: colBounds.bottom,
                                left: colBounds.left,
                                selector: getFullSelector(col as HTMLElement),
                                index: colIndex,
                            });
                            colIndex += 1;
                        }

                        isFirstRow = false;
                    }
                } else if (element instanceof HTMLTableColElement) {
                    tableColBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: colIndex,
                    });
                    colIndex += 1;
                } else if (element instanceof HTMLTableCellElement) {
                    tableCellBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });
                    index += 1;
                }

                /*
                                const scrollState = isScrollable(element);
                                if (scrollState.vertical || scrollState.horizontal) {
                                    scrollBounds.push({
                                        top: bounds.top,
                                        right: bounds.right,
                                        bottom: bounds.bottom,
                                        left: bounds.left,
                                        selector: getFullSelector(element),
                                        index: index,
                                    });
                                }
                */
                if (element.getAttribute("handler_click")) {
                    console.log("Found handler added by patch");
                }
            }
        }
    });

    return {
        textInput: textInputBounds,
        click: clickBounds,
        scroll: scrollBounds,
        rows: tableRowBounds,
        cols: tableColBounds,
        cells: tableCellBounds,
    };
}

function daysIntoYear() {
    const date = new Date();
    return (
        (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
            Date.UTC(date.getFullYear(), 0, 0)) /
        24 /
        60 /
        60 /
        1000
    );
}

function setIdsOnAllElements(frameId: number, useTimestampIds?: boolean) {
    const allElements = Array.from(document.getElementsByTagName("*"));
    let idPrefix = `id_${daysIntoYear()}_${frameId}_`;
    const skipIdsFor = [
        "BR",
        "P",
        "B",
        "I",
        "U",
        "STRONG",
        "TEMPLATE",
        "IFRAME",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HR",
        "HEAD",
        "TITLE",
        "HTML",
        "BODY",
        "SCRIPT",
        "META",
        "STYLE",
        "SPAN",
        "TABLE",
        "TBODY",
        "TR",
        "TD",
        "UL",
        "OL",
        "LI",
        "LABEL",
        "PATH",
        "SVG",
    ];
    // let i = 0;
    for (let i = 0; i < allElements.length; i++) {
        let element = allElements[i];

        // for (let element of allElements) {
        if (
            !element.hasAttribute("id") &&
            !skipIdsFor.includes(element.tagName.toUpperCase())
        ) {
            if (useTimestampIds) {
                // element.setAttribute("id", idPrefix + performance.now().toString().replace('.', '_'));
                element.setAttribute("id", idPrefix + i.toString());
            } else {
                element.setAttribute("id", idPrefix + i.toString());
                // i++;
            }
        }
    }
}

async function awaitPageIncrementalUpdates() {
    return new Promise<string | undefined>((resolve, reject) => {
        const detector = new SkeletonLoadingDetector({
            stabilityThresholdMs: 500,
            // Consider elements visible when they're at least 10% in view
            intersectionThreshold: 0.1,
        });

        detector
            .detect()
            .then(() => {
                resolve("true");
            })
            .catch((_error: Error) => {
                resolve("false");
            });
    });
}

let recording = false;
let recordedActions: any[] = [];
let actionIndex = 1;
let recordedHtmlIndex = 0;
let recordedActionHtml: string[] = [];
let recordedActionScreenshot: string[] = [];
let lastUrl = window.location.href;
let lastScreenshot: string = "";
let lastPagehtml: string = "";

const observeDOMChanges = () => {
    const targetNode = document.body; // Observe the entire document
    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;

        // Detect if URL has changed since last check
        if (currentUrl !== lastUrl) {
            console.log("Navigation detected! New URL:", currentUrl);

            // Update last known URL
            lastUrl = currentUrl;

            // Optional: Send message to background script
            chrome.runtime.sendMessage({
                action: "spaNavigationDetected",
                url: currentUrl,
            });

            window.dispatchEvent(new Event("spa-navigation"));
        }
    });

    observer.observe(targetNode, { childList: true, subtree: true });
};

async function startRecording() {
    if (recording) return;

    await chrome.runtime.sendMessage({
        type: "clearRecordedActions",
    });

    recording = true;
    recordedActions = [];
    actionIndex = 1;

    recordedActionHtml = [];
    recordedActionScreenshot = [];
    recordedHtmlIndex = 0;
    lastPagehtml = "";
    lastScreenshot = "";

    setIdsOnAllElements(0);

    document.addEventListener("click", recordClick, true);
    document.addEventListener("input", recordInput, true);
    // document.addEventListener("scroll", recordScroll, true);
    document.addEventListener("keyup", recordTextEntry, true);

    observeDOMChanges();

    window.addEventListener("unload", recordNavigation);
    window.addEventListener("beforeunload", recordNavigation);
    window.addEventListener("popstate", recordNavigation);
    window.addEventListener("hashchange", recordNavigation);
}

// Stop recording and return data
async function stopRecording() {
    recording = false;
    document.removeEventListener("click", recordClick, true);
    document.removeEventListener("input", recordInput, true);
    // document.removeEventListener("scroll", recordScroll, true);
    document.removeEventListener("keyup", recordTextEntry, true);

    window.removeEventListener("unload", recordNavigation, true);
    window.removeEventListener("beforeunload", recordNavigation, true);
    window.removeEventListener("popstate", recordNavigation, true);
    window.removeEventListener("hashchange", recordNavigation, true);

    const screenshot = await captureAnnotatedScreenshot();
    recordedActionScreenshot.push(screenshot);

    const pageHTML = getPageHTML(false, "", 0, false);
    recordedActionHtml.push(pageHTML);
    recordedHtmlIndex = recordedActionHtml.length;

    await chrome.runtime.sendMessage({
        type: "recordingStopped",
        recordedActions,
        recordedActionScreenshot,
        recordedActionHtml,
    });
}

async function captureUIState() {
    try {
        lastScreenshot = await chrome.runtime.sendMessage({
            type: "takeScreenshot",
        });
    } catch {}

    lastPagehtml = getPageHTML(false, "", 0, false);
}

// Record click events
async function recordClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: actionIndex++,
        type: "click",
        tag: target.tagName,
        text: target.textContent?.trim(),
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

// Record text input events
async function recordInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: actionIndex++,
        type: "input",
        tag: target.tagName,
        value: target.value,
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

async function recordTextEntry(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
    ) {
        let value = target.textContent;
        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
        ) {
            value = target.value;
        }

        const action = {
            id: actionIndex++,
            type: "textInput",
            timestamp: Date.now(),
            tag: target.tagName,
            selector: getCSSSelector(target),
            boundingBox: getBoundingBox(target),
            value: value, // Capture final text value
            htmlIndex: recordedHtmlIndex,
        };

        recordedActions.push(action);
    }
    if (target.tagName === "BODY") {
        if (
            recordedActions.length > 0 &&
            recordedActions[recordedActions.length - 1].type ===
                "pageLevelTextInput"
        ) {
            // accumulate entered text value
            recordedActions[recordedActions.length - 1].value += event.key;
        } else {
            const action = {
                id: actionIndex++,
                type: "pageLevelTextInput",
                timestamp: Date.now(),
                tag: target.tagName,
                selector: "body",
                boundingBox: getBoundingBox(target),
                value: event.key,
                htmlIndex: recordedHtmlIndex,
            };

            recordedActions.push(action);
        }
    }

    await saveRecordedActions();
}

// Record scroll events
async function recordScroll() {
    recordedActions.push({
        id: actionIndex++,
        type: "scroll",
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

async function recordNavigation() {
    recordedActions.push({
        id: actionIndex++,
        type: "navigation",
        url: window.location.href,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    const screenshot = await captureAnnotatedScreenshot(lastScreenshot);
    recordedActionScreenshot.push(screenshot);
    if (lastPagehtml.length == 0) {
        lastPagehtml = getPageHTML(false, "", 0, false);
    }

    recordedActionHtml.push(lastPagehtml);
    recordedHtmlIndex = recordedActionHtml.length;
    await saveRecordedActions();
}

async function captureAnnotatedScreenshot(
    screenshotUrl?: string,
): Promise<string> {
    return new Promise(async (resolve, reject) => {
        if (screenshotUrl === undefined || screenshotUrl.length == 0) {
            screenshotUrl = await chrome.runtime.sendMessage({
                type: "takeScreenshot",
            });
        }

        if (!screenshotUrl) {
            console.error("Failed to capture screenshot");
            resolve("");
        } else {
            const img = new Image();
            img.src = screenshotUrl;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d")!;
                canvas.width = img.width;
                canvas.height = img.height;

                ctx.drawImage(img, 0, 0);
                ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

                recordedActions.forEach((action) => {
                    if (action.boundingBox) {
                        const { left, top, width, height } = action.boundingBox;
                        ctx.strokeStyle = "red";
                        ctx.lineWidth = 2;
                        ctx.strokeRect(left, top, width, height);

                        ctx.fillStyle = "red";
                        ctx.font = "bold 14px Arial";
                        var textWidth = ctx.measureText(
                            action.cssSelector,
                        ).width;

                        ctx.fillText(
                            action.cssSelector,
                            left + width - textWidth,
                            top - 5,
                        );
                    }
                });

                const annotatedScreenshot = canvas.toDataURL("image/png");
                resolve(annotatedScreenshot);
            };
        }
    });
}

async function saveRecordedActions() {
    await captureUIState();

    await chrome.runtime.sendMessage({
        type: "saveRecordedActions",
        recordedActions,
        recordedActionScreenshot,
        recordedActionHtml,
        actionIndex,
        isCurrentlyRecording: recording,
    });
}

function getCSSSelector(element: HTMLElement): string {
    if (element.id) {
        return `#${element.id}`;
    }

    let path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.tagName.toLowerCase();

        if (element.className) {
            selector += "." + element.className.trim().replace(/\s+/g, ".");
        }

        let siblingIndex = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === element.tagName) siblingIndex++;
            sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${siblingIndex})`;

        path.unshift(selector);
        element = element.parentElement!;
    }
    return path.join(" > ");
}

function getBoundingBox(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
}

function sendPaleoDbRequest(data: any) {
    document.dispatchEvent(
        new CustomEvent("toPaleoDbAutomation", { detail: data }),
    );
}

document.addEventListener("fromPaleoDbAutomation", function (e: any) {
    var message = e.detail;
    console.log("received", message);
});

async function sendUIEventsRequest(message: any) {
    return new Promise((resolve, reject) => {
        const requestId = `request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const listener = (event: MessageEvent) => {
            if (event.source !== window) return;

            const data = event.data;
            if (
                data &&
                data.type === "main-world-response" &&
                data.requestId === requestId
            ) {
                window.removeEventListener("message", listener);

                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data.result);
                }
            }
        };

        window.addEventListener("message", listener);

        // Send the message with the request ID
        window.postMessage(
            {
                type: "content-script-request",
                requestId: requestId,
                payload: message,
            },
            "*",
        );

        // Add a timeout to prevent hanging promises
        setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Request to main world timed out"));
        }, 10000);
    });
}

document.addEventListener("fromUIEventsDispatcher", async function (e: any) {
    var message = e.detail;
    console.log("received", message);
});

async function handleScriptAction(
    message: any,
    sendResponse: (response?: any) => void,
) {
    switch (message.type) {
        case "get_page_links_by_query": {
            const link = matchLinks(message.query) as HTMLAnchorElement;
            if (link && link.href) {
                sendResponse({ url: link.href });
            } else {
                sendResponse({});
            }
            break;
        }

        case "get_page_links_by_position": {
            const link = matchLinksByPostion(
                message.position,
            ) as HTMLAnchorElement;
            if (link && link.href) {
                sendResponse({ url: link.href });
            } else {
                sendResponse({});
            }
            break;
        }

        case "scroll_down_on_page": {
            window.scrollTo(0, window.scrollY + window.innerHeight * 0.9);
            sendResponse({});
            break;
        }

        case "scroll_up_on_page": {
            window.scrollTo(0, window.scrollY - window.innerHeight * 0.9);
            sendResponse({});
            break;
        }
        case "history_go_back": {
            window.history.back();

            sendResponse({});
            break;
        }
        case "history_go_forward": {
            window.history.forward();

            sendResponse({});
            break;
        }

        case "read_page_content": {
            const article = getReadablePageContent();
            sendResponse(article);
            break;
        }

        case "get_reduced_html": {
            const html = getPageHTML(
                message.fullSize,
                message.inputHtml,
                message.frameId,
                message.useTimestampIds,
            );
            sendResponse(html);
            break;
        }

        case "get_page_text": {
            const text = getPageText(message.inputHtml, message.frameId);
            sendResponse(text);
            break;
        }

        case "get_filtered_html_fragments": {
            const htmlFragments = getPageHTMLSubFragments(
                message.inputHtml,
                message.cssSelectors,
                message.frameId,
            );
            sendResponse(htmlFragments);
            break;
        }

        case "get_maxSize_html_fragments": {
            const htmlFragments = getPageHTMLFragments(
                message.inputHtml,
                message.frameId,
                message.maxFragmentSize,
                message.useTimestampIds,
            );
            sendResponse(htmlFragments);
            break;
        }

        case "get_element_bounding_boxes": {
            const boundingBoxes = getInteractiveElementsBoundingBoxes();
            sendResponse(boundingBoxes);
            break;
        }

        case "await_page_incremental_load": {
            const updated = await awaitPageIncrementalUpdates();
            sendResponse(updated);
            break;
        }

        case "run_ui_event": {
            await sendUIEventsRequest(message.action);
            sendResponse({});
            break;
        }

        case "run_paleoBioDb_action": {
            sendPaleoDbRequest(message.action);
            sendResponse({});
            break;
        }

        case "clearCrosswordPageCache": {
            const value = await localStorage.getItem("pageSchema");
            if (value) {
                localStorage.removeItem("pageSchema");
            }
            sendResponse({});
            break;
        }
        case "get_page_schema": {
            const value = localStorage.getItem("pageSchema");
            if (value) {
                sendResponse(JSON.parse(value));
            } else {
                sendResponse(null);
            }
            break;
        }
        case "set_page_schema": {
            let updatedSchema = message.action.parameters.schema;
            localStorage.setItem("pageSchema", JSON.stringify(updatedSchema));
            sendResponse({});
            break;
        }
        case "clear_page_schema": {
            const value = localStorage.getItem("pageSchema");
            if (value) {
                localStorage.removeItem("pageSchema");
            }
            sendResponse({});
            break;
        }
        case "startRecording": {
            await startRecording();
            sendResponse({});
            break;
        }
        case "stopRecording": {
            await stopRecording();
            sendResponse({
                recordedActions,
                recordedActionHtml,
                recordedActionScreenshot,
            });
            break;
        }
    }
}

function extractMicrodata(): any[] {
    const data: any[] = [];

    // Find all elements with 'itemscope' attribute (Microdata)
    document.querySelectorAll("[itemscope]").forEach((item) => {
        const schemaType = item.getAttribute("itemtype");
        const metadata: Record<string, any> = {
            "@type": schemaType || "Unknown",
        };

        item.querySelectorAll("[itemprop]").forEach((prop) => {
            const propName = prop.getAttribute("itemprop");
            let value =
                prop.getAttribute("content") || prop.textContent?.trim() || "";

            if (prop.tagName === "IMG") {
                value = (prop as HTMLImageElement).src;
            }

            if (propName) metadata[propName] = value;
        });

        data.push(metadata);
    });

    return data;
}

function extractJsonLd(): any[] {
    const jsonLdData: any[] = [];

    // Find all <script> tags with type="application/ld+json"
    document
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((script) => {
            try {
                const json = JSON.parse(script.textContent || "{}");
                jsonLdData.push(json);
            } catch (error) {
                console.error("Error parsing JSON-LD:", error);
            }
        });

    return jsonLdData;
}

chrome.runtime?.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
        const handleMessage = async () => {
            await handleScriptAction(message, sendResponse);
        };

        handleMessage();
        return true; // Important: indicates we'll send response asynchronously
    },
);

window.addEventListener(
    "message",
    async (event) => {
        if (
            event.data !== undefined &&
            event.data.source === "preload" &&
            event.data.target === "contentScript" &&
            event.data.messageType === "scriptActionRequest"
        ) {
            await handleScriptAction(event.data.body, (response) => {
                window.top?.postMessage(
                    {
                        source: "contentScript",
                        target: "preload",
                        messageType: "scriptActionResponse",
                        id: event.data.id,
                        body: response,
                    },
                    "*",
                );
            });
        }

        if (event.data.type === "GET_FILE_PATH" && event.data.fileName) {
            const fileUrl = chrome.runtime.getURL(event.data.fileName);
            window.postMessage(
                {
                    type: "FILE_PATH_RESULT",
                    result: fileUrl,
                },
                "*",
            );
        }
    },
    false,
);

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Content Script initialized");

    // Restore actions e.g. if page is refreshed
    const restoredData = await chrome.runtime.sendMessage({
        type: "getRecordedActions",
    });

    if (restoredData) {
        recordedActions = restoredData.recordedActions;
        recordedActionScreenshot = restoredData.recordedActionScreenshot;
        recordedActionHtml = restoredData.recordedActionHtml;
        if (recordedActionHtml !== undefined && recordedActionHtml.length > 0) {
            recordedHtmlIndex = recordedActionHtml.length;
        }

        actionIndex = restoredData.actionIndex ?? 0;
        recording = restoredData.isCurrentlyRecording;
    }
});

// Helper function to dispatch custom event on SPA navigation
const interceptHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    return function (this: History, ...args: any) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("spa-navigation"));
        return result;
    };
};

// Override history methods
history.pushState = interceptHistory("pushState");
history.replaceState = interceptHistory("replaceState");

// Listen for navigation events (SPA)
window.addEventListener("spa-navigation", async () => {
    console.log("SPA navigation detected!");

    // Capture page HTML before content changes
    const pageHTML = document.documentElement.outerHTML;
    console.log("Captured HTML before SPA navigation:", pageHTML);

    if (recording) {
        const screenshot = await captureAnnotatedScreenshot(lastScreenshot);
        recordedActionScreenshot.push(screenshot);
        if (lastPagehtml.length == 0) {
            lastPagehtml = getPageHTML(false, "", 0, false);
        }

        recordedActionHtml.push(lastPagehtml);
        recordedHtmlIndex = recordedActionHtml.length;
        saveRecordedActions();
    }

    // Extract both Microdata and JSON-LD
    const microdata = extractMicrodata();
    const jsonLdData = extractJsonLd();
    const structuredData = [...microdata, ...jsonLdData];

    if (structuredData.length > 0) {
        chrome.runtime.sendMessage({
            action: "microdataDetected",
            data: structuredData,
        });
        // chrome.storage.local.set({ microdata: structuredData });
        console.log(structuredData);
    }
});
