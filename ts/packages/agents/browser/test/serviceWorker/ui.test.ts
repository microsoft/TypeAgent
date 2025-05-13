/// <reference path="../types/jest-chrome-extensions.d.ts" />

const {
    showBadgeError,
    showBadgeHealthy,
    showBadgeBusy,
} = require("../../src/extension/serviceWorker/ui");

describe("UI Module", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        chrome.action.setBadgeBackgroundColor.mockClear();
        chrome.action.setBadgeText.mockClear();
    });

    describe("showBadgeError", () => {
        it('should set badge background color to red and text to "!"', () => {
            showBadgeError();

            // Check that setBadgeBackgroundColor was called with the right color
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
                color: "#F00",
            });

            // Check that setBadgeText was called with the right text
            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
                text: "!",
            });
        });
    });

    describe("showBadgeHealthy", () => {
        it("should clear the badge text", () => {
            showBadgeHealthy();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
                text: "",
            });
        });
    });

    describe("showBadgeBusy", () => {
        it('should set badge background color to blue and text to "..."', () => {
            showBadgeBusy();

            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({
                color: "#0000FF",
            });
            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
                text: "...",
            });
        });
    });
});
