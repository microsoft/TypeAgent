// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    browserViews,
    getBrowserViewName,
    getBrowserViewUrl,
    parseBrowserViewUrl,
    resolveBrowserViewUrl,
    getBrowserViewLink,
    getDiscoveredViewHostUrl,
    isHostedBrowserView,
} from "../../browserControlRpc/src/viewRoutes";

describe("browser view routes", () => {
    test.each(Object.keys(browserViews))(
        "resolves alias %s case-insensitively",
        (name) => {
            expect(getBrowserViewName(name.toUpperCase())).toBe(name);
            expect(getBrowserViewName(name)).toBe(name);
        },
    );

    test("supports friendly aliases without claiming ordinary sites", () => {
        expect(getBrowserViewName("Memory Center")).toBe("memoryCenter");
        expect(getBrowserViewName("Action Library")).toBe("macrosLibrary");
        expect(getBrowserViewName("entityGraphView")).toBe("entityGraph");
        expect(getBrowserViewName("example.com")).toBeUndefined();
    });

    test("preserves encoded deep links and fragments", () => {
        const legacy =
            "typeagent-browser://views/entityGraphView.html?entity=A%26B%20%2F%20C#detail";
        expect(resolveBrowserViewUrl(legacy, "http://localhost:49152")).toBe(
            "http://localhost:49152/knowledge/entities/?entity=A%26B%20%2F%20C#detail",
        );
        expect(parseBrowserViewUrl(legacy)?.name).toBe("entityGraph");
    });

    test("supports historical hostname-only URLs", () => {
        expect(
            resolveBrowserViewUrl(
                "typeagent-browser://knowledgeLibrary.html",
                "http://localhost:49153",
            ),
        ).toBe("http://localhost:49153/knowledge/");
    });

    test("uses the supplied live port instead of a cached host", () => {
        expect(
            getBrowserViewUrl("http://localhost:49152", "memoryCenter"),
        ).toBe("http://localhost:49152/memory/");
        expect(
            getBrowserViewUrl("http://localhost:49153", "memoryCenter"),
        ).toBe("http://localhost:49153/memory/");
    });

    test("rejects unavailable hosts and unknown custom routes", () => {
        expect(() =>
            getBrowserViewUrl("http://localhost:0", "memoryCenter"),
        ).toThrow(/unavailable/);
        expect(() =>
            getBrowserViewUrl("javascript:alert(1)", "memoryCenter"),
        ).toThrow();
        expect(() =>
            parseBrowserViewUrl("typeagent-browser://views/options.html"),
        ).toThrow(/Unknown browser view/);
        expect(() =>
            parseBrowserViewUrl(
                "typeagent-browser://untrusted/knowledgeLibrary.html",
            ),
        ).toThrow(/Unknown browser view/);
    });

    test("passes normal web navigation through unchanged", () => {
        expect(
            resolveBrowserViewUrl(
                "https://example.com/?q=test",
                "http://localhost:1",
            ),
        ).toBe("https://example.com/?q=test");
    });

    test("builds logical graph links from the shared registry", () => {
        expect(
            getBrowserViewLink("topicGraph", "?topic=A%26B", "#detail"),
        ).toBe(
            "typeagent-browser://views/topicGraphView.html?topic=A%26B#detail",
        );
    });

    test("identifies owned pages without excluding unrelated localhost sites", () => {
        const host = "http://localhost:49152";
        expect(isHostedBrowserView(`${host}/memory/?tab=sources`, host)).toBe(
            true,
        );
        expect(
            isHostedBrowserView(`${host}/library/entityGraphView.html`, host),
        ).toBe(true);
        expect(isHostedBrowserView(`${host}/news/`, host)).toBe(false);
        expect(
            isHostedBrowserView("http://localhost:49153/memory/", host),
        ).toBe(false);
    });

    test("derives HTTP view hosts from discovery without losing IPv6 or HTTPS", () => {
        expect(
            getDiscoveredViewHostUrl("ws://localhost:8999/path?q=test", 49152),
        ).toBe("http://localhost:49152/");
        expect(getDiscoveredViewHostUrl("wss://[::1]:8999/", 49152)).toBe(
            "https://[::1]:49152/",
        );
        expect(
            getDiscoveredViewHostUrl(
                "ws://localhost:8999",
                49152,
                "https://example.test/view/",
            ),
        ).toBe("https://example.test/view/");
        expect(() =>
            getDiscoveredViewHostUrl("ws://localhost:8999", 0),
        ).toThrow(/unavailable/);
    });
});
