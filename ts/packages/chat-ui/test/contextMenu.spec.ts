// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    describe,
    it,
    expect,
    afterEach,
    beforeEach,
    jest,
} from "@jest/globals";
import { handleClipboardShortcut } from "../src/contextMenu.js";

// handleClipboardShortcut restores keyboard copy/cut in hosts (VS Code
// webviews) where the native Ctrl/Cmd+C|X doesn't act on the DOM
// selection. These tests run under jsdom (see jest.config.cjs) and mock
// the clipboard write since jsdom has no real clipboard.

function keyEvent(
    key: string,
    mods: {
        ctrlKey?: boolean;
        metaKey?: boolean;
        altKey?: boolean;
        shiftKey?: boolean;
    } = {},
): KeyboardEvent {
    return new KeyboardEvent("keydown", {
        key,
        cancelable: true,
        bubbles: true,
        ...mods,
    });
}

let writeText: ReturnType<typeof jest.fn>;

beforeEach(() => {
    writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
    });
});

afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
});

describe("handleClipboardShortcut", () => {
    it("ignores keys that are not copy/cut shortcuts", () => {
        expect(handleClipboardShortcut(keyEvent("a", { ctrlKey: true }))).toBe(
            false,
        );
        expect(handleClipboardShortcut(keyEvent("v", { ctrlKey: true }))).toBe(
            false,
        );
        expect(writeText).not.toHaveBeenCalled();
    });

    it("ignores C without ctrl or meta", () => {
        expect(handleClipboardShortcut(keyEvent("c"))).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("ignores shift chords such as Ctrl+Shift+C", () => {
        jest.spyOn(window, "getSelection").mockReturnValue({
            toString: () => "text",
            anchorNode: document.body,
            rangeCount: 1,
        } as unknown as Selection);
        expect(
            handleClipboardShortcut(
                keyEvent("c", { ctrlKey: true, shiftKey: true }),
            ),
        ).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("ignores an already-consumed event", () => {
        const e = keyEvent("c", { ctrlKey: true });
        e.preventDefault();
        expect(handleClipboardShortcut(e)).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it("copies the document selection on Ctrl+C", () => {
        const div = document.createElement("div");
        div.textContent = "history text";
        document.body.appendChild(div);
        jest.spyOn(window, "getSelection").mockReturnValue({
            toString: () => "history text",
            anchorNode: div.firstChild,
            rangeCount: 1,
        } as unknown as Selection);

        expect(handleClipboardShortcut(keyEvent("c", { ctrlKey: true }))).toBe(
            true,
        );
        expect(writeText).toHaveBeenCalledWith("history text");
    });

    it("copies the document selection on Cmd+C (meta)", () => {
        jest.spyOn(window, "getSelection").mockReturnValue({
            toString: () => "mac text",
            anchorNode: document.body,
            rangeCount: 1,
        } as unknown as Selection);

        expect(handleClipboardShortcut(keyEvent("c", { metaKey: true }))).toBe(
            true,
        );
        expect(writeText).toHaveBeenCalledWith("mac text");
    });

    it("does nothing when the selection is empty", () => {
        jest.spyOn(window, "getSelection").mockReturnValue({
            toString: () => "",
            anchorNode: null,
            rangeCount: 0,
        } as unknown as Selection);

        expect(handleClipboardShortcut(keyEvent("c", { ctrlKey: true }))).toBe(
            false,
        );
        expect(writeText).not.toHaveBeenCalled();
    });

    it("copies the selection from a focused input without mutating it", () => {
        const input = document.createElement("input");
        input.value = "abcdef";
        document.body.appendChild(input);
        input.focus();
        input.setSelectionRange(1, 4); // "bcd"

        expect(handleClipboardShortcut(keyEvent("c", { ctrlKey: true }))).toBe(
            true,
        );
        expect(writeText).toHaveBeenCalledWith("bcd");
        expect(input.value).toBe("abcdef");
    });

    it("cuts the selection from a focused textarea and fires input", () => {
        const ta = document.createElement("textarea");
        ta.value = "abcdef";
        document.body.appendChild(ta);
        ta.focus();
        ta.setSelectionRange(1, 4); // "bcd"
        const inputEvents = jest.fn();
        ta.addEventListener("input", inputEvents);

        expect(handleClipboardShortcut(keyEvent("x", { ctrlKey: true }))).toBe(
            true,
        );
        expect(writeText).toHaveBeenCalledWith("bcd");
        expect(ta.value).toBe("aef");
        expect(inputEvents).toHaveBeenCalledTimes(1);
    });

    it("does not cut from a read-only input", () => {
        const input = document.createElement("input");
        input.value = "abcdef";
        input.readOnly = true;
        document.body.appendChild(input);
        input.focus();
        input.setSelectionRange(1, 4);

        expect(handleClipboardShortcut(keyEvent("x", { ctrlKey: true }))).toBe(
            true,
        );
        expect(writeText).toHaveBeenCalledWith("bcd");
        expect(input.value).toBe("abcdef");
    });
});
