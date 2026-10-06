// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionWatchRequest } from "./sessionWatcher.js";

// File storage for git-story: one JSON file per record, two roots.
//
//   <git common dir>/story/            "repo" (worktrees share it)
//   ├── version                        "1"
//   └── sessions/
//       └── 7f3c…e1.json               { projectPath, sessionId,
//                                        transcriptPath, metadata,
//                                        registeredAt }
//
//   ~/.typeagent/git-story/            "shared" (cross-repo)
//   ├── version                        "1"
//   └── repos/
//       └── typeagent.json             { gitCommonDir, registeredAt }
//
// Writes go to a temp file in the same dir, then rename, so readers
// see the old or new record, never a partial one.

export type SessionRecord = SessionWatchRequest & { registeredAt: string };
export type RepoRecord = { gitCommonDir: string; registeredAt: string };

export type Collection<T> = {
    get(id: string): T | undefined;
    put(id: string, record: T): void;
    list(): string[];
    delete(id: string): void;
};

export type StoreKind = "repo" | "shared";
type Collections = {
    repo: { sessions: Collection<SessionRecord> };
    shared: { repos: Collection<RepoRecord> };
};
export type Store<K extends StoreKind> = Collections[K] & {
    readonly kind: K;
    readonly root: string;
};

export type StoreOptions = {
    // Repo store: any path inside the repo or worktree. Default: process.cwd().
    cwd?: string;
    // Override root resolution, e.g. temp dirs in tests.
    resolveRoot?: (kind: StoreKind, cwd: string) => string;
};

const STORE_VERSION = 1;
const VERSION_FILE = "version";
const RECORD_EXT = ".json";
const REPO_STORE_DIR = "story";
const SHARED_STORE_DIR = [".typeagent", "git-story"];
const COLLECTION_NAMES: Record<StoreKind, string[]> = {
    repo: ["sessions"],
    shared: ["repos"],
};
// Record ids become file names: no separators, no leading dot.
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

// Default roots. The repo root lives in the git common dir so all
// worktrees of one repo share it.
export function resolveStoreRoot(kind: StoreKind, cwd: string): string {
    if (kind === "shared") {
        return path.join(os.homedir(), ...SHARED_STORE_DIR);
    }
    const commonDir = execFileSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd, encoding: "utf8", stdio: "pipe" },
    ).trim();
    return path.join(commonDir, REPO_STORE_DIR);
}

export function openStore<K extends StoreKind>(
    kind: K,
    options: StoreOptions = {},
): Store<K> {
    const cwd = options.cwd ?? process.cwd();
    let root: string;
    try {
        root = (options.resolveRoot ?? resolveStoreRoot)(kind, cwd);
        fs.mkdirSync(root, { recursive: true });
        checkVersion(root);
        for (const name of COLLECTION_NAMES[kind]) {
            fs.mkdirSync(path.join(root, name), { recursive: true });
        }
    } catch (e) {
        throw new Error(
            `git-story: cannot open ${kind} store from ${cwd}: ${(e as Error).message}`,
        );
    }
    const store: Record<string, unknown> = { kind, root };
    for (const name of COLLECTION_NAMES[kind]) {
        store[name] = collection(path.join(root, name));
    }
    return store as unknown as Store<K>;
}

// Write the version on first open; refuse roots from newer code.
function checkVersion(root: string): void {
    const file = path.join(root, VERSION_FILE);
    if (!fs.existsSync(file)) {
        writeAtomic(file, `${STORE_VERSION}\n`);
        return;
    }
    const found = Number(fs.readFileSync(file, "utf8").trim());
    if (!Number.isInteger(found) || found > STORE_VERSION) {
        throw new Error(
            `${file}: version ${found} is newer than supported ${STORE_VERSION}`,
        );
    }
}

function collection<T>(dir: string): Collection<T> {
    const fileFor = (id: string) => {
        if (!SAFE_ID.test(id)) {
            throw new Error(
                `git-story: invalid record id ${JSON.stringify(id)}`,
            );
        }
        return path.join(dir, id + RECORD_EXT);
    };
    const readError = (file: string, e: unknown) =>
        new Error(`git-story: cannot read ${file}: ${(e as Error).message}`);
    return {
        get(id) {
            const file = fileFor(id);
            let text: string;
            try {
                text = fs.readFileSync(file, "utf8");
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                    return undefined;
                }
                throw readError(file, e);
            }
            try {
                return JSON.parse(text) as T;
            } catch (e) {
                throw readError(file, e);
            }
        },
        put(id, record) {
            writeAtomic(fileFor(id), JSON.stringify(record, null, 2) + "\n");
        },
        list() {
            return fs
                .readdirSync(dir)
                .filter((f) => f.endsWith(RECORD_EXT) && !f.startsWith("."))
                .map((f) => f.slice(0, -RECORD_EXT.length));
        },
        delete(id) {
            fs.rmSync(fileFor(id), { force: true });
        },
    };
}

// Temp file in the target dir (same filesystem), then rename over it.
function writeAtomic(file: string, data: string): void {
    const tmp = path.join(
        path.dirname(file),
        `.${path.basename(file)}.${process.pid}.tmp`,
    );
    try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, file);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
    }
}
