// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const hashKeys = [
    "owner",
    "manifest",
    "result",
    "corpus",
    "reviewedDraft",
    "version",
    "trace",
    "originals",
];
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function requireApproved(condition, message) {
    if (!condition)
        throw Object.assign(new Error(`Approved reuse blocked: ${message}`), {
            status: "blocked",
        });
}

export function validateApprovedCatalogConfig(source) {
    requireApproved(
        source &&
            typeof source === "object" &&
            !Array.isArray(source) &&
            isDeepStrictEqual(Object.keys(source).sort(), [
                "artifactRoot",
                "macroId",
                "owner",
                "restartCase",
                "sourceHashes",
                "version",
            ]),
        "exact source/reference/hash configuration required",
    );
    requireApproved(
        typeof source.artifactRoot === "string" &&
            path.isAbsolute(source.artifactRoot) &&
            guid.test(source.owner ?? "") &&
            /^[a-f0-9]{64}$/u.test(source.macroId ?? "") &&
            Number.isSafeInteger(source.version) &&
            source.version > 1 &&
            typeof source.restartCase === "string" &&
            source.restartCase.trim() !== "",
        "explicit owned root, owner, immutable version and restart case required",
    );
    requireApproved(
        source.sourceHashes &&
            isDeepStrictEqual(
                Object.keys(source.sourceHashes).sort(),
                [...hashKeys].sort(),
            ) &&
            hashKeys.every((key) =>
                /^[a-f0-9]{64}$/u.test(source.sourceHashes[key] ?? ""),
            ),
        "all historical provenance hashes required",
    );
}

function physical(file) {
    const resolved = path.resolve(file);
    requireApproved(
        !fs.lstatSync(resolved).isSymbolicLink() &&
            fs.realpathSync(resolved) === resolved,
        `noncanonical or linked source path: ${file}`,
    );
    return resolved;
}

function readPinned(root, relative, expected, pins) {
    const resolved = path.resolve(root, relative);
    requireApproved(
        path.relative(root, resolved) !== "" &&
            !path.relative(root, resolved).startsWith("..") &&
            !path.isAbsolute(path.relative(root, resolved)),
        "historical source path escapes owned root",
    );
    const file = physical(resolved);
    const sha256 = digest(fs.readFileSync(file));
    requireApproved(
        sha256 === expected,
        `historical source changed: ${relative}`,
    );
    pins.push({ file, sha256 });
    return file;
}

function definition(macro) {
    const {
        version: _version,
        state: _state,
        createdAt: _createdAt,
        ...body
    } = macro;
    return body;
}

function verifyHistoricalApproval(source, report, macro, draft) {
    requireApproved(
        report.operatorActions?.some(
            (action) =>
                action.operation ===
                    "external bounded synthetic review/approve" &&
                action.reference?.macroId === source.macroId &&
                action.reference.version === source.version &&
                action.reference.state === "approved",
        ) &&
            report.trials?.some(
                (trial) =>
                    trial.candidate === "training" &&
                    trial.grade?.status === "passed" &&
                    trial.grade.taskCorrect === true,
            ),
        "actual prior reviewed publication and selected training required",
    );
    requireApproved(
        macro.macroId === source.macroId &&
            macro.version === source.version &&
            macro.state === "approved" &&
            draft.state === "draft" &&
            draft.version === source.version - 1 &&
            isDeepStrictEqual(definition(macro), definition(draft)),
        "immutable approved definition differs from the actually reviewed draft",
    );
}

export function verifyApprovedCatalogSource(source, corpus, evaluatorRoot) {
    validateApprovedCatalogConfig(source);
    const root = physical(source.artifactRoot);
    const relative = path.relative(physical(evaluatorRoot), root);
    requireApproved(
        relative !== "" &&
            !relative.startsWith("..") &&
            !path.isAbsolute(relative),
        "source must be a recorded evaluator-owned root",
    );
    const pins = [];
    const read = (key, file) =>
        json(readPinned(root, file, source.sourceHashes[key], pins));
    const owner = read("owner", "evaluation-owner.json");
    requireApproved(owner.owner === source.owner, "source owner changed");
    const manifest = read("manifest", "manifest.json");
    const report = read("result", "result.json");
    const recordedCorpus = read("corpus", "corpus.json");
    requireApproved(
        isDeepStrictEqual(recordedCorpus, corpus) &&
            manifest.corpusHash === digest(JSON.stringify(corpus)),
        "current controlled corpus differs from historical source",
    );
    const instance = `macro-eval-${source.owner.slice(0, 8)}`;
    const store = path.join("data", "profiles", instance, "copilot-macros");
    const versionFile = readPinned(
        root,
        path.join(
            store,
            "macros",
            source.macroId,
            "versions",
            `${source.version}.json`,
        ),
        source.sourceHashes.version,
        pins,
    );
    const macro = json(versionFile);
    const draft = read("reviewedDraft", "reviewed-draft.json");
    verifyHistoricalApproval(source, report, macro, draft);
    const audit = report.selectedSourceAudit;
    requireApproved(
        audit?.kind === "native-finalized-synthetic-source-audit-v1" &&
            audit.summary?.traceId === macro.sourceTraceId &&
            guid.test(macro.sourceTraceId ?? "") &&
            guid.test(audit.summary.sessionId ?? "") &&
            isDeepStrictEqual(
                macro.steps.map((step) => step.sourceToolCallId),
                audit.native?.toolCallIds,
            ),
        "published version is not the pinned finalized selected source",
    );
    const traceFile = readPinned(
        root,
        path.join(store, "traces", `${macro.sourceTraceId}.json`),
        source.sourceHashes.trace,
        pins,
    );
    requireApproved(
        audit.traceFile === traceFile &&
            audit.sha256 === source.sourceHashes.trace,
        "historical physical trace identity/hash mismatch",
    );
    readPinned(
        root,
        path.join(
            "data",
            "native-sdk-originals",
            `${audit.summary.sessionId}.jsonl`,
        ),
        source.sourceHashes.originals,
        pins,
    );
    return {
        root,
        owner: source.owner,
        instance,
        macro,
        versionFile,
        manifest,
        report,
        pins,
        learningFile: path.join(root, store, "learning.json"),
    };
}

