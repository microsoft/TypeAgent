// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Intercepts the specified history method to detect SPA navigation
 * @param method The method to intercept
 * @returns The intercepted method
 */
export function interceptHistory(method: "pushState" | "replaceState"): any {
    const original = history[method];
    return function (this: History, ...args: any) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("spa-navigation"));
        return result;
    };
}

/**
 * Handles SPA navigation events
 * @param callback The callback to call when a SPA navigation occurs
 * @returns The event listener cleanup function
 */
export function handleSpaNavigation(callback: () => void): () => void {
    const handleNavigation = () => {
        console.log("SPA navigation detected!");
        callback();
    };

    window.addEventListener("spa-navigation", handleNavigation);

    // Return a cleanup function
    return () => {
        window.removeEventListener("spa-navigation", handleNavigation);
    };
}
