import {
    showBadgeError,
    showBadgeHealthy,
    showBadgeBusy,
} from "../../src/extension/serviceWorker/ui";

describe("UI Module", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        chrome.action.setBadgeBackgroundColor.mockClear();
        chrome.action.setBadgeText.mockClear();
    });

    describe("showBadgeError", () => {
        it('should set badge background color to red and text to "!"', () => {
            showBadgeError();

            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
                { color: "#F00" },
                expect.any(Function),
            );

            // Trigger the callback directly to simulate Chrome API behavior
            const callback =
                chrome.action.setBadgeBackgroundColor.mock.calls[0][1];
            if (callback) callback();

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

            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
                { color: "#0000FF" },
                expect.any(Function),
            );

            // Find the callback function that was passed
            const callback =
                chrome.action.setBadgeBackgroundColor.mock.calls[0][1];

            // Call the callback to simulate completion
            if (callback) callback();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
                text: "...",
            });
        });
    });
});
