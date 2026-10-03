// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { invokeView } from "./viewClient";

const graphStatus = z.object({
    hasGraph: z.boolean(),
    entityCount: z.number().int().nonnegative(),
    relationshipCount: z.number().int().nonnegative(),
    communityCount: z.number().int().nonnegative(),
    isBuilding: z.boolean(),
    error: z.string().optional(),
});
const graphOutcome = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
});

export function mountMemoryHubWebMaintenance(
    host: HTMLElement,
    options: { onError: (error: unknown) => void; onOpenGraph: () => void },
) {
    const root = document.createElement("section");
    root.className = "card";
    root.setAttribute("aria-label", "Browser knowledge graph maintenance");
    const heading = document.createElement("h3");
    heading.textContent = "Browser knowledge graph";
    const scope = document.createElement("p");
    scope.textContent =
        "These operations rebuild derived graphs for TypeAgent Browser Memory only, not the selected corpus. They do not delete captured sources or execute a Runbook.";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Open Settings to check graph status.";
    const metrics = document.createElement("p");
    const controls = document.createElement("div");
    controls.className = "hub-controls";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh browser graph status";
    const build = document.createElement("button");
    build.type = "button";
    build.textContent = "Build browser graph";
    const rebuild = document.createElement("button");
    rebuild.type = "button";
    rebuild.textContent = "Rebuild browser graph";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Explore browser entity graph";
    open.addEventListener("click", options.onOpenGraph);
    controls.append(refresh, build, rebuild, open);
    root.append(heading, scope, status, metrics, controls);
    host.append(root);
    let version = 0;
    let disposed = false;
    let busy = false;
    let available = false;
    let building = false;

    function updateControls() {
        refresh.disabled = busy;
        build.disabled = rebuild.disabled = busy || !available || building;
        open.disabled = busy || !available;
    }
    function fail(error: unknown) {
        available = false;
        metrics.textContent = "";
        status.textContent = `Browser graph unavailable: ${error instanceof Error ? error.message : String(error)}`;
        options.onError(error);
    }
    async function readStatus(requestVersion: number) {
        const raw: unknown = await invokeView("getKnowledgeGraphStatus", {});
        const result = graphStatus.parse(raw);
        if (result.error) throw new Error(result.error);
        if (disposed || requestVersion !== version) return;
        available = true;
        building = result.isBuilding;
        status.textContent = result.isBuilding
            ? "Browser graph build is in progress; this is not a completion result."
            : result.hasGraph
              ? "Browser graph is ready."
              : "No browser knowledge graph is available yet.";
        metrics.textContent = `${result.entityCount} entities · ${result.relationshipCount} relationships · ${result.communityCount} communities`;
    }
    async function show() {
        if (disposed || busy) return;
        const requestVersion = ++version;
        busy = true;
        status.textContent = "Checking browser graph status…";
        updateControls();
        try {
            await readStatus(requestVersion);
        } catch (error) {
            if (!disposed && requestVersion === version) fail(error);
        } finally {
            if (!disposed && requestVersion === version) {
                busy = false;
                updateControls();
            }
        }
    }
    async function change(
        method: "buildKnowledgeGraph" | "rebuildKnowledgeGraph",
    ) {
        if (disposed || busy || !available || building) return;
        if (
            !window.confirm(
                "Rebuild derived browser knowledge graphs? Captured sources remain unchanged; no Runbook or tool will execute.",
            )
        )
            return;
        const requestVersion = ++version;
        busy = true;
        status.textContent = "Waiting for the browser graph service…";
        updateControls();
        try {
            const raw: unknown = await invokeView(method, {});
            const result = graphOutcome.parse(raw);
            if (!result.success || result.error) {
                throw new Error(
                    result.error ?? "Browser graph operation did not succeed",
                );
            }
            if (disposed || requestVersion !== version) return;
            await readStatus(requestVersion);
        } catch (error) {
            if (!disposed && requestVersion === version) fail(error);
        } finally {
            if (!disposed && requestVersion === version) {
                busy = false;
                updateControls();
            }
        }
    }
    refresh.addEventListener("click", () => void show());
    build.addEventListener("click", () => void change("buildKnowledgeGraph"));
    rebuild.addEventListener(
        "click",
        () => void change("rebuildKnowledgeGraph"),
    );
    updateControls();
    return {
        show,
        hide() {
            version++;
            busy = false;
            updateControls();
        },
        dispose() {
            disposed = true;
            version++;
            root.remove();
        },
    };
}
