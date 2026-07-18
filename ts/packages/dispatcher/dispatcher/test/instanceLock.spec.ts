// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lockInstanceDir } from "../src/utils/fsUtils.js";

function makeInstanceDir(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "instancelock-"));
    return path.join(base, "profile");
}

function lockPaths(instanceDir: string) {
    const lockFolder = `${instanceDir}.lock`;
    return {
        lockFolder,
        held: path.join(lockFolder, "held"),
        marker: path.join(lockFolder, `pid-${process.pid}`),
    };
}

async function waitFor(
    predicate: () => boolean,
    timeoutMs: number,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return predicate();
}

describe("lockInstanceDir", () => {
    it("drops a pid-named owner marker inside the lock folder", async () => {
        const instanceDir = makeInstanceDir();
        const { held, marker } = lockPaths(instanceDir);

        const unlock = await lockInstanceDir(instanceDir);
        try {
            expect(fs.existsSync(held)).toBe(true);
            expect(fs.existsSync(marker)).toBe(true);
            // The body carries enough to identify the owner.
            const body = fs.readFileSync(marker, "utf8");
            expect(body).toContain(`pid: ${process.pid}`);
            expect(body).toContain(`host: ${os.hostname()}`);
        } finally {
            await unlock();
        }
    });

    it("removes the marker and lock folder on unlock", async () => {
        const instanceDir = makeInstanceDir();
        const { lockFolder } = lockPaths(instanceDir);

        const unlock = await lockInstanceDir(instanceDir);
        expect(fs.existsSync(lockFolder)).toBe(true);
        await unlock();

        expect(fs.existsSync(lockFolder)).toBe(false);
    });

    it("recursively removes a non-empty lock folder on unlock", async () => {
        const instanceDir = makeInstanceDir();
        const { lockFolder } = lockPaths(instanceDir);

        const unlock = await lockInstanceDir(instanceDir);
        // A stray entry (and a stray subdir) must not defeat cleanup: a plain
        // rmdir would throw ENOTEMPTY and leak the lock folder.
        fs.writeFileSync(path.join(lockFolder, "stray.txt"), "x");
        fs.mkdirSync(path.join(lockFolder, "stray-dir"));
        await unlock();

        expect(fs.existsSync(lockFolder)).toBe(false);
    });

    it("clears a stale pid marker left by a crashed prior holder", async () => {
        const instanceDir = makeInstanceDir();
        const { lockFolder } = lockPaths(instanceDir);

        // Simulate a crashed holder: a lock folder with a foreign pid marker
        // but no live "held" lock (its stale lock will be broken on acquire).
        fs.mkdirSync(lockFolder, { recursive: true });
        fs.writeFileSync(
            path.join(lockFolder, "pid-99999999"),
            "pid: 99999999\n",
        );

        const unlock = await lockInstanceDir(instanceDir);
        try {
            const entries = fs.readdirSync(lockFolder).sort();
            expect(entries).toContain(`pid-${process.pid}`);
            expect(entries).not.toContain("pid-99999999");
        } finally {
            await unlock();
        }
    });

    it("recreates the lock folder when it is deleted while held", async () => {
        const instanceDir = makeInstanceDir();
        const { lockFolder, held, marker } = lockPaths(instanceDir);

        const unlock = await lockInstanceDir(instanceDir);
        try {
            expect(fs.existsSync(held)).toBe(true);

            // Someone deletes the whole lock folder out from under the holder.
            fs.rmSync(lockFolder, { recursive: true, force: true });
            expect(fs.existsSync(lockFolder)).toBe(false);

            // proper-lockfile's mtime heartbeat (update = stale/2 = 5s) notices
            // the lock is gone and reacquire recreates it. Poll generously.
            const recovered = await waitFor(
                () => fs.existsSync(held) && fs.existsSync(marker),
                20000,
            );
            expect(recovered).toBe(true);
        } finally {
            await unlock();
        }
    }, 30000);
});
