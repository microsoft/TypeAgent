// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

function escapeCssSelector(selector: string) {
    let prefix = "";
    let suffix = "";
    if (selector.charAt(0) == "#") {
        prefix = "#";
        suffix = selector.substring(1);
    } else {
        suffix = selector;
    }

    suffix = CSS.escape(suffix);
    return prefix + suffix;
}

function simulateMouseClick(targetNode: HTMLElement) {
    function triggerMouseEvent(targetNode: HTMLElement, eventType: string) {
        let clickEvent = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
        });
        targetNode.dispatchEvent(clickEvent);
    }
    ["mouseover", "mousedown", "mouseup", "click"].forEach(
        function (eventType) {
            triggerMouseEvent(targetNode, eventType);
        },
    );
}

function clickOnCell(selector: string) {
    const targetElement = document.querySelector(selector) as HTMLDivElement;
    if (targetElement) {
        simulateMouseClick(targetElement);
    }
}

function simulateKeyEvent(targetNode: HTMLElement, character: string) {
    function triggerKeyboardEvent(targetNode: HTMLElement, eventType: string) {
        var keyEvent = new KeyboardEvent(eventType, {
            key: character,
            code: `Key${character.toUpperCase()}`,
            bubbles: true,
            keyCode: character.charCodeAt(0),
        });

        targetNode.dispatchEvent(keyEvent);
    }
    ["keydown", "keypress", "keyup"].forEach(function (eventType) {
        triggerKeyboardEvent(targetNode, eventType);
    });
}

function enterLetterInCell(letter: string, selector: string) {
    const targetElement = document.querySelector(selector) as HTMLDivElement;

    if (targetElement) {
        const position = targetElement.getBoundingClientRect();

        simulateMouseClick(targetElement);
        const activeElement = document.elementFromPoint(
            position.x,
            position.y,
        ) as HTMLElement;
        if (activeElement) {
            simulateKeyEvent(activeElement, letter);
        }
    }
}

function enterTextInCells(text: string, selectors: string[]) {
    for (var i = 0; i < Math.min(text.length, selectors.length); i++) {
        enterLetterInCell(text[i], selectors[i]);
    }
}

async function enterTextOnPage(text: string) {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement) {
        for (var i = 0; i < text.length; i++) {
            simulateKeyEvent(activeElement, text[i]);
            await new Promise((r) => setTimeout(r, 20));
        }
    }
}

function sendDataToContentScript(data: any) {
    document.dispatchEvent(
        new CustomEvent("fromCrosswordAutomation", { detail: data }),
    );
}

document.addEventListener("toCrosswordAutomation", async function (e: any) {
    var message = e.detail;
    console.log("received", message);
    const actionName =
        message.actionName ?? message.fullActionName.split(".").at(-1);

    if (actionName === "initialize") {
        // await initializeCrosswordPage();
    }

    if (actionName === "clickOnElement") {
        clickOnCell(escapeCssSelector(message.parameters.cssSelector));
    }
    if (actionName === "enterText") {
        await enterTextOnPage(message.parameters.value.toUpperCase());
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Crossword Script initialized");
});
