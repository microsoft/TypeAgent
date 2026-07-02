// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    CollisionPreferenceStore,
    PreferenceMember,
    canonicalizeCandidateSet,
    preferenceKey,
    COLLISION_PREFERENCES_FILE,
} from "../src/context/collisionPreferences.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-collpref-"));
}

const player: PreferenceMember = { schemaName: "player", actionName: "play" };
const video: PreferenceMember = { schemaName: "video", actionName: "play" };
const list: PreferenceMember = { schemaName: "list", actionName: "addItems" };

describe("collisionPreferences.canonicalizeCandidateSet", () => {
    it("sorts members by id", () => {
        const out = canonicalizeCandidateSet([video, player]);
        expect(out.map((m) => `${m.schemaName}.${m.actionName}`)).toEqual([
            "player.play",
            "video.play",
        ]);
    });

    it("dedupes repeated members", () => {
        const out = canonicalizeCandidateSet([player, player, video]);
        expect(out).toHaveLength(2);
    });

    it("strips extra properties to a clean member shape", () => {
        const dirty = {
            schemaName: "player",
            actionName: "play",
            score: 0.9,
        } as PreferenceMember;
        const [out] = canonicalizeCandidateSet([dirty]);
        expect(out).toEqual({ schemaName: "player", actionName: "play" });
    });
});

describe("collisionPreferences.preferenceKey", () => {
    it("is order-independent", () => {
        expect(preferenceKey([player, video])).toBe(
            preferenceKey([video, player]),
        );
    });

    it("is dedupe-stable", () => {
        expect(preferenceKey([player, video, player])).toBe(
            preferenceKey([player, video]),
        );
    });

    it("differs for different candidate sets", () => {
        expect(preferenceKey([player, video])).not.toBe(
            preferenceKey([player, list]),
        );
    });

    it("uses a bare set key when context is empty", () => {
        expect(preferenceKey([player, video])).toBe("player.play|video.play");
    });

    it("appends a context signature when present", () => {
        const key = preferenceKey([player, video], { timeOfDay: "morning" });
        expect(key).toBe("player.play|video.play#timeOfDay=morning");
    });

    it("ignores empty-string context fields", () => {
        expect(preferenceKey([player, video], { device: "" })).toBe(
            preferenceKey([player, video]),
        );
    });
});

describe("collisionPreferences.CollisionPreferenceStore", () => {
    it("set then find returns the preference when chosen is present", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], player, "learned");
        const hit = store.find([player, video]);
        expect(hit?.chosen).toEqual(player);
        expect(hit?.origin).toBe("learned");
    });

    it("find misses when the candidate set differs", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], player, "learned");
        expect(store.find([player, list])).toBeUndefined();
    });

    it("find misses when chosen is no longer a competitor", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], video, "learned");
        // video is gone from the live candidate set -> stale preference, no hit.
        expect(store.find([player, list])).toBeUndefined();
    });

    it("set is last-write-wins but preserves createdAt and hitCount", () => {
        const store = CollisionPreferenceStore.load(undefined);
        const first = store.set([player, video], player, "learned");
        store.recordHit(first.key);
        const second = store.set([player, video], video, "explicit");
        expect(second.createdAt).toBe(first.createdAt);
        expect(second.chosen).toEqual(video);
        expect(second.origin).toBe("explicit");
        expect(second.hitCount).toBe(1);
    });

    it("recordHit increments hitCount", () => {
        const store = CollisionPreferenceStore.load(undefined);
        const pref = store.set([player, video], player, "learned");
        store.recordHit(pref.key);
        store.recordHit(pref.key);
        expect(store.find([player, video])?.hitCount).toBe(2);
    });

    it("remove deletes a preference by key", () => {
        const store = CollisionPreferenceStore.load(undefined);
        const pref = store.set([player, video], player, "learned");
        expect(store.remove(pref.key)).toBe(true);
        expect(store.find([player, video])).toBeUndefined();
        expect(store.remove(pref.key)).toBe(false);
    });

    it("clear removes everything", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], player, "learned");
        store.set([player, list], list, "learned");
        store.clear();
        expect(store.list()).toHaveLength(0);
    });

    it("persists to disk and reloads", () => {
        const dir = tmpdir();
        try {
            const store = CollisionPreferenceStore.load(dir);
            store.set([player, video], player, "learned");
            expect(
                fs.existsSync(path.join(dir, COLLISION_PREFERENCES_FILE)),
            ).toBe(true);

            const reloaded = CollisionPreferenceStore.load(dir);
            const hit = reloaded.find([player, video]);
            expect(hit?.chosen).toEqual(player);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("load tolerates a malformed file (empty store)", () => {
        const dir = tmpdir();
        try {
            fs.writeFileSync(
                path.join(dir, COLLISION_PREFERENCES_FILE),
                "not json",
                "utf8",
            );
            const store = CollisionPreferenceStore.load(dir);
            expect(store.list()).toHaveLength(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
