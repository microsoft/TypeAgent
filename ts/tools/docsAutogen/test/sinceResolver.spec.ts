// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveSinceRef } from "../src/sinceResolver.js";
import { Git, type GitResult, type GitRunner } from "../src/git.js";

interface FakeRepo {
    branch: string | null;
    refs: Map<string, string>;
    tags: Map<string, string>;
    mergeBases: Map<string, string>;
}

function fakeRunner(repo: FakeRepo): GitRunner {
    return async (args): Promise<GitResult> => {
        const ok = (stdout: string): GitResult => ({
            stdout,
            stderr: "",
            code: 0,
        });
        const fail = (): GitResult => ({ stdout: "", stderr: "", code: 1 });

        // Strip optional `--end-of-options` separators that the
        // production code emits to harden against second-order
        // command-injection (a ref starting with `-` would otherwise
        // be interpreted by git as an option).
        const filtered = args.filter((a) => a !== "--end-of-options");

        if (
            filtered[0] === "rev-parse" &&
            filtered[1] === "--verify" &&
            filtered[2] === "--quiet"
        ) {
            const ref = filtered[3]!;
            const sha =
                repo.refs.get(ref) ??
                repo.refs.get(stripTagPrefix(ref)) ??
                repo.tags.get(stripTagPrefix(ref));
            return sha !== undefined ? ok(`${sha}\n`) : fail();
        }
        if (
            filtered[0] === "symbolic-ref" &&
            filtered[1] === "--quiet" &&
            filtered[2] === "--short"
        ) {
            return repo.branch !== null ? ok(`${repo.branch}\n`) : fail();
        }
        if (filtered[0] === "merge-base") {
            const a = filtered[1]!;
            const b = filtered[2]!;
            const key = `${a}|${b}`;
            const found = repo.mergeBases.get(key);
            return found !== undefined ? ok(`${found}\n`) : fail();
        }
        if (filtered[0] === "rev-parse" && filtered[1] === "HEAD") {
            const head = repo.refs.get("HEAD");
            return head !== undefined ? ok(`${head}\n`) : fail();
        }
        throw new Error(`fakeRunner: unhandled git ${args.join(" ")}`);
    };
}

function stripTagPrefix(ref: string): string {
    return ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : ref;
}

describe("resolveSinceRef", () => {
    it("uses --since explicitly when provided", async () => {
        const repo: FakeRepo = {
            branch: "main",
            refs: new Map([["v1.0.0", "deadbeef"]]),
            tags: new Map(),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git, { explicit: "v1.0.0" });
        expect(r.source).toBe("explicit");
        if (r.source === "explicit") {
            expect(r.sinceRef).toBe("v1.0.0");
            expect(r.sinceSha).toBe("deadbeef");
        }
    });

    it("throws if --since ref does not exist", async () => {
        const repo: FakeRepo = {
            branch: "main",
            refs: new Map(),
            tags: new Map(),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        await expect(
            resolveSinceRef(git, { explicit: "missing" }),
        ).rejects.toThrow(/missing/u);
    });

    it("uses merge-base with origin/main on a feature branch", async () => {
        const repo: FakeRepo = {
            branch: "feature/x",
            refs: new Map([
                ["origin/main", "remote-sha"],
                ["HEAD", "head-sha"],
            ]),
            tags: new Map([["docs-bot/last-run", "watermark-sha"]]),
            mergeBases: new Map([["HEAD|origin/main", "merge-base-sha"]]),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git);
        expect(r.source).toBe("merge-base");
        if (r.source === "merge-base") {
            expect(r.sinceRef).toBe("origin/main");
            expect(r.sinceSha).toBe("merge-base-sha");
            expect(r.branch).toBe("feature/x");
        }
    });

    it("falls back to watermark on the default branch", async () => {
        const repo: FakeRepo = {
            branch: "main",
            refs: new Map([
                ["origin/main", "remote-sha"],
                ["HEAD", "head-sha"],
            ]),
            tags: new Map([["docs-bot/last-run", "watermark-sha"]]),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git);
        expect(r.source).toBe("watermark");
        if (r.source === "watermark") {
            expect(r.sinceSha).toBe("watermark-sha");
        }
    });

    it("falls back to watermark when origin/main is missing", async () => {
        const repo: FakeRepo = {
            branch: "feature/x",
            refs: new Map([["HEAD", "head-sha"]]),
            tags: new Map([["docs-bot/last-run", "watermark-sha"]]),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git);
        expect(r.source).toBe("watermark");
    });

    it("returns source: 'none' with onDefaultBranch on the default branch (cold start)", async () => {
        const repo: FakeRepo = {
            branch: "main",
            refs: new Map([["HEAD", "head-sha"]]),
            tags: new Map(),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git);
        expect(r.source).toBe("none");
        if (r.source === "none") {
            expect(r.onDefaultBranch).toBe(true);
        }
    });

    it("returns source: 'none' with onDefaultBranch false off the default branch with no baseline", async () => {
        const repo: FakeRepo = {
            branch: "feature/x",
            refs: new Map([["HEAD", "head-sha"]]),
            tags: new Map(),
            mergeBases: new Map(),
        };
        const git = new Git("/repo", fakeRunner(repo));
        const r = await resolveSinceRef(git);
        expect(r.source).toBe("none");
        if (r.source === "none") {
            expect(r.onDefaultBranch).toBe(false);
        }
    });
});
