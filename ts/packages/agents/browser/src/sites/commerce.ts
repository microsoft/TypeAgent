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

async function enterTextInElement(text: string, selector: string) {
    const targetElement = document.querySelector(selector) as HTMLElement;
    if (targetElement) {
        if (targetElement instanceof HTMLInputElement) {
            targetElement.value = text;
        } else {
            for (var i = 0; i < text.length; i++) {
                simulateKeyEvent(targetElement, text[i]);
                await new Promise((r) => setTimeout(r, 20));
            }
        }
    }
}

function submitElement(selector: string) {
    const targetElement = document.querySelector(selector) as HTMLDivElement;
    if (targetElement) {
        function triggerKeyboardEvent(
            targetNode: HTMLElement,
            eventType: string,
        ) {
            var keyEvent = new KeyboardEvent(eventType, {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                keyCode: 13,
            });

            targetNode.dispatchEvent(keyEvent);
        }
        ["keydown", "keypress", "keyup"].forEach(function (eventType) {
            triggerKeyboardEvent(targetElement, eventType);
        });
    }
}

function sendDataToContentScript(data: any) {
    document.dispatchEvent(
        new CustomEvent("fromCommerceAutomation", { detail: data }),
    );
}

document.addEventListener("toCommerceAutomation", async function (e: any) {
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
        await enterTextInElement(
            message.parameters.value,
            escapeCssSelector(message.parameters.cssSelector),
        );
    }
    if (actionName === "submitTextBox") {
        await submitElement(escapeCssSelector(message.parameters.cssSelector));
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Commerce Script initialized");
});
