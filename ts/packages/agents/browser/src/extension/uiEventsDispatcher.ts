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

function enterTextInElement(
    text: string,
    selector: string,
    options: {
        delay?: number; // Delay between keystrokes in ms
        clearExisting?: boolean; // Whether to clear existing content first
        triggerBlur?: boolean; // Whether to trigger blur event after typing
        triggerSubmit?: boolean; // Whether to trigger form submit after typing
        enterAtPageScope?: boolean; // whether to enter the text in whatever the document.activeElement is
    } = {},
): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            // Default options
            const config = {
                delay: options.delay ?? 50,
                clearExisting: options.clearExisting ?? false,
                triggerBlur: options.triggerBlur ?? false,
                triggerSubmit: options.triggerSubmit ?? false,
                enterAtPageScope: options.enterAtPageScope ?? false,
            };

            let inputElement = config.enterAtPageScope
                ? (document.activeElement as HTMLElement)
                : (document.querySelector(selector) as HTMLElement);

            if (inputElement == undefined) {
                inputElement = document.body;
                config.enterAtPageScope = true;
            }

            // Check if inputElement is an input or textarea
            if (
                !(inputElement instanceof HTMLInputElement) &&
                !(inputElement instanceof HTMLTextAreaElement) &&
                !inputElement.isContentEditable
            ) {
                // fall back to page-level scope
                if (
                    document.activeElement instanceof HTMLInputElement ||
                    document.activeElement instanceof HTMLTextAreaElement ||
                    inputElement.isContentEditable
                ) {
                    inputElement = document.activeElement as HTMLElement;
                } else {
                    inputElement = document.body;
                }

                config.enterAtPageScope = true;
            }

            inputElement.focus();

            if (config.clearExisting) {
                if (
                    inputElement instanceof HTMLInputElement ||
                    inputElement instanceof HTMLTextAreaElement
                ) {
                    inputElement.value = "";
                    const inputEvent = new Event("input", { bubbles: true });
                    inputElement.dispatchEvent(inputEvent);
                } else if (inputElement.isContentEditable) {
                    inputElement.textContent = "";
                }
            }

            // Function to simulate typing a single character
            const typeCharacter = (char: string, index: number) => {
                setTimeout(() => {
                    simulateKeyEvent(inputElement, char);

                    // Check if we're done typing
                    if (index === text.length - 1) {
                        // Handle additional actions after typing
                        if (config.triggerBlur) {
                            inputElement.blur();
                        }

                        if (config.triggerSubmit) {
                            // Find the parent form and submit it
                            const form = inputElement.closest("form");
                            if (form) {
                                form.dispatchEvent(
                                    new Event("submit", {
                                        bubbles: true,
                                        cancelable: true,
                                    }),
                                );
                            }
                        }

                        resolve();
                    }
                }, index * config.delay);
            };

            // Type each character with delay
            Array.from(text).forEach((char, index) => {
                typeCharacter(char, index);
            });
        } catch (error) {
            reject(error);
        }
    });
}

function simulateKeyEvent(inputElement: HTMLElement, char: string) {
    const keydownEvent = new KeyboardEvent("keydown", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true,
    });
    inputElement.dispatchEvent(keydownEvent);

    const keypressEvent = new KeyboardEvent("keypress", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true,
    });
    inputElement.dispatchEvent(keypressEvent);

    const textInputEvent = new InputEvent("textInput", {
        data: char,
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
    });
    inputElement.dispatchEvent(textInputEvent);

    if (
        (inputElement instanceof HTMLInputElement ||
            inputElement instanceof HTMLTextAreaElement) &&
        inputElement.type !== "hidden"
    ) {
        // Get current position of cursor
        const startPos = inputElement.selectionStart || 0;
        const endPos = inputElement.selectionEnd || 0;

        // If text is selected, replace it
        if (startPos !== endPos) {
            inputElement.value =
                inputElement.value.substring(0, startPos) +
                char +
                inputElement.value.substring(endPos);

            // Set cursor position after the inserted character
            inputElement.selectionStart = inputElement.selectionEnd =
                startPos + 1;
        } else {
            // Just insert at current position
            inputElement.value =
                inputElement.value.substring(0, startPos) +
                char +
                inputElement.value.substring(startPos);

            // Move cursor forward
            inputElement.selectionStart = inputElement.selectionEnd =
                startPos + 1;
        }
    } else if (inputElement.isContentEditable) {
        // For contenteditable elements
        // Get current selection
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);

        if (selection && range) {
            // Delete any selected content
            range.deleteContents();

            // Insert the character
            const textNode = document.createTextNode(char);
            range.insertNode(textNode);

            // Move cursor after inserted character
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    const inputEvent = new InputEvent("input", {
        inputType: "insertText",
        data: char,
        bubbles: true,
        cancelable: true,
    });
    inputElement.dispatchEvent(inputEvent);

    const keyupEvent = new KeyboardEvent("keyup", {
        key: char,
        code: `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true,
    });
    inputElement.dispatchEvent(keyupEvent);
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

async function selectDropdownOption(selector: string, optionLabel: string) {
    const select = document.querySelector(selector) as HTMLSelectElement;
    if (!select) {
        console.error("Select element not found");
        return null;
    }

    const options = Array.from(select.querySelectorAll("option"));
    const matchingOption = options.find(
        (opt) => opt.textContent?.trim() === optionLabel,
    );

    if (matchingOption) {
        // Set the value programmatically
        (select as HTMLSelectElement).value = matchingOption.value;

        // Dispatch change and input events to trigger handlers
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("input", { bubbles: true }));

        await new Promise((r) => setTimeout(r, 20));
    }
}

window.addEventListener("message", async (event: any) => {
    const data = event.data;

    // Check if this is a request from our content script
    if (data && data.type === "content-script-request") {
        const { requestId, payload } = data;

        try {
            var message = payload;
            console.log("received", message);
            const actionName =
                message.actionName ?? message.fullActionName.split(".").at(-1);

            if (actionName === "clickOnElement") {
                clickOnElement(
                    escapeCssSelector(message.parameters.cssSelector),
                );
            }
            if (actionName === "enterTextInElement") {
                await enterTextInElement(
                    message.parameters.value,
                    escapeCssSelector(message.parameters.cssSelector),
                    {
                        delay: 20,
                        clearExisting: true,
                        triggerBlur: true,
                        triggerSubmit: message.parameters.submitForm ?? false,
                    },
                );
            }
            if (actionName === "enterTextOnPage") {
                // await enterTextOnPage(message.parameters.value.toUpperCase());
                await enterTextInElement(message.parameters.value, "body", {
                    delay: 20,
                    clearExisting: true,
                    triggerBlur: true,
                    triggerSubmit: message.parameters.submitForm ?? false,
                    enterAtPageScope: true,
                });
            }
            if (actionName === "setDropdownValue") {
                await selectDropdownOption(
                    escapeCssSelector(message.parameters.cssSelector),
                    message.parameters.optionLabel,
                );
            }

            window.postMessage(
                {
                    type: "main-world-response",
                    requestId: requestId,
                    result: {},
                },
                "*",
            );
        } catch (error) {
            // Send error back
            window.postMessage(
                {
                    type: "main-world-response",
                    requestId: requestId,
                    error: error,
                },
                "*",
            );
        }
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    console.log("UI Events Script initialized");
});
