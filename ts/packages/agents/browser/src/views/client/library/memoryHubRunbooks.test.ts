// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentEdition,
    ProcedureCandidate,
    ProcedureVersion,
} from "@typeagent/memory-service";
import type {
    RunbookDetail,
    RunbookDetailRequest,
    RunbookOriginal,
    RunbookSkill,
    RunbookSummary,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mountMemoryHubRunbooks } from "./memoryHubRunbooks";
import { controlledRunbookImage } from "./memoryHubRunbookOriginals";
import { serialize, deserialize } from "node:v8";
import { TextEncoder } from "node:util";
import type { RunbookBindingArguments } from "@typeagent/memory-service/agent-edition-validation";

const mockView = jest.fn<Promise<unknown>, [string, unknown]>();
const mockMemory = jest.fn<Promise<unknown>, [string, unknown]>();
jest.mock("./viewClient", () => ({
    invokeView: (method: string, request: unknown) => mockView(method, request),
    invokeMemory: (method: string, request: unknown) =>
        mockMemory(method, request),
}));
jest.mock("./memoryHubRunbooks.css", () => ({}));

const citation = {
    sourceId: "source-shared",
    revisionId: "revision-original",
    locator: "chars:7:12",
    excerpt: "cited",
};
const actualMcpId = JSON.stringify(["server", "tool"]);
const actualMcpFingerprint = "b".repeat(64);
function edition(version = 3): AgentEdition {
    return {
        schemaVersion: 1,
        goal: "Safely update the configuration",
        applicability: ["When an operator requests it"],
        preconditions: ["Have approval"],
        inputs: [
            {
                id: "name",
                description: "Configuration name",
                type: "string",
                required: true,
                secret: false,
            },
        ],
        steps: [
            {
                id: "stable-step",
                title: "Update",
                humanText: "Review then update",
                agentInstruction: "Ask the operator to make the update",
                safety: "changesData",
                verification: "Check the result",
                rollback: "Restore the prior value",
                binding: {
                    kind: "manual",
                    accepted: true,
                    reason: "Operator handles the change",
                },
                citations: [citation],
            },
        ],
        verification: ["Check the result"],
        rollback: ["Restore"],
        synthesis: { sourceReferences: [citation] },
        review: {
            state: "reviewed",
            procedureVersion: version,
            contentHash: "a".repeat(64),
            reviewedAt: "2026-10-02T12:00:00Z",
            safetyConfirmed: true,
            bindingValidation: "accepted",
        },
    };
}
function procedure(version = 3): ProcedureVersion {
    return {
        corpusId: "corpus-a",
        procedureId: "procedure-a",
        version,
        state: "saved",
        document: {
            title: "Operator guide",
            summary: "Summary",
            steps: ["Review then update"],
            citations: [citation],
            additionalSections: [
                { heading: "Extra notes", content: "Keep these notes" },
            ],
            agentEdition: edition(version),
        },
        canonicalJson: "{}",
        markdown: "# Operator guide\n\n## Steps\n\n1. Review then update",
        createdAt: "2026-10-02T12:00:00Z",
        jsonHash: "json-hash",
        markdownHash: "markdown-hash",
    };
}
function original(): RunbookOriginal {
    return {
        citation,
        title: "Retained source",
        available: true,
        content: "before cited after",
        offset: 0,
        totalChars: 18,
        assets: [],
        location: { kind: "characters", start: 7, end: 12 },
    };
}
function skill(): RunbookSkill {
    return {
        identity: { scope: "user", origin: "personal", name: "operator-guide" },
        revisionId: "skill-revision",
        state: "approved",
        displayName: "Operator skill",
        description: "Manual guide",
        active: false,
        createdAt: "2026-10-02T12:00:00Z",
        files: [{ path: "SKILL.md", size: 12, hash: "file-hash" }],
        lineage: {
            corpusId: "corpus-a",
            procedureId: "procedure-a",
            version: 2,
            jsonHash: "old-json",
            markdownHash: "old-markdown",
        },
        allowedActions: ["activate", "rollback"],
        findings: [],
    };
}
function detail(): RunbookDetail {
    return {
        corpusId: "corpus-a",
        corpusName: "Corpus A",
        procedure: procedure(),
        originals: [original()],
        history: [
            {
                version: 2,
                state: "saved",
                createdAt: "2026-10-01T12:00:00Z",
                jsonHash: "old-json",
                markdownHash: "old-markdown",
            },
        ],
        skills: [],
        drift: [],
        warnings: [],
    };
}
function summary(): RunbookSummary {
    return {
        id: "stable",
        corpusId: "corpus-a",
        corpusName: "Corpus A",
        kind: "procedure",
        objectId: "procedure-a",
        title: "Operator guide",
        state: "saved",
        readiness: "runbook",
        latestVersion: 3,
        updatedAt: "2026-10-02T12:00:00Z",
        editionState: "reviewed",
        boundSteps: 1,
        totalSteps: 1,
        skills: [],
        drift: [],
    };
}
function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error("Not initialized");
    };
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Runbook workspace", () => {
    let host: HTMLElement;
    let activeScope: string | undefined;
    let current: RunbookDetail;
    let workspace: ReturnType<typeof mountMemoryHubRunbooks>;
    let onError: jest.Mock;
    let onChanged: jest.Mock;
    let onOpenSource: jest.Mock;
    let onRouteChanged: jest.Mock;
    beforeEach(() => {
        globalThis.structuredClone ??= <T>(value: T): T =>
            deserialize(serialize(value));
        globalThis.TextEncoder ??= TextEncoder;
        document.body.replaceChildren();
        host = document.createElement("div");
        document.body.append(host);
        activeScope = "corpus-a";
        current = detail();
        mockView.mockReset();
        mockMemory.mockReset();
        mockView.mockImplementation(async (method) => {
            if (method === "memoryHubRunbooks")
                return {
                    items: [summary()],
                    total: 1,
                    errors: [],
                    warnings: [],
                };
            if (method === "memoryHubRunbook") return current;
            if (method === "memoryHubSaveRunbook") return procedure(4);
            throw new Error(`Unexpected view method ${method}`);
        });
        mockMemory.mockImplementation(async (method) => {
            throw new Error(`Unexpected memory method ${method}`);
        });
        jest.spyOn(window, "confirm").mockReturnValue(true);
        HTMLDialogElement.prototype.showModal = function () {
            this.open = true;
            this.querySelector<HTMLButtonElement>("button")?.focus();
        };
        HTMLDialogElement.prototype.close = function () {
            this.open = false;
        };
        onError = jest.fn();
        onChanged = jest.fn();
        onOpenSource = jest.fn();
        onRouteChanged = jest.fn();
        workspace = mountMemoryHubRunbooks(host, {
            scope: () => activeScope,
            onError,
            onChanged,
            onOpenSource,
            onRouteChanged,
        });
    });
    afterEach(() => {
        workspace.dispose();
        jest.restoreAllMocks();
    });
    function button(name: string) {
        const value = host.querySelector<HTMLButtonElement>(
            `button[name="${name}"]`,
        );
        if (!value) throw new Error(`Missing button ${name}`);
        return value;
    }
    function click(text: string) {
        const value = [...host.querySelectorAll("button")].find(
            (item) =>
                item.textContent === text ||
                item.getAttribute("aria-label") === text,
        );
        if (!value) throw new Error(`Missing button ${text}`);
        value.click();
    }
    function field(name: string, value: string) {
        const input = host.querySelector<
            HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >(`[name="${name}"]`);
        if (!input) throw new Error(`Missing field ${name}`);
        input.value = value;
        input.dispatchEvent(
            new Event(input instanceof HTMLSelectElement ? "change" : "input", {
                bubbles: true,
            }),
        );
    }
    function check(name: string, checked = true) {
        const input = host.querySelector<HTMLInputElement>(
            `input[name="${name}"]`,
        );
        if (!input) throw new Error(`Missing checkbox ${name}`);
        input.checked = checked;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const open = () =>
        workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
        });

    test("server filters, actual totals and degraded errors do not imply empty success or an All-memory mutation corpus", async () => {
        activeScope = undefined;
        mockView.mockResolvedValueOnce({
            items: [],
            total: 17,
            errors: [
                {
                    corpusId: "corpus-b",
                    operation: "catalog",
                    message: "offline",
                },
            ],
            warnings: ["Partial readiness"],
        });
        await workspace.show();
        expect(host.textContent).toContain("17 matching runbooks");
        expect(host.textContent).toContain(
            "unavailable corpora are not empty success",
        );
        expect(button("new-runbook").disabled).toBe(true);
        field("runbook-query", "operator");
        field("runbook-state", "stale");
        field("runbook-readiness", "toolsBound");
        check("runbook-needs-review");
        host
            .querySelector("form")
            ?.dispatchEvent(
                new Event("submit", { bubbles: true, cancelable: true }),
            );
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubRunbooks",
            expect.objectContaining({
                corpusId: undefined,
                query: "operator",
                states: ["stale"],
                readiness: ["toolsBound"],
                needsReview: true,
                pageSize: 25,
            }),
        );
    });
    test("candidate side-by-side save preserves citation, extra section and future fields and does not auto-review", async () => {
        const candidate: ProcedureCandidate = {
            ...procedure().document,
            candidateId: "candidate-1",
            corpusId: "corpus-a",
            state: "detected",
            createdAt: "2026-10-02T12:00:00Z",
            updatedAt: "2026-10-02T12:00:00Z",
        };
        Object.assign(candidate, { futureDocumentField: { kept: true } });
        current = { ...detail(), procedure: undefined, candidate };
        await workspace.show({
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "candidate-1",
        });
        expect(host.textContent).toContain("Retained source");
        field("human-step-1", "Explicit edited human step");
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                corpusId: "corpus-a",
                candidateId: "candidate-1",
                document: expect.objectContaining({
                    steps: ["Explicit edited human step"],
                    citations: [citation],
                    additionalSections: [
                        { heading: "Extra notes", content: "Keep these notes" },
                    ],
                    futureDocumentField: { kept: true },
                    agentEdition: expect.objectContaining({
                        review: expect.objectContaining({ state: "draft" }),
                    }),
                }),
            }),
        );
        const request = mockView.mock.calls.find(
            ([method]) => method === "memoryHubSaveRunbook",
        )?.[1];
        expect(request).not.toHaveProperty("reviewAgentEdition");
        expect(request).not.toHaveProperty("markdown");
        expect(onChanged).toHaveBeenCalled();
        expect(button("save-runbook").disabled).toBe(false);
        expect(onRouteChanged).toHaveBeenLastCalledWith({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
        });
    });
    test("reject uses exact corpus/candidate and never publishes a skill", async () => {
        current = {
            ...detail(),
            procedure: undefined,
            candidate: {
                ...procedure().document,
                candidateId: "candidate-1",
                corpusId: "corpus-a",
                state: "detected",
                createdAt: "2026-10-02T12:00:00Z",
                updatedAt: "2026-10-02T12:00:00Z",
            },
        };
        mockMemory.mockResolvedValue(undefined);
        await workspace.show({
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "candidate-1",
        });
        button("reject-candidate").click();
        await flush();
        expect(mockMemory).toHaveBeenCalledWith(
            "memoryRejectProcedureCandidate",
            { corpusId: "corpus-a", candidateId: "candidate-1" },
        );
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubPublishSkill",
        );
    });
    test("save conflict retains exact expected version and human draft without overwrite", async () => {
        await open();
        field("runbook-title", "My retained draft");
        mockView.mockRejectedValueOnce(
            new Error("Version conflict: expected 3, current 4"),
        );
        button("save-runbook").click();
        await flush();
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("My retained draft");
        expect(host.textContent).toContain(
            "draft and expected version are retained",
        );
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                expectedVersion: 3,
                procedureId: "procedure-a",
            }),
        );
        expect(onChanged).not.toHaveBeenCalled();
        expect(button("reload-runbook")).toBeDefined();
    });
    test("edits invalidate per-version review and review save needs explicit global and every state-changing acknowledgement", async () => {
        await open();
        click("Steps");
        field("edition-goal", "Explicitly changed goal");
        check("review-edition");
        check("review-safety");
        button("save-runbook").click();
        await flush();
        expect(
            mockView.mock.calls.filter(
                ([method]) => method === "memoryHubSaveRunbook",
            ),
        ).toHaveLength(0);
        expect(host.textContent).toContain(
            "every state-changing step acknowledgement",
        );
        check("safety-stable-step");
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                expectedVersion: 3,
                reviewAgentEdition: true,
                safetyConfirmed: true,
                document: expect.objectContaining({
                    agentEdition: expect.objectContaining({
                        goal: "Explicitly changed goal",
                        review: expect.objectContaining({ state: "draft" }),
                    }),
                }),
            }),
        );
    });
    test("loaded secret defaults/examples/enum literals are neither rendered nor saved, including copies elsewhere", async () => {
        const secret = "unique-secret-literal";
        const guide = procedure();
        guide.document.agentEdition = edition();
        guide.document.agentEdition.inputs = [
            {
                id: "credential",
                description: "Credential",
                type: "enum",
                required: true,
                secret: true,
                defaultValue: secret,
                examples: [secret],
                enumValues: [secret],
            },
        ];
        guide.document.agentEdition.goal = `Use ${secret}`;
        guide.document.steps = [`Copy ${secret}`];
        current.procedure = guide;
        await open();
        click("Steps");
        expect(host.innerHTML).not.toContain(secret);
        expect(
            host.querySelector('[name="input-credential-default"]'),
        ).toBeNull();
        button("save-runbook").click();
        await flush();
        expect(
            JSON.stringify(
                mockView.mock.calls.find(
                    ([method]) => method === "memoryHubSaveRunbook",
                )?.[1],
            ),
        ).not.toContain(secret);
    });
    test("marking an existing input secret removes values and redacts copies before rerender/save", async () => {
        const guide = procedure();
        const agent = edition();
        agent.inputs[0].defaultValue = "newly-secret-literal";
        agent.inputs[0].examples = ["newly-secret-literal"];
        agent.goal = "Use newly-secret-literal";
        guide.document.agentEdition = agent;
        current.procedure = guide;
        await open();
        click("Steps");
        check("input-name-secret");
        expect(host.innerHTML).not.toContain("newly-secret-literal");
        expect(host.querySelector('[name="input-name-default"]')).toBeNull();
        button("save-runbook").click();
        await flush();
        expect(
            JSON.stringify(
                mockView.mock.calls.find(
                    ([method]) => method === "memoryHubSaveRunbook",
                )?.[1],
            ),
        ).not.toContain("newly-secret-literal");
    });
    test("legacy human guides remain editable; manual synthesis is explicit and begins unreviewed/unbound", async () => {
        const guide = procedure();
        delete guide.document.agentEdition;
        current.procedure = guide;
        await open();
        click("Steps");
        expect(host.textContent).toContain("remains a valid how-to");
        expect(mockView.mock.calls).toHaveLength(1);
        button("create-edition").click();
        expect(host.textContent).toContain("not accepted");
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                document: expect.objectContaining({
                    agentEdition: expect.objectContaining({
                        review: expect.objectContaining({ state: "draft" }),
                    }),
                }),
            }),
        );
    });
    async function bindingDialog() {
        await open();
        click("Steps");
        mockView.mockResolvedValueOnce({
            suggestions: [
                {
                    targetId: actualMcpId,
                    kind: "mcp",
                    name: "Real catalog tool",
                    description: "Configured target",
                    version: actualMcpFingerprint,
                    fingerprint: actualMcpFingerprint,
                    inputSchema: {
                        type: "object",
                        properties: { name: { type: "string" } },
                    },
                    safety: "changesData",
                    score: 0.91,
                    reasons: ["Schema name input fits"],
                },
            ],
            warnings: ["Runtime permissions still required"],
        });
        button("bind-stable-step").click();
        await flush();
    }
    test("binding suggestions show real schema/reasons; acceptance is explicit and exact version/fingerprint CAS", async () => {
        await bindingDialog();
        expect(host.textContent).toContain("Schema name input fits");
        expect(host.textContent).toContain(
            "catalog policy rejects secret input references",
        );
        expect(host.textContent).toContain("No target selected");
        button("accept-binding").click();
        await flush();
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubAcceptBinding",
        );
        click("Select Real catalog tool");
        field("binding-arguments", '{"name":{"$input":"name"}}');
        check("binding-confirmed");
        const bound = procedure(4);
        const step = bound.document.agentEdition?.steps[0];
        if (step)
            step.binding = {
                kind: "mcp",
                accepted: true,
                serverId: "server",
                targetId: "tool",
                version: actualMcpFingerprint,
                fingerprint: actualMcpFingerprint,
            };
        if (bound.document.agentEdition)
            bound.document.agentEdition.review = {
                state: "draft",
                reason: "Binding changed; explicit version review required",
            };
        mockView.mockResolvedValueOnce(bound);
        button("accept-binding").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubAcceptBinding", {
            corpusId: "corpus-a",
            procedureId: "procedure-a",
            expectedVersion: 3,
            stepId: "stable-step",
            targetId: actualMcpId,
            targetVersion: actualMcpFingerprint,
            fingerprint: actualMcpFingerprint,
            arguments: { name: { $input: "name" } },
            safety: "changesData",
            safetyConfirmed: true,
        });
        expect(onChanged).toHaveBeenCalled();
        expect(document.activeElement).toBe(button("bind-stable-step"));
        expect(host.textContent).toContain("Binding: mcp");
        expect(host.textContent).toContain("Unreviewed draft");
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSaveRunbook",
        );
    });
    test("malformed binding arguments do not invoke acceptance or discard the dialog", async () => {
        await bindingDialog();
        click("Select Real catalog tool");
        field("binding-arguments", "[]");
        check("binding-confirmed");
        button("accept-binding").click();
        await flush();
        expect(host.textContent).toContain("JSON object");
        expect(host.querySelector("dialog")?.open).toBe(true);
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubAcceptBinding",
        );
    });
    test("unavailable catalog is explicitly not empty success; explicit manual fallback still requires reason and safety", async () => {
        await open();
        click("Steps");
        mockView.mockRejectedValueOnce(new Error("Catalog offline"));
        button("bind-stable-step").click();
        await flush();
        expect(host.textContent).toContain("not an empty catalog success");
        field("binding-mode", "manual");
        field(
            "binding-manual-reason",
            "Human operator performs approved action",
        );
        field("binding-safety", "readOnly");
        check("binding-confirmed");
        mockView.mockResolvedValueOnce(procedure(4));
        button("accept-binding").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubAcceptBinding",
            expect.objectContaining({
                manualReason: "Human operator performs approved action",
                safety: "readOnly",
                safetyConfirmed: true,
                expectedVersion: 3,
            }),
        );
    });
    async function previewSkill(valid = true) {
        await open();
        click("Skill");
        field("skill-name", "operator-guide");
        mockView.mockResolvedValueOnce({
            files: [
                {
                    path: "SKILL.md",
                    content:
                        "# Skill\n<iframe src='https://evil.invalid'></iframe>",
                },
            ],
            findings: valid
                ? ["Service validation passed"]
                : ["Missing citations"],
            valid,
            identity: skill().identity,
            lineage: {
                corpusId: "corpus-a",
                procedureId: "procedure-a",
                version: 3,
                jsonHash: "json-hash",
                markdownHash: "markdown-hash",
            },
        });
        button("preview-skill").click();
        await flush();
    }
    test("real package preview is text-only and publication requests DRAFT without auto-approval/activation", async () => {
        await previewSkill();
        expect(host.querySelector("iframe")).toBeNull();
        expect(host.textContent).toContain("<iframe");
        mockView.mockResolvedValueOnce({
            ...skill(),
            state: "draft",
            allowedActions: ["validate"],
            lineage: {
                ...procedure(),
                corpusId: "corpus-a",
                procedureId: "procedure-a",
                version: 3,
                jsonHash: "json-hash",
                markdownHash: "markdown-hash",
            },
        });
        button("publish-skill").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubPublishSkill", {
            corpusId: "corpus-a",
            procedureId: "procedure-a",
            version: 3,
            identity: {
                scope: "user",
                origin: "personal",
                name: "operator-guide",
            },
        });
        expect(host.textContent).toContain("Published catalog state: draft");
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSkillAction",
        );
    });
    test("invalid preview findings disable publication and changing identity invalidates cached preview", async () => {
        await previewSkill(false);
        expect(host.textContent).toContain("Missing citations");
        expect(button("publish-skill").disabled).toBe(true);
        field("skill-origin", "other");
        expect(button("publish-skill").disabled).toBe(true);
    });
    test("lifecycle exposes server allowed actions only and sends exact identity/revision/state for activate and rollback", async () => {
        current.skills = [skill()];
        await open();
        click("Skill");
        expect(
            [...host.querySelectorAll("button")].some(
                (entry) => entry.textContent === "approve",
            ),
        ).toBe(false);
        mockView.mockResolvedValueOnce({
            ...skill(),
            state: "active",
            active: true,
            allowedActions: ["rollback"],
        });
        click("activate");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubSkillAction", {
            identity: skill().identity,
            revisionId: "skill-revision",
            expectedState: "approved",
            expectedActive: false,
            action: "activate",
        });
        mockView.mockResolvedValueOnce({
            ...skill(),
            revisionId: "previous-revision",
            state: "approved",
            active: false,
            allowedActions: ["activate"],
        });
        click("rollback");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubSkillAction", {
            identity: skill().identity,
            revisionId: "skill-revision",
            expectedState: "active",
            expectedActive: true,
            action: "rollback",
        });
        expect(host.textContent).toContain("procedure remains unchanged");
        expect(host.textContent).toContain(
            "Published procedure version 2; current guide version 3",
        );
    });
    test("dirty or unreviewed edition cannot preview/publish and binding never overwrites unsaved edits", async () => {
        await open();
        field("runbook-title", "Unsaved");
        click("Steps");
        button("bind-stable-step").click();
        await flush();
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Unsaved edits"),
            }),
        );
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSuggestBindings",
        );
        click("Skill");
        field("skill-name", "operator-guide");
        expect(button("preview-skill").disabled).toBe(true);
        expect(button("publish-skill").disabled).toBe(true);
    });
    test("retained original paging uses exact source/revision/locator and only backend character offsets highlight", async () => {
        const first = original();
        first.nextOffset = 18;
        first.totalChars = 31;
        current.originals = [first];
        await open();
        click("Original");
        expect(host.querySelector("mark")?.textContent).toBe("cited");
        mockView.mockResolvedValueOnce({
            ...first,
            content: "original tail",
            offset: 18,
            nextOffset: undefined,
            location: undefined,
        });
        click("Next original");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbookOriginal", {
            corpusId: "corpus-a",
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            locator: "chars:7:12",
            offset: 18,
        });
        expect(host.textContent).toContain("DOCUMENT-LEVEL");
        expect(host.querySelector("mark")).toBeNull();
        click("Open latest source management (not this retained revision)");
        expect(onOpenSource).toHaveBeenCalledWith(
            "corpus-a",
            citation.sourceId,
        );
    });
    test("missing source evidence and asset manual review are explicit; remote/blob/SVG previews are never loaded", async () => {
        const asset = {
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            assetId: "asset",
            name: "Picture",
            mimeType: "image/png",
            size: 10,
            hash: "hash",
            warnings: ["Manual description required"],
            previewUrl: "https://evil.invalid/api/image.png",
        };
        current.originals = [
            {
                ...original(),
                available: false,
                content: "",
                error: "missingSource: retained revision removed",
                assets: [asset],
            },
        ];
        await open();
        click("Original");
        expect(host.textContent).toContain("No latest revision is substituted");
        expect(host.textContent).toContain("No configured-model description");
        expect(host.querySelector("img")).toBeNull();
        expect(
            controlledRunbookImage({
                ...asset,
                previewUrl: "blob:https://localhost/asset",
            }),
        ).toBeUndefined();
        expect(
            controlledRunbookImage({
                ...asset,
                mimeType: "image/svg+xml",
                previewUrl: "/api/image",
            }),
        ).toBeUndefined();
        expect(
            controlledRunbookImage({ ...asset, previewUrl: "/api/image" }),
        ).toBeUndefined();
        expect(
            controlledRunbookImage({
                ...asset,
                previewUrl: "/retained-assets/image",
            }),
        ).toBeUndefined();
        expect(
            controlledRunbookImage({
                ...asset,
                previewUrl: "/api/views/runbook-asset?assetId=asset",
            }),
        ).toBe(
            new URL("/api/views/runbook-asset?assetId=asset", location.href)
                .href,
        );
        expect(
            controlledRunbookImage({
                ...asset,
                previewUrl:
                    "/api/views/runbook-asset?acknowledgeUnreviewed=true",
            }),
        ).toBeUndefined();
        expect(
            controlledRunbookImage({
                ...asset,
                previewUrl: `http://user:password@${location.host}/retained-assets/image`,
            }),
        ).toBeUndefined();
    });
    test("historic browsing requests exact version and remains read-only with original source identity", async () => {
        await open();
        click("History");
        current = {
            ...detail(),
            procedure: procedure(2),
            originals: [
                {
                    ...original(),
                    citation: {
                        ...citation,
                        revisionId: "historical-revision",
                    },
                },
            ],
        };
        click("Read exact version 2 · saved");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            version: 2,
        });
        expect(host.textContent).toContain(
            "Exact historical version: read-only",
        );
        expect(host.querySelector('[name="save-runbook"]')).toBeNull();
        click("Original");
        expect(host.textContent).toContain("Source text. Unreviewed evidence");
        expect(host.textContent).not.toContain("historical-revision");
    });
    test("stale comparison is three-column, marks affected steps/missing source and never overwrites the draft or publishes", async () => {
        const stale = procedure();
        stale.state = "stale";
        current.procedure = stale;
        await open();
        field("runbook-title", "Keep my current edits");
        mockView.mockResolvedValueOnce({
            previous: [original()],
            updated: [
                {
                    ...original(),
                    available: false,
                    content: "",
                    error: "missingSource",
                },
            ],
            current: stale,
            affectedSteps: [
                { stepId: "stable-step", reasons: ["Source changed"] },
            ],
            warnings: ["No automatic resynthesis"],
        });
        button("compare-runbook").click();
        await flush();
        expect(host.textContent).toContain("Previous exact originals");
        expect(host.textContent).toContain("Updated exact originals");
        expect(host.textContent).toContain("Current agent edition");
        expect(host.textContent).toContain("stable-step: Source changed");
        expect(host.textContent).toContain("missingSource");
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Keep my current edits");
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSaveRunbook",
        );
    });
    test("sanitized Markdown keeps tables but never executes raw HTML, script, iframe or images", async () => {
        const guide = procedure();
        delete guide.document.agentEdition;
        guide.document.additionalSections = [
            {
                heading: "Reference",
                content:
                    "| A | B |\n| --- | --- |\n| one | two |\n\n<script>alert(1)</script><iframe src='https://evil.invalid'></iframe>\n![remote](https://evil.invalid/image.png)",
            },
        ];
        current.procedure = guide;
        await open();
        expect(host.querySelector("table")).not.toBeNull();
        expect(host.querySelector("script,iframe,img")).toBeNull();
        expect(host.textContent).toContain("<script>");
    });
    test("unsaved Back is guarded and accepted discard preserves cached list filters without a redundant list request", async () => {
        await workspace.show();
        field("runbook-query", "cached query");
        await open();
        field("runbook-title", "Keep me");
        jest.mocked(window.confirm).mockReturnValue(false);
        expect(workspace.discardChanges()).toBe(false);
        await workspace.show();
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Keep me");
        jest.mocked(window.confirm).mockReturnValue(true);
        await workspace.show();
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-query"]')
                ?.value,
        ).toBe("cached query");
        expect(
            mockView.mock.calls.filter(
                ([method]) => method === "memoryHubRunbooks",
            ),
        ).toHaveLength(1);
    });
    test("stale scope list response is ignored, not mixed into the current corpus", async () => {
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        const first = workspace.show();
        activeScope = "corpus-b";
        mockView.mockResolvedValueOnce({
            items: [
                {
                    ...summary(),
                    corpusId: "corpus-b",
                    title: "Current scoped guide",
                },
            ],
            total: 1,
            errors: [],
            warnings: [],
        });
        workspace.scopeChanged();
        await flush();
        pending.resolve({
            items: [{ ...summary(), title: "Stale result" }],
            total: 1,
            errors: [],
            warnings: [],
        });
        await first;
        expect(host.textContent).toContain("Current scoped guide");
        expect(host.textContent).not.toContain("Stale result");
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubRunbooks",
            expect.objectContaining({ corpusId: "corpus-b" }),
        );
    });
    test("out-of-order detail response cannot replace a newer procedure or route", async () => {
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        const first = open();
        const newer = detail();
        newer.procedure = {
            ...procedure(),
            procedureId: "procedure-b",
            document: { ...procedure().document, title: "Newer guide" },
        };
        mockView.mockResolvedValueOnce(newer);
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-b",
        });
        pending.resolve(detail());
        await first;
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Newer guide");
        expect(onRouteChanged).toHaveBeenCalledTimes(1);
    });
    test("list paging uses server token and exact totals, then disposal suppresses pending callbacks", async () => {
        mockView.mockResolvedValueOnce({
            items: [summary()],
            total: 42,
            nextContinuationToken: "page-2",
            errors: [],
            warnings: [],
        });
        await workspace.show();
        field("runbook-query", "unsubmitted edit");
        mockView.mockResolvedValueOnce({
            items: [
                { ...summary(), objectId: "procedure-b", title: "Second page" },
            ],
            total: 42,
            errors: [],
            warnings: [],
        });
        click("Next runbook page");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubRunbooks",
            expect.objectContaining({ continuationToken: "page-2" }),
        );
        expect(mockView.mock.calls.at(-1)?.[1]).not.toHaveProperty(
            "query",
            "unsubmitted edit",
        );
        expect(host.textContent).toContain("42 matching");
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        const loading = open();
        workspace.dispose();
        pending.resolve(detail());
        await loading;
        expect(host.children).toHaveLength(0);
        expect(onRouteChanged).not.toHaveBeenCalledWith(
            expect.objectContaining({ objectId: "procedure-a" }),
        );
    });
    test("keyboard tabs use roving focus and dialog Escape returns to the live binding control", async () => {
        await open();
        const overview = host.querySelector<HTMLButtonElement>(
            '[data-tab="Overview"]',
        );
        overview?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        expect(document.activeElement?.textContent).toBe("Steps");
        expect(
            host
                .querySelector('[data-tab="Steps"]')
                ?.getAttribute("aria-selected"),
        ).toBe("true");
        mockView.mockResolvedValueOnce({ suggestions: [], warnings: [] });
        button("bind-stable-step").focus();
        button("bind-stable-step").click();
        await flush();
        const dialog = host.querySelector("dialog");
        expect(document.activeElement?.textContent).toBe(
            "Close binding dialog",
        );
        dialog?.dispatchEvent(new Event("cancel", { cancelable: true }));
        expect(dialog?.open).toBe(false);
        expect(document.activeElement).toBe(button("bind-stable-step"));
    });
    test("compatible Markdown round-trip preserves exact citations, extra sections and unknown document fields", async () => {
        const guide = procedure();
        Object.assign(guide.document, { futureFlag: { retained: true } });
        current.procedure = guide;
        await open();
        field("human-editor-mode", "Compatible Markdown");
        const markdown = host.querySelector<HTMLTextAreaElement>(
            '[name="runbook-markdown"]',
        )?.value;
        if (!markdown) throw new Error("Missing canonical Markdown");
        field(
            "runbook-markdown",
            markdown.replace("# Operator guide", "# Edited compatible title"),
        );
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                expectedVersion: 3,
                document: expect.objectContaining({
                    title: "Edited compatible title",
                    citations: [citation],
                    additionalSections: [
                        { heading: "Extra notes", content: "Keep these notes" },
                    ],
                    futureFlag: { retained: true },
                    agentEdition: expect.objectContaining({
                        review: expect.objectContaining({ state: "draft" }),
                    }),
                }),
            }),
        );
    });
    test("new human guide keeps incomplete fields local until valid and saves only into explicitly selected corpus", async () => {
        await workspace.show();
        button("new-runbook").click();
        expect(host.textContent).toContain(
            "Markdown preview unavailable until the draft is complete",
        );
        button("save-runbook").click();
        await flush();
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSaveRunbook",
        );
        field("runbook-title", "New authored guide");
        click("Add human step");
        field("human-step-1", "Operator performs a manual step");
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubSaveRunbook", {
            corpusId: "corpus-a",
            document: {
                title: "New authored guide",
                steps: ["Operator performs a manual step"],
                citations: [],
            },
        });
    });
    test("save committed but snapshot refresh failed is reported as degraded refresh, never failed persistence", async () => {
        await open();
        field("runbook-title", "Committed guide");
        mockView.mockResolvedValueOnce({
            ...procedure(4),
            document: { ...procedure(4).document, title: "Committed guide" },
        });
        onChanged.mockRejectedValueOnce(new Error("Snapshot offline"));
        button("save-runbook").click();
        await flush();
        expect(host.textContent).toContain(
            "Runbook version committed; workspace/snapshot refresh unavailable",
        );
        expect(host.textContent).not.toContain("Save failed; your draft");
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Committed guide");
        expect(button("save-runbook").disabled).toBe(false);
    });
    test("archive checks exact human version and leaves linked catalog lifecycle unchanged", async () => {
        current.skills = [skill()];
        await open();
        mockMemory.mockResolvedValueOnce({
            ...procedure(4),
            state: "archived",
        });
        button("archive-runbook").click();
        await flush();
        expect(mockMemory).toHaveBeenLastCalledWith("memoryArchiveProcedure", {
            corpusId: "corpus-a",
            procedureId: "procedure-a",
            expectedVersion: 3,
        });
        click("Skill");
        expect(host.textContent).toContain(
            "Publication is unavailable for this archived procedure",
        );
        expect(host.textContent).toContain("Catalog state: approved");
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSkillAction",
        );
    });
    test("Used by and History use actual totals and explicit server paging without guessing navigation identities", async () => {
        await open();
        click("Original");
        mockView.mockResolvedValueOnce({
            items: [{ procedure: procedure(), skills: [skill()] }],
            total: 40,
            nextContinuationToken: "dependencies-next",
            warnings: ["Partial skill lookup"],
        });
        click("Used by: guides and linked skills for this source");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbookUsedBy", {
            corpusId: "corpus-a",
            sourceId: citation.sourceId,
            pageSize: 25,
            continuationToken: undefined,
        });
        expect(host.textContent).toContain("40 procedures (server total)");
        expect(host.textContent).toContain("Partial skill lookup");
        mockView.mockResolvedValueOnce({ items: [], total: 40, warnings: [] });
        click("More source dependencies");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubRunbookUsedBy",
            expect.objectContaining({ continuationToken: "dependencies-next" }),
        );
        click("History");
        mockView.mockResolvedValueOnce({
            items: [procedure(3), procedure(2)],
            total: 40,
            nextContinuationToken: "older",
        });
        button("load-history").click();
        await flush();
        expect(host.textContent).toContain("History: 40 versions");
        mockView.mockResolvedValueOnce({ items: [procedure(1)], total: 40 });
        click("Older versions");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbookHistory", {
            corpusId: "corpus-a",
            procedureId: "procedure-a",
            beforeVersion: 2,
            pageSize: 25,
        });
    });
    test("multiple structured agent edits persist together and invalidate explicit review acknowledgements", async () => {
        await open();
        click("Steps");
        check("review-edition");
        check("review-safety");
        check("safety-stable-step");
        field("edition-goal", "Changed goal");
        field("step-stable-step-instruction", "Changed derived instruction");
        expect(
            host.querySelector<HTMLInputElement>('[name="review-edition"]')
                ?.checked,
        ).toBe(false);
        expect(
            host.querySelector<HTMLInputElement>('[name="safety-stable-step"]')
                ?.checked,
        ).toBe(false);
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                document: expect.objectContaining({
                    agentEdition: expect.objectContaining({
                        goal: "Changed goal",
                        steps: [
                            expect.objectContaining({
                                id: "stable-step",
                                agentInstruction: "Changed derived instruction",
                            }),
                        ],
                        review: expect.objectContaining({ state: "draft" }),
                    }),
                }),
            }),
        );
        expect(
            mockView.mock.calls.find(
                ([method]) => method === "memoryHubSaveRunbook",
            )?.[1],
        ).not.toHaveProperty("reviewAgentEdition");
    });
    test("pending save blocks navigation even without edited content and releases the guard after commit", async () => {
        await open();
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        button("save-runbook").click();
        await flush();
        expect(workspace.discardChanges()).toBe(false);
        expect(host.textContent).toContain("pending runbook change");
        pending.resolve(procedure(4));
        await flush();
        expect(workspace.discardChanges()).toBe(true);
        expect(button("save-runbook").disabled).toBe(false);
    });
    test("an exact evidence response for an edited draft is ignored rather than appended to newer content", async () => {
        const other = {
            sourceId: "source-other",
            revisionId: "revision-other",
            locator: "message:7",
        };
        const guide = procedure();
        const agent = edition();
        agent.steps[0].citations = [other];
        agent.synthesis.sourceReferences.push(other);
        guide.document.agentEdition = agent;
        current.procedure = guide;
        await open();
        click("Steps");
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        click("Inspect cited originals");
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbookOriginal", {
            corpusId: "corpus-a",
            sourceId: "source-other",
            revisionId: "revision-other",
            locator: "message:7",
        });
        field("edition-goal", "Newer edited draft");
        pending.resolve({
            ...original(),
            citation: other,
            content: "Stale evidence response",
        });
        await flush();
        expect(host.textContent).not.toContain("Stale evidence response");
        expect(
            host.querySelector<HTMLInputElement>('[name="edition-goal"]')
                ?.value,
        ).toBe("Newer edited draft");
    });
    test("a valid flag with mismatched exact preview lineage never enables publication", async () => {
        await open();
        click("Skill");
        field("skill-name", "operator-guide");
        mockView.mockResolvedValueOnce({
            valid: true,
            files: [],
            findings: [],
            identity: skill().identity,
            lineage: {
                corpusId: "corpus-a",
                procedureId: "procedure-a",
                version: 2,
                jsonHash: "json-hash",
                markdownHash: "markdown-hash",
            },
        });
        button("preview-skill").click();
        await flush();
        expect(button("publish-skill").disabled).toBe(true);
        expect(host.textContent).toContain(
            "content hashes do not match the saved guide",
        );
    });
    test("publication returning active state is reported as inconsistent, never relabeled draft or implicitly activated", async () => {
        await previewSkill();
        mockView.mockResolvedValueOnce({
            ...skill(),
            state: "active",
            active: true,
        });
        button("publish-skill").click();
        await flush();
        expect(host.textContent).toContain(
            "unexpected non-DRAFT or active catalog state",
        );
        expect(host.textContent).not.toContain(
            "Published catalog state: draft",
        );
        expect(button("publish-skill").disabled).toBe(true);
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSkillAction",
        );
    });
    test("validated-to-draft correction uses only server allowed action and exact state/active/revision guards", async () => {
        current.skills = [
            { ...skill(), state: "validated", allowedActions: ["draft"] },
        ];
        await open();
        click("Skill");
        mockView.mockResolvedValueOnce({
            ...skill(),
            state: "draft",
            allowedActions: ["validate"],
        });
        click("Return to DRAFT (correction)");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubSkillAction", {
            identity: skill().identity,
            revisionId: "skill-revision",
            expectedState: "validated",
            expectedActive: false,
            action: "draft",
        });
        expect(host.textContent).toContain(
            "Catalog revision is draft; the procedure remains unchanged",
        );
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSaveRunbook",
        );
    });
    test("unresolved ordinal original remains document-level despite matching excerpt and never claims safety", async () => {
        const unresolved = { ...citation, locator: "message:2" };
        const guide = procedure();
        const agent = edition();
        guide.document.citations = [unresolved];
        agent.synthesis.sourceReferences = [unresolved];
        agent.steps[0].citations = [unresolved];
        guide.document.agentEdition = agent;
        current.procedure = guide;
        current.originals = [
            { ...original(), citation: unresolved, location: undefined },
        ];
        await open();
        click("Original");
        expect(host.textContent).toContain("DOCUMENT-LEVEL preview");
        expect(host.textContent).toContain("Unreviewed evidence");
        expect(host.textContent).toContain("Display does not establish safety");
        expect(host.querySelector("mark")).toBeNull();
        expect(host.textContent).toContain("before cited after");
    });
    test("canonical Markdown honors deletion of supported fields while retaining opaque JSON extensions", async () => {
        const guide = procedure();
        Object.assign(guide.document, { opaqueExtension: { keep: true } });
        current.procedure = guide;
        await open();
        field("human-editor-mode", "Compatible Markdown");
        field(
            "runbook-markdown",
            `# Human-only guide\n\n## Steps\n\n1. Review then update\n\n## Sources\n\n- ${JSON.stringify(citation)}\n`,
        );
        const saved = procedure(4);
        saved.document = {
            title: "Human-only guide",
            steps: ["Review then update"],
            citations: [citation],
        };
        Object.assign(saved.document, { opaqueExtension: { keep: true } });
        mockView.mockResolvedValueOnce(saved);
        button("save-runbook").click();
        await flush();
        const request = mockView.mock.calls.find(
            ([method]) => method === "memoryHubSaveRunbook",
        )?.[1];
        expect(request).toMatchObject({
            expectedVersion: 3,
            document: {
                title: "Human-only guide",
                opaqueExtension: { keep: true },
                citations: [citation],
            },
        });
        expect(request).not.toHaveProperty("document.summary");
        expect(request).not.toHaveProperty("document.agentEdition");
        expect(request).not.toHaveProperty("document.additionalSections");
    });
    test("unreviewed original inspection requires confirmation and opens only acknowledged local route with noopener", async () => {
        const opened: Array<{ href: string; target: string; rel: string }> = [];
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
            function (this: HTMLAnchorElement) {
                opened.push({
                    href: this.href,
                    target: this.target,
                    rel: this.rel,
                });
            },
        );
        current.originals = [
            {
                ...original(),
                warnings: ["Retained text is unreviewed"],
                assets: [
                    {
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                        assetId: "asset",
                        name: "Sensitive picture",
                        mimeType: "image/png",
                        size: 10,
                        hash: "hash",
                        originalUrl:
                            "/api/views/runbook-asset?sourceId=source-shared&revisionId=revision-original&assetId=asset",
                        warnings: ["Sensitive pixels may be visible"],
                    },
                ],
            },
        ];
        await open();
        click("Original");
        expect(host.textContent).toContain("Retained text is unreviewed");
        expect(host.querySelector("img")).toBeNull();
        expect(opened).toHaveLength(0);
        jest.mocked(window.confirm).mockReturnValueOnce(false);
        button("inspect-unreviewed-original").click();
        expect(opened).toHaveLength(0);
        button("inspect-unreviewed-original").click();
        expect(opened).toHaveLength(1);
        const url = new URL(opened[0].href);
        expect(url.origin).toBe(location.origin);
        expect(url.pathname).toBe("/api/views/runbook-asset");
        expect(url.searchParams.get("acknowledgeUnreviewed")).toBe("true");
        expect(opened[0].target).toBe("_blank");
        expect(opened[0].rel).toBe("noopener noreferrer");
        expect(jest.mocked(window.confirm)).toHaveBeenLastCalledWith(
            expect.stringContaining("Sensitive pixels"),
        );
        expect(host.querySelector("img")).toBeNull();
    });
    test("remote or wrong-route original URLs never offer an inspection action", async () => {
        const asset = {
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            assetId: "asset",
            name: "Picture",
            mimeType: "image/png",
            size: 10,
            hash: "hash",
            warnings: [],
        };
        current.originals = [
            {
                ...original(),
                assets: [
                    {
                        ...asset,
                        originalUrl:
                            "https://remote.invalid/api/views/runbook-asset",
                    },
                    { ...asset, originalUrl: "/api/other" },
                ],
            },
        ];
        await open();
        click("Original");
        expect(
            host.querySelector('[name="inspect-unreviewed-original"]'),
        ).toBeNull();
        expect(host.textContent).toContain(
            "not an authorized local asset route",
        );
    });
    test("historical Used by row opens the exact version read-only from compact metadata", async () => {
        await open();
        click("Original");
        mockView.mockResolvedValueOnce({
            items: [
                {
                    procedure: {
                        corpusId: "corpus-a",
                        procedureId: "procedure-a",
                        version: 2,
                        state: "saved",
                        jsonHash: "old-json",
                        markdownHash: "old-markdown",
                        document: { title: "Historical guide" },
                    },
                    skills: [],
                },
            ],
            total: 1,
            warnings: [],
        });
        click("Used by: guides and linked skills for this source");
        await flush();
        current.procedure = {
            ...procedure(2),
            document: { ...procedure(2).document, title: "Historical guide" },
        };
        click("Historical guide · version 2 · 0 linked catalog revisions");
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            version: 2,
        });
        expect(host.textContent).toContain(
            "Exact historical version: read-only",
        );
        expect(host.querySelector('[name="save-runbook"]')).toBeNull();
    });
    test("Skill Inbox request selects and focuses exact revision, never a newer related revision", async () => {
        current.procedure = procedure(4);
        const published = {
            ...skill(),
            lineage: {
                corpusId: "corpus-a",
                procedureId: "procedure-a",
                version: 3,
                jsonHash: "version3-json",
                markdownHash: "version3-markdown",
            },
        };
        current.skills = [
            {
                ...skill(),
                revisionId: "newer",
                displayName: "Newer skill",
                lineage: {
                    ...published.lineage,
                    version: 4,
                    jsonHash: "version4-json",
                    markdownHash: "version4-markdown",
                },
            },
            {
                ...published,
                revisionId: "requested",
                displayName: "Requested draft",
                state: "draft",
                allowedActions: ["validate"],
            },
        ];
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            skillRevisionId: "requested",
        });
        const selected = host.querySelector<HTMLElement>(
            'article[aria-current="true"]',
        );
        expect(selected?.dataset.skillRevisionId).toBe("requested");
        expect(selected?.textContent).toContain("Requested draft");
        expect(selected?.textContent).toContain(
            "Published procedure version 3; current guide version 4",
        );
        expect(document.activeElement).toBe(selected);
        expect(
            host.querySelector('[role="tab"][aria-selected="true"]')
                ?.textContent,
        ).toBe("Skill");
        expect(onRouteChanged).toHaveBeenLastCalledWith(
            expect.objectContaining({ skillRevisionId: "requested" }),
        );
    });
    test("skill route request is captured before transport so caller mutations cannot reset Skill selection", async () => {
        current.procedure = procedure(4);
        current.skills = [skill()];
        const request: RunbookDetailRequest = {
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            skillRevisionId: "skill-revision",
        };
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        const loading = workspace.show(request);
        request.skillRevisionId = "mutated-by-caller";
        pending.resolve(current);
        await loading;
        expect(
            host.querySelector('[role="tab"][aria-selected="true"]')
                ?.textContent,
        ).toBe("Skill");
        expect(
            host.querySelector<HTMLElement>('article[aria-current="true"]')
                ?.dataset.skillRevisionId,
        ).toBe("skill-revision");
        expect(onRouteChanged).toHaveBeenLastCalledWith(
            expect.objectContaining({ skillRevisionId: "skill-revision" }),
        );
    });
    test("missing requested skill revision is explicit and historic selection has no write actions", async () => {
        current.procedure = procedure(2);
        current.skills = [skill()];
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            version: 2,
            skillRevisionId: "missing",
        });
        expect(host.textContent).toContain(
            "Requested immutable skill revision is unavailable. No latest revision is substituted",
        );
        expect(host.querySelector('[aria-current="true"]')).toBeNull();
        expect(
            [...host.querySelectorAll("button")].some(
                (entry) =>
                    entry.textContent === "activate" ||
                    entry.textContent === "rollback",
            ),
        ).toBe(false);
        expect(button("publish-skill").disabled).toBe(true);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining(
                    "Requested immutable skill revision is unavailable",
                ),
            }),
        );
    });
    test("matching revision from another lineage is rejected instead of selected as a fallback", async () => {
        current.skills = [
            {
                ...skill(),
                revisionId: "requested",
                lineage: {
                    corpusId: "corpus-other",
                    procedureId: "procedure-other",
                    version: 2,
                    jsonHash: "json",
                    markdownHash: "markdown",
                },
            },
        ];
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            skillRevisionId: "requested",
        });
        expect(host.querySelector('[aria-current="true"]')).toBeNull();
        expect(host.textContent).toContain(
            "not linked to this corpus/procedure",
        );
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("not linked"),
            }),
        );
    });
    test("route callbacks preserve selected skill across save and exact historic version on open", async () => {
        current.skills = [skill()];
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            skillRevisionId: "skill-revision",
        });
        button("save-runbook").click();
        await flush();
        expect(onRouteChanged).toHaveBeenLastCalledWith({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            skillRevisionId: "skill-revision",
        });
        current.procedure = procedure(2);
        await workspace.show({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            version: 2,
            skillRevisionId: "skill-revision",
        });
        expect(onRouteChanged).toHaveBeenLastCalledWith({
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "procedure-a",
            version: 2,
            skillRevisionId: "skill-revision",
        });
        expect(host.querySelector('[name="save-runbook"]')).toBeNull();
    });
    async function updatedComparison(available = true) {
        const stale = procedure();
        stale.state = "stale";
        current.procedure = stale;
        await open();
        field("runbook-title", "Keep current edited edition");
        const updated = {
            ...original(),
            available,
            citation: { ...citation, revisionId: "revision-updated" },
            ...(available ? {} : { error: "missingSource" }),
        };
        mockView.mockResolvedValueOnce({
            previous: [original()],
            updated: [updated],
            current: stale,
            affectedSteps: [],
            warnings: [],
        });
        button("compare-runbook").click();
        await flush();
    }
    test("explicit synthesis records durable job from exact updated original without replacing edits and refreshes candidates", async () => {
        await updatedComparison();
        const pending = deferred<unknown>();
        mockView.mockReturnValueOnce(pending.promise);
        button("synthesize-new-draft").click();
        await flush();
        expect(workspace.discardChanges()).toBe(false);
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSynthesizeRunbook",
            {
                corpusId: "corpus-a",
                procedureId: "procedure-a",
                version: 3,
                sourceId: citation.sourceId,
                revisionId: "revision-updated",
            },
        );
        const job = {
            jobId: "durable-job",
            corpusId: "corpus-a",
            sourceId: citation.sourceId,
            revisionId: "revision-updated",
            createdAt: "2026-10-02T19:00:00Z",
            updatedAt: "2026-10-02T19:00:00Z",
            state: "running",
            candidateIds: [],
            warnings: ["Generated drafts require review"],
        };
        pending.resolve(job);
        await flush();
        expect(host.textContent).toContain("Job ID: durable-job");
        expect(host.textContent).toContain("Durable state: running");
        expect(button("synthesize-new-draft").disabled).toBe(true);
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Keep current edited edition");
        mockView.mockResolvedValueOnce([
            {
                ...job,
                state: "complete",
                candidateIds: ["new-candidate"],
                warnings: ["Manual review required"],
            },
        ]);
        button("refresh-synthesis-job").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbookJobs", {
            corpusId: "corpus-a",
        });
        expect(host.textContent).toContain("Durable state: complete");
        expect(host.textContent).toContain("Review new draft new-candidate");
        expect(onChanged).toHaveBeenCalledTimes(2);
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Keep current edited edition");
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSaveRunbook",
        );
    });
    test("missing synthesis capability is explicit and never fabricates a job or overwrites current edition", async () => {
        await updatedComparison();
        mockView.mockRejectedValueOnce(
            new Error("Runbook synthesis capability unavailable"),
        );
        button("synthesize-new-draft").click();
        await flush();
        expect(host.textContent).toContain(
            "New-draft synthesis/status unavailable or failed",
        );
        expect(host.textContent).toContain(
            "Runbook synthesis capability unavailable",
        );
        expect(host.textContent).not.toContain("Job ID:");
        expect(onChanged).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalled();
        expect(
            host.querySelector<HTMLInputElement>('[name="runbook-title"]')
                ?.value,
        ).toBe("Keep current edited edition");
    });
    test("missing updated revision cannot start synthesis and bounded status lookup retains last known exact job", async () => {
        await updatedComparison(false);
        expect(button("synthesize-new-draft").disabled).toBe(true);
        button("synthesize-new-draft").click();
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubSynthesizeRunbook",
        );
        await updatedComparison(true);
        mockView.mockResolvedValueOnce({
            jobId: "last-known",
            corpusId: "corpus-a",
            sourceId: citation.sourceId,
            revisionId: "revision-updated",
            createdAt: "2026-10-02T19:00:00Z",
            updatedAt: "2026-10-02T19:00:00Z",
            state: "running",
            candidateIds: [],
            warnings: [],
        });
        button("synthesize-new-draft").click();
        await flush();
        mockView.mockResolvedValueOnce([]);
        button("refresh-synthesis-job").click();
        await flush();
        expect(host.textContent).toContain(
            "Exact job is not in the bounded latest-job list",
        );
        expect(host.textContent).toContain("Job ID: last-known");
        expect(host.textContent).toContain("Durable state: running");
        click("History");
        click("Overview");
        const stale = procedure();
        stale.state = "stale";
        mockView.mockResolvedValueOnce({
            previous: [original()],
            updated: [
                {
                    ...original(),
                    citation: { ...citation, revisionId: "revision-updated" },
                },
            ],
            current: stale,
            affectedSteps: [],
            warnings: [],
        });
        button("compare-runbook").click();
        await flush();
        expect(host.textContent).toContain(
            "Last known durable job record retained",
        );
        expect(host.textContent).toContain("Job ID: last-known");
        expect(button("synthesize-new-draft").disabled).toBe(true);
        expect(
            mockView.mock.calls.filter(
                ([method]) => method === "memoryHubSynthesizeRunbook",
            ),
        ).toHaveLength(1);
    });
    function candidateSummary(
        objectId: string,
        corpusId = "corpus-a",
    ): RunbookSummary {
        return {
            ...summary(),
            id: `${corpusId}:candidate:${objectId}`,
            kind: "candidate",
            corpusId,
            corpusName: corpusId === "corpus-b" ? "Corpus B" : "Corpus A",
            objectId,
            title: objectId,
            state: "detected",
            readiness: "detected",
            latestVersion: undefined,
        };
    }
    function candidateDetail(
        candidateId: string,
        corpusId = "corpus-a",
    ): RunbookDetail {
        return {
            ...detail(),
            corpusId,
            procedure: undefined,
            history: [],
            candidate: {
                ...procedure().document,
                title: candidateId,
                candidateId,
                corpusId,
                state: "detected",
                createdAt: "2026-10-02T12:00:00Z",
                updatedAt: "2026-10-02T12:00:00Z",
            },
        };
    }
    test("saving last candidate preserves loaded-page cursor across kind change and navigates back to saved procedure, corpus-qualified", async () => {
        activeScope = undefined;
        mockView.mockResolvedValueOnce({
            items: [
                candidateSummary("worker", "corpus-b"),
                candidateSummary("middle"),
                candidateSummary("worker"),
            ],
            total: 3,
            errors: [],
            warnings: [],
        });
        await workspace.show();
        current = candidateDetail("worker");
        await workspace.show({
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "worker",
        });
        expect(button("previous-runbook").disabled).toBe(false);
        const saved = {
            ...procedure(1),
            procedureId: "worker",
            basedOnCandidateId: "worker",
        };
        mockView.mockResolvedValueOnce(saved);
        button("save-runbook").click();
        await flush();
        expect(button("previous-runbook").disabled).toBe(false);
        expect(button("next-runbook").disabled).toBe(true);
        expect(host.textContent).not.toContain(
            "Previous/Next use the loaded list page",
        );
        current = candidateDetail("middle");
        button("previous-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "middle",
        });
        current = { ...detail(), procedure: saved };
        button("next-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "procedure",
            objectId: "worker",
        });
        expect(button("previous-runbook").disabled).toBe(false);
    });
    test("candidate save with changed procedure ID preserves its slot and skips another row resolving to same procedure", async () => {
        mockView.mockResolvedValueOnce({
            items: [
                candidateSummary("middle"),
                { ...summary(), objectId: "saved-worker" },
                candidateSummary("worker"),
            ],
            total: 3,
            errors: [],
            warnings: [],
        });
        await workspace.show();
        current = candidateDetail("worker");
        await workspace.show({
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "worker",
        });
        mockView.mockResolvedValueOnce({
            ...procedure(1),
            procedureId: "saved-worker",
            basedOnCandidateId: "worker",
        });
        button("save-runbook").click();
        await flush();
        expect(button("previous-runbook").disabled).toBe(false);
        current = candidateDetail("middle");
        button("previous-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "middle",
        });
    });
    test("reject preserves position by opening next remaining candidate and excludes rejected row from Previous", async () => {
        mockView.mockResolvedValueOnce({
            items: [
                candidateSummary("first"),
                candidateSummary("middle"),
                candidateSummary("last"),
            ],
            total: 3,
            errors: [],
            warnings: [],
        });
        await workspace.show();
        current = candidateDetail("middle");
        await workspace.show({
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "middle",
        });
        mockMemory.mockResolvedValueOnce(undefined);
        current = candidateDetail("last");
        button("reject-candidate").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "last",
        });
        expect(button("previous-runbook").disabled).toBe(false);
        current = candidateDetail("first");
        button("previous-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith("memoryHubRunbook", {
            corpusId: "corpus-a",
            kind: "candidate",
            objectId: "first",
        });
        expect(
            mockView.mock.calls.filter(
                ([method]) => method === "memoryHubRunbooks",
            ),
        ).toHaveLength(1);
    });
    test("stored literal and symbolic binding arguments survive accepted response and subsequent version save", async () => {
        await bindingDialog();
        click("Select Real catalog tool");
        const args: RunbookBindingArguments = {
            name: { $input: "name" },
            nested: ["literal", { $input: "name" }],
            escaped: { $literal: { $input: "not-a-reference" } },
        };
        field("binding-arguments", JSON.stringify(args));
        check("binding-confirmed");
        const bound = procedure(4);
        if (!bound.document.agentEdition)
            throw new Error("Missing edition fixture");
        bound.document.agentEdition.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "server",
            targetId: "tool",
            version: actualMcpFingerprint,
            fingerprint: actualMcpFingerprint,
            arguments: args,
        };
        bound.document.agentEdition.review = {
            state: "draft",
            reason: "Binding changed",
        };
        mockView.mockResolvedValueOnce(bound);
        button("accept-binding").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubAcceptBinding",
            expect.objectContaining({ targetId: actualMcpId, arguments: args }),
        );
        mockView.mockResolvedValueOnce({ ...bound, version: 5 });
        button("save-runbook").click();
        await flush();
        expect(mockView).toHaveBeenLastCalledWith(
            "memoryHubSaveRunbook",
            expect.objectContaining({
                expectedVersion: 4,
                document: expect.objectContaining({
                    agentEdition: expect.objectContaining({
                        steps: [
                            expect.objectContaining({
                                binding: expect.objectContaining({
                                    arguments: args,
                                }),
                            }),
                        ],
                    }),
                }),
            }),
        );
    });
    test("binding dialog preloads stored arguments instead of silently replacing them with empty mapping", async () => {
        const args: RunbookBindingArguments = { name: { $input: "name" } };
        const guide = procedure();
        if (!guide.document.agentEdition)
            throw new Error("Missing edition fixture");
        guide.document.agentEdition.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "server",
            targetId: "tool",
            version: actualMcpFingerprint,
            fingerprint: actualMcpFingerprint,
            arguments: args,
        };
        current.procedure = guide;
        await bindingDialog();
        expect(
            host.querySelector<HTMLTextAreaElement>(
                '[name="binding-arguments"]',
            )?.value,
        ).toBe(JSON.stringify(args, undefined, 2));
    });
    test("legacy identity-only catalog review cannot preview until arguments are explicitly re-reviewed", async () => {
        const guide = procedure();
        if (!guide.document.agentEdition)
            throw new Error("Missing edition fixture");
        guide.document.agentEdition.steps[0].binding = {
            kind: "mcp",
            accepted: true,
            serverId: "server",
            targetId: "tool",
            version: actualMcpFingerprint,
            fingerprint: actualMcpFingerprint,
        };
        current.procedure = guide;
        await open();
        click("Skill");
        field("skill-name", "operator-guide");
        expect(host.textContent).toContain(
            "Catalog binding arguments require explicit re-review",
        );
        expect(button("preview-skill").disabled).toBe(true);
        if (guide.document.agentEdition.review.state !== "reviewed")
            throw new Error("Missing reviewed fixture");
        guide.document.agentEdition.review.argumentsValidation = "accepted";
        await open();
        click("Skill");
        field("skill-name", "operator-guide");
        expect(button("preview-skill").disabled).toBe(false);
    });
    test("unknown symbolic input rejects before acceptance and retains unaccepted argument draft", async () => {
        await bindingDialog();
        click("Select Real catalog tool");
        field("binding-arguments", '{"name":{"$input":"missing-input"}}');
        check("binding-confirmed");
        button("accept-binding").click();
        await flush();
        expect(mockView.mock.calls.map(([method]) => method)).not.toContain(
            "memoryHubAcceptBinding",
        );
        expect(onError).toHaveBeenCalled();
        expect(
            host.querySelector<HTMLTextAreaElement>(
                '[name="binding-arguments"]',
            )?.value,
        ).toContain("missing-input");
        expect(host.querySelector("dialog")?.open).toBe(true);
    });
});