const retainedPaths = [
    ["plugin", "plugin"],
    ["plugin-data", "plugin-data"],
    [path.join("workspace", ".mcp.json"), "workspace-mcp"],
    [path.join("data", "native-control"), "control"],
    [path.join("data", "native-control-admission.json"), "admission"],
    [path.join("data", "native-control-diagnostic-result.json"), "diagnostic"],
    [path.join("data", "native-control-getter-process.json"), "getter"],
];

export function ownApprovedCatalogPhase(output, source) {
    const artifacts = path.resolve(output);
    requireApproved(
        path.dirname(artifacts) === source.root,
        "fresh phase output must be a direct child of the same canonical owned root",
    );
    const lock = path.join(source.root, ".approved-reuse.lock");
    const phaseId = randomUUID();
    const lockBytes = JSON.stringify({
        phaseId,
        owner: source.owner,
        pid: process.pid,
    });
    fs.writeFileSync(lock, lockBytes, { flag: "wx", mode: 0o600 });
    try {
        fs.mkdirSync(artifacts);
        fs.writeFileSync(
            path.join(artifacts, "phase-owner.json"),
            JSON.stringify({
                phaseId,
                owner: source.owner,
                canonicalRoot: source.root,
            }),
            { flag: "wx", mode: 0o600 },
        );
    } catch (error) {
        fs.unlinkSync(lock);
        throw error;
    }
    let homeOffset = 1;
    while (
        [homeOffset, homeOffset + 1].some(
            (index) =>
                fs.existsSync(path.join(source.root, `home-${index}`)) ||
                fs.existsSync(path.join(source.root, `normal-hook-${index}`)),
        )
    )
        homeOffset++;
    const backup = path.join(artifacts, "retained-history");
    const current = path.join(artifacts, "current-control");
    const moved = [];
    let begun = false;
    let learningBytes;
    const checkLock = () =>
        requireApproved(
            fs.readFileSync(lock, "utf8") === lockBytes,
            "phase ownership lock changed; refusing scoped mutation/release",
        );
    return {
        artifacts,
        homeOffset,
        phaseId,
        verifyLearningUnchanged() {
            requireApproved(begun && learningBytes, "phase has not begun");
            compareLearningState(source, learningBytes);
        },
        begin() {
            checkLock();
            requireApproved(!begun, "phase transaction already begun");
            begun = true;
            physical(source.learningFile);
            learningBytes = fs.readFileSync(source.learningFile);
            fs.mkdirSync(backup);
            for (const [relative, name] of retainedPaths) {
                const file = path.join(source.root, relative);
                const existed = fs.existsSync(file);
                if (existed) {
                    physical(file);
                    fs.renameSync(file, path.join(backup, name));
                }
                moved.push([file, name, existed]);
            }
            fs.mkdirSync(path.join(source.root, "plugin-data"));
        },
        restore() {
            checkLock();
            fs.mkdirSync(current);
            for (const [file, name, existed] of moved.toReversed()) {
                if (fs.existsSync(file))
                    fs.renameSync(file, path.join(current, name));
                if (existed) fs.renameSync(path.join(backup, name), file);
            }
            try {
                if (learningBytes)
                    restoreLearningConfiguration(source, learningBytes);
                verifyApprovedSourcePins(source);
            } finally {
                fs.unlinkSync(lock);
            }
        },
    };
}

function restoreLearningConfiguration(source, bytes) {
    compareLearningState(source, bytes);
    fs.writeFileSync(source.learningFile, bytes);
}

function compareLearningState(source, bytes) {
    const before = JSON.parse(bytes.toString("utf8"));
    const after = json(physical(source.learningFile));
    const cwd = path.join(source.root, "workspace").toLowerCase();
    requireApproved(
        [before, after].every(
            (state) =>
                Array.isArray(state.preferences) &&
                state.preferences.length === 1 &&
                state.preferences[0].cwd === cwd,
        ),
        "only the exact owned workspace preference may be restored",
    );
    const { preferences: _beforePreferences, ...beforeState } = before;
    const { preferences: _afterPreferences, ...afterState } = after;
    requireApproved(
        isDeepStrictEqual(beforeState, afterState) &&
            isDeepStrictEqual(
                learningPreferenceIdentities(before.preferences),
                learningPreferenceIdentities(after.preferences),
            ),
        "pure RUN altered learning jobs/suppression; refusing to discard changes",
    );
}

function learningPreferenceIdentities(preferences) {
    requireApproved(
        Array.isArray(preferences),
        "preference rows must be an array",
    );
    return preferences.map((preference) => {
        const { mode: _mode, revision: _revision, ...identity } = preference;
        return identity;
    });
}

export function verifyApprovedSourcePins(source) {
    for (const pin of source.pins)
        requireApproved(
            digest(fs.readFileSync(physical(pin.file))) === pin.sha256,
            `historical immutable source changed: ${pin.file}`,
        );
}

export function verifyApprovedVersionUnchanged(source) {
    requireApproved(
        digest(fs.readFileSync(source.versionFile)) ===
            source.pins.find((pin) => pin.file === source.versionFile)?.sha256,
        "canonical approved version changed",
    );
}
