// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    listVersionRefs,
    listRemoteRefs,
    resolveRef,
    resolveVersionProvenance,
    type GitExec,
} from "../gitRefProvider.js";

const FS = "\u001f";

/** Build a stub GitExec that returns canned stdout keyed by the first arg. */
function stubExec(
    responses: Record<string, string>,
    failing: Set<string> = new Set(),
): GitExec {
    return async (args) => {
        const key = args.join(" ");
        if (failing.has(args[0])) {
            throw new Error(`git ${key} failed`);
        }
        // Match on a prefix so callers can key by the leading subcommand.
        for (const [prefix, out] of Object.entries(responses)) {
            if (key.startsWith(prefix)) {
                return out;
            }
        }
        throw new Error(`unexpected git ${key}`);
    };
}

test("listVersionRefs enumerates working tree, HEAD, branches, tags, commits", async () => {
    const exec = stubExec({
        // First line's %D decoration names the current branch; both lines are
        // the recent-commit list.
        "log -n": [
            `a1b2c3d${FS}fix the rule${FS}HEAD -> feature, origin/feature`,
            `9988776${FS}base commit${FS}`,
        ].join("\n"),
        // Branches and tags in one for-each-ref pass; full refname classifies.
        "for-each-ref --sort=-committerdate": [
            `refs/heads/feature${FS}feature${FS}a1b2c3d${FS}fix the rule`,
            `refs/heads/main${FS}main${FS}9988776${FS}base commit`,
            `refs/tags/v1.0${FS}v1.0${FS}9988776${FS}release one`,
        ].join("\n"),
    });

    const refs = await listVersionRefs(exec);
    const labels = refs.map((r) => r.label);

    // Working tree is always first.
    assert.deepEqual(refs[0].spec, { kind: "workingTree" });
    assert.equal(refs[0].label, "working tree");

    // HEAD reflects the current branch name.
    assert.ok(labels.includes("HEAD (feature)"));

    // Current branch is marked and sorted to the front of the branch list.
    assert.ok(labels.includes("feature (current)"));
    assert.ok(labels.includes("main"));
    const featureIdx = labels.indexOf("feature (current)");
    const mainIdx = labels.indexOf("main");
    assert.ok(featureIdx < mainIdx);

    // Tag and commit entries appear with git-ref specs.
    const tag = refs.find((r) => r.label === "v1.0");
    assert.deepEqual(tag?.spec, { kind: "git", ref: "v1.0" });
    const commit = refs.find((r) => r.label.startsWith("9988776 "));
    assert.deepEqual(commit?.spec, { kind: "git", ref: "9988776" });
});

test("listVersionRefs degrades to working tree outside a git repo", async () => {
    const exec = stubExec({}, new Set(["log", "for-each-ref"]));
    const refs = await listVersionRefs(exec);
    assert.equal(refs.length, 1);
    assert.deepEqual(refs[0].spec, { kind: "workingTree" });
});

test("listVersionRefs handles detached HEAD", async () => {
    const exec = stubExec({
        // No `HEAD -> ` segment in the decoration → detached.
        "log -n": `a1b2c3d${FS}detached work${FS}`,
        "for-each-ref --sort=-committerdate": "",
    });
    const refs = await listVersionRefs(exec);
    const head = refs.find(
        (r) => r.spec.kind === "git" && r.spec.ref === "HEAD",
    );
    assert.equal(head?.label, "HEAD");
    assert.ok(head?.tooltip.includes("detached"));
});

test("listRemoteRefs lists remote branches and skips the origin/HEAD pointer", async () => {
    const exec = stubExec({
        "for-each-ref --sort=-committerdate": [
            `origin/HEAD${FS}0000000${FS}`,
            `origin/main${FS}9988776${FS}base commit`,
            `origin/feature${FS}a1b2c3d${FS}fix the rule`,
        ].join("\n"),
    });
    const refs = await listRemoteRefs(exec);
    const names = refs.map((r) => r.label);
    assert.ok(!names.includes("origin/HEAD"));
    assert.ok(names.includes("origin/main"));
    assert.ok(names.includes("origin/feature"));
    const main = refs.find((r) => r.label === "origin/main");
    assert.deepEqual(main?.spec, { kind: "git", ref: "origin/main" });
});

test("listRemoteRefs returns empty when enumeration fails", async () => {
    const exec = stubExec({}, new Set(["for-each-ref"]));
    const refs = await listRemoteRefs(exec);
    assert.deepEqual(refs, []);
});

test("resolveRef resolves a typed commit to a git-ref version", async () => {
    const exec = stubExec({
        "log -n 1": `a1b2c3d${FS}fix the rule`,
    });
    const resolved = await resolveRef(exec, "  a1b2c3d  ");
    assert.deepEqual(resolved?.spec, { kind: "git", ref: "a1b2c3d" });
    assert.ok(resolved?.label.includes("fix the rule"));
    assert.ok(resolved?.tooltip.includes("a1b2c3d"));
});

test("resolveRef returns undefined for an unresolvable ref", async () => {
    const exec = stubExec({}, new Set(["log"]));
    const resolved = await resolveRef(exec, "deadbeef");
    assert.equal(resolved, undefined);
});

test("resolveRef returns undefined for empty input", async () => {
    const exec = stubExec({ "log -n 1": `a1b2c3d${FS}x` });
    const resolved = await resolveRef(exec, "   ");
    assert.equal(resolved, undefined);
});

test("resolveVersionProvenance pins a git ref to its short SHA", async () => {
    const exec = stubExec({
        "rev-parse --short --end-of-options": "a1b2c3d\n",
    });
    const prov = await resolveVersionProvenance(
        { kind: "git", ref: "HEAD" },
        exec,
    );
    assert.deepEqual(prov, {
        label: "HEAD",
        workingTree: false,
        sha: "a1b2c3d",
    });
});

test("resolveVersionProvenance guards a ref with --end-of-options", async () => {
    let captured: string[] = [];
    const exec: GitExec = async (args) => {
        captured = args;
        return "a1b2c3d\n";
    };
    await resolveVersionProvenance({ kind: "git", ref: "--output=evil" }, exec);
    // `--end-of-options` must precede the ref so a leading-dash ref can't be
    // parsed as a git option.
    const eo = captured.indexOf("--end-of-options");
    assert.ok(eo >= 0, "expected --end-of-options in the rev-parse args");
    assert.equal(captured[eo + 1], "--output=evil");
});

test("resolveVersionProvenance records the HEAD a working tree sits on", async () => {
    const exec = stubExec({ "rev-parse --short HEAD": "a1b2c3d\n" });
    const prov = await resolveVersionProvenance({ kind: "workingTree" }, exec);
    assert.deepEqual(prov, {
        label: "working tree",
        workingTree: true,
        sha: "a1b2c3d",
    });
});

test("resolveVersionProvenance degrades when the ref can't be resolved", async () => {
    const exec = stubExec({}, new Set(["rev-parse"]));
    const prov = await resolveVersionProvenance(
        { kind: "git", ref: "nope" },
        exec,
    );
    assert.deepEqual(prov, { label: "nope", workingTree: false });
});
