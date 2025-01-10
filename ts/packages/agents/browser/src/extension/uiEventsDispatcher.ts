// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {};

function escapeCssSelector(selector: string) {
    let prefix = "";
    let suffix = "";
    if (selector.startsWith("#id_")) {
        return selector;
    }

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

function clickOnElement(selector: string) {
    const targetElement = document.querySelector(selector) as HTMLElement;
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

function enterLetterInElement(letter: string, selector: string) {
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
        targetElement.focus();
        if (!document.execCommand("insertText", false, text)) {
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
}

function sendDataToContentScript(data: any) {
    document.dispatchEvent(
        new CustomEvent("fromUIEventsDispatcher", { detail: data }),
    );
}

document.addEventListener("toUIEventsDispatcher", async function (e: any) {
    var message = e.detail;
    console.log("received", message);
    const actionName =
        message.actionName ?? message.fullActionName.split(".").at(-1);

    if (actionName === "clickOnElement") {
        clickOnElement(escapeCssSelector(message.parameters.cssSelector));
    }
    if (actionName === "enterTextInElement") {
        await enterTextInElement(
            message.parameters.value,
            escapeCssSelector(message.parameters.cssSelector),
        );
    }
    if (actionName === "enterTextOnPage") {
        await enterTextOnPage(message.parameters.value.toUpperCase());
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    console.log("UI Events Script initialized");
});
