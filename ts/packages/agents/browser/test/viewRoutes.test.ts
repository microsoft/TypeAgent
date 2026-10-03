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
    getRetiredBrowserViewHash,
} from "../../browserControlRpc/src/viewRoutes";

describe("browser view routes", () => {
    test("legacy selections migrate to explicit Hub sections and browser-only graph views", () => {
        expect(getRetiredBrowserViewHash("memoryCenter")).toBe("#/inbox");
        expect(getRetiredBrowserViewHash("memoryCenter", "", "#sources")).toBe(
            "#/library",
        );
        expect(
            getRetiredBrowserViewHash("knowledgeLibrary", "?query=Worker"),
        ).toBe("#/search");
        expect(
            getRetiredBrowserViewHash("knowledgeLibrary", "", "#analytics"),
        ).toBe("#/explore/web/analytics");
        expect(
            getRetiredBrowserViewHash("entityGraph", "?entity=A%26B%20%2F%20C"),
        ).toBe("#/explore/web/entities/A%26B%20%2F%20C");
        expect(getRetiredBrowserViewHash("topicGraph", "?topic=A%26B")).toBe(
            "#/explore/web/topics/A%26B",
        );
        expect(
            getRetiredBrowserViewHash(
                "entityGraph",
                "?entity=old",
                "#/explore/web/entities/new",
            ),
        ).toBe("#/explore/web/entities/new");
    });
    test.each(Object.keys(browserViews))(
        "resolves alias %s case-insensitively",
        (name) => {
            expect(getBrowserViewName(name.toUpperCase())).toBe(name);
            expect(getBrowserViewName(name)).toBe(name);
        },
    );

    test("supports friendly aliases without claiming ordinary sites", () => {
        expect(getBrowserViewName("Memory")).toBe("memoryHub");
        expect(getBrowserViewName("MEMORY")).toBe("memoryHub");
        expect(getBrowserViewName("Memory Hub")).toBe("memoryHub");
        expect(getBrowserViewName("memory-hub")).toBe("memoryHub");
        expect(getBrowserViewName("memory_hub")).toBe("memoryHub");
        expect(getBrowserViewName("Memory Center")).toBe("memoryCenter");
        expect(getBrowserViewName("Knowledge Library")).toBe(
            "knowledgeLibrary",
        );
        expect(getBrowserViewName("Action Library")).toBe("automationsLibrary");
        expect(getBrowserViewName("Automations")).toBe("automationsLibrary");
        expect(getBrowserViewName("entityGraphView")).toBe("entityGraph");
        expect(getBrowserViewName("example.com")).toBeUndefined();
    });

    test.each([
        ["memoryHub", "/memory/hub/", "memoryHub.html", ""],
        ["memoryCenter", "/memory/", "memoryCenter.html", "#/inbox"],
        [
            "knowledgeLibrary",
            "/knowledge/",
            "knowledgeLibrary.html",
            "#/search",
        ],
    ] as const)(
        "recognizes %s and emits its current destination",
        (name, path, page, hash) => {
            const host = "http://localhost:49152";
            expect(browserViews[name]).toEqual({ path, page });
            expect(getBrowserViewUrl(host, name)).toBe(
                `${host}/memory/hub/${hash}`,
            );
            expect(getBrowserViewLink(name)).toBe(
                `typeagent-browser://views/memoryHub.html${hash}`,
            );
            expect(isHostedBrowserView(`${host}${path}`, host)).toBe(true);
            expect(isHostedBrowserView(`${host}/library/${page}`, host)).toBe(
                true,
            );
        },
    );

    test.each([
        ["memoryHub.html", "#detail%2Fpart%20one"],
        ["memoryCenter.html", "#/inbox"],
        ["knowledgeLibrary.html", "#/search"],
    ])("preserves encoded query state while migrating %s", (page, hash) => {
        const suffix =
            "?q=A%26B%20%2F%20C&source=one%2Btwo#detail%2Fpart%20one";
        for (const prefix of [
            "typeagent-browser://views/",
            "typeagent-browser://",
        ]) {
            expect(
                resolveBrowserViewUrl(
                    `${prefix}${page}${suffix}`,
                    "https://example.test:49152/",
                ),
            ).toBe(
                `https://example.test:49152/memory/hub/?q=A%26B%20%2F%20C&source=one%2Btwo${hash}`,
            );
        }
    });

    test("preserves encoded deep links and fragments", () => {
        const legacy =
            "typeagent-browser://views/entityGraphView.html?entity=A%26B%20%2F%20C#detail";
        expect(resolveBrowserViewUrl(legacy, "http://localhost:49152")).toBe(
            "http://localhost:49152/memory/hub/?entity=A%26B%20%2F%20C#/explore/web/entities/A%26B%20%2F%20C",
        );
        expect(parseBrowserViewUrl(legacy)?.name).toBe("entityGraph");
    });

    test("supports historical hostname-only URLs", () => {
        expect(
            resolveBrowserViewUrl(
                "typeagent-browser://knowledgeLibrary.html",
                "http://localhost:49153",
            ),
        ).toBe("http://localhost:49153/memory/hub/#/search");
    });

    test("uses the supplied live port instead of a cached host", () => {
        expect(
            getBrowserViewUrl("http://localhost:49152", "memoryCenter"),
        ).toBe("http://localhost:49152/memory/hub/#/inbox");
        expect(
            getBrowserViewUrl("http://localhost:49153", "memoryCenter"),
        ).toBe("http://localhost:49153/memory/hub/#/inbox");
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
                "https://example.com/?q=A%26B%20%2F%20C#detail%2Fpart",
                "http://localhost:1",
            ),
        ).toBe("https://example.com/?q=A%26B%20%2F%20C#detail%2Fpart");
    });

    test("builds logical graph links from the shared registry", () => {
        expect(
            getBrowserViewLink("topicGraph", "?topic=A%26B", "#detail"),
        ).toBe(
            "typeagent-browser://views/memoryHub.html?topic=A%26B#/explore/web/topics/A%26B",
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
