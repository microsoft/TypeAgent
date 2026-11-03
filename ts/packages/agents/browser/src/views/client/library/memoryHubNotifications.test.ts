// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    HubNotifications,
    mountMemoryHubNotifications,
} from "./memoryHubNotifications";
import { parseRoute, routeHash } from "./memoryHubModel";

test("Notifications is an Activity tab with a compatible old entry point", () => {
    const route = {
        page: "activity" as const,
        activityTab: "notifications" as const,
    };
    expect(parseRoute("#/notifications")).toEqual(route);
    expect(parseRoute("#/activity/notifications")).toEqual(route);
    expect(routeHash(route)).toBe("#/activity/notifications");
    for (const activityTab of ["jobs", "web", "changes"] as const) {
        expect(
            parseRoute(routeHash({ page: "activity", activityTab })),
        ).toEqual({
            page: "activity",
            activityTab,
        });
    }
});

test("current notices are deduplicated, replaced, and cleared by healthy results", () => {
    const store = new HubNotifications();
    const changed = jest.fn();
    store.subscribe(changed);
    const notice = {
        title: "Search",
        page: "search" as const,
        messages: [" Limited evidence ", "", "Limited evidence"],
    };
    store.set("search", notice);
    expect(store.list()[0].messages).toEqual(["Limited evidence"]);
    store.set("search", notice);
    expect(changed).toHaveBeenCalledTimes(1);
    store.set("sources", {
        ...notice,
        page: "settings",
        messages: ["Offline"],
    });
    store.set("search", { ...notice, messages: ["Missing dates"] });
    expect(store.list().map((entry) => entry.messages[0])).toEqual([
        "Missing dates",
        "Offline",
    ]);
    store.set("search", { ...notice, messages: [] });
    expect(store.has("search")).toBe(false);
    expect(store.has("sources")).toBe(true);
    const copy = store.list();
    copy[0].title = "Changed copy";
    expect(store.list()[0].title).toBe("Search");
    store.clear();
    expect(store.list()).toEqual([]);
});

test("Notifications counts current messages, links to their source, and renders text safely", () => {
    const host = document.createElement("div");
    const link = document.createElement("a");
    const store = new HubNotifications();
    const panel = mountMemoryHubNotifications(host, link, store);
    expect(host.textContent).toContain("No current notifications.");
    expect(link.getAttribute("aria-label")).toBe("Notifications");
    expect(link.querySelector("span")!.hidden).toBe(true);
    store.set("search", {
        title: "Ask or Explain",
        page: "search",
        context: "Question about Alpha",
        messages: ["<img src=x onerror=alert(1)>", "Missing event dates"],
    });
    expect(link.getAttribute("aria-label")).toBe("Notifications (2)");
    expect(link.querySelector("span")!.hidden).toBe(false);
    expect(host.querySelector("article a")!.getAttribute("href")).toBe(
        "#/search",
    );
    expect(host.textContent).toContain("Question about Alpha");
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(host.querySelector("img")).toBeNull();
    store.clear();
    expect(link.getAttribute("aria-label")).toBe("Notifications");
    expect(host.querySelectorAll("article")).toHaveLength(0);
    expect(host.textContent).toContain("No current notifications.");
    panel.dispose();
});

test("disposed notification renderers stop subscribing", () => {
    const store = new HubNotifications();
    const host = document.createElement("div");
    const link = document.createElement("a");
    const panel = mountMemoryHubNotifications(host, link, store);
    panel.dispose();
    store.set("search", {
        title: "Search",
        page: "search",
        messages: ["Late notice"],
    });
    expect(host.textContent).not.toContain("Late notice");
});
