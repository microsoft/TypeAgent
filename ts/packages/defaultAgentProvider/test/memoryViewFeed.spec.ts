// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
    readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    createFeedSource,
    type FeedSourceDeps,
} from "../src/installSources/feedSource.js";
import { clearTokenCacheForTest } from "../src/installSources/feedAuth.js";

const config = {
    name: "fixture",
    kind: "feed" as const,
    scopes: ["@typeagent"],
    registry:
        "https://pkgs.dev.azure.com/fixture/project/_packaging/views/npm/registry/",
};
let directory: string;
const tokenRunner = async () =>
    JSON.stringify({
        accessToken: "synthetic-token",
        expiresOn: new Date(Date.now() + 3600000).toISOString(),
    });
const fetchFn: typeof fetch = async (input) =>
    new Response(
        JSON.stringify(
            String(input).includes("/_apis/packaging/feeds/")
                ? { value: [{ normalizedName: "@typeagent/views" }] }
                : {
                      versions: {
                          "1.0.0": {
                              keywords: ["typeagent-agent"],
                              typeagent: { defaultAgentName: "agent" },
                          },
                          "2.0.0": {
                              keywords: ["typeagent-memory-view"],
                              typeagent: {
                                  defaultMemoryViewName: "views",
                                  defaultAgentName: "wrong",
                              },
                          },
                      },
                      "dist-tags": { latest: "2.0.0" },
                  },
        ),
        { status: 200 },
    );
const source = (overrides: Partial<FeedSourceDeps> = {}) =>
    createFeedSource(config, {
        installDir: directory,
        extensionKind: "memory-view",
        fetchFn,
        tokenRunner,
        ...overrides,
    });
beforeEach(async () => {
    clearTokenCacheForTest();
    directory = await mkdtemp(path.join(os.tmpdir(), "memory-view-feed-"));
});
afterEach(async () => {
    clearTokenCacheForTest();
    await rm(directory, { recursive: true, force: true });
});

test("memory feed uses its resolved version's keyword/name and isolated metadata cache", async () => {
    expect((await source().listAgents!())[0]).toMatchObject({
        defaultAgentName: "views",
        packageName: "@typeagent/views",
        extensionKind: "memory-view",
    });
    expect(await source().find("@typeagent/views@1.0.0")).toBeUndefined();
    expect((await source().find("@typeagent/views@^2"))?.version).toBe("2.0.0");
    expect(await readdir(directory)).toEqual([
        ".feed-cache-fixture.memory-view.json",
    ]);
});

test("synthetic npm acquisition pins an exact version and reuses the completed root", async () => {
    let installs = 0;
    const feed = source({
        npmInstall: async (args) => {
            installs++;
            expect(args.spec).toBe("@typeagent/views@2.0.0");
            const root = path.join(
                args.cwd,
                "node_modules",
                "@typeagent",
                "views",
            );
            await mkdir(root, { recursive: true });
            await writeFile(
                path.join(root, "package.json"),
                '{"name":"@typeagent/views","version":"2.0.0"}',
            );
        },
    });
    const candidate = await feed.find("@typeagent/views");
    expect(candidate).toBeDefined();
    const record = await feed.materialize(candidate!);
    expect(record.module).toBe("@typeagent/views");
    const filename = path.join(
        directory,
        "agents",
        record.installRoot!,
        "node_modules",
        "@typeagent",
        "views",
        "package.json",
    );
    expect(JSON.parse(await readFile(filename, "utf8")).version).toBe("2.0.0");
    await feed.materialize(candidate!);
    expect(installs).toBe(1);
});

test("memory metadata failures do not become empty successful listings", async () => {
    const failing: typeof fetch = async (input) =>
        String(input).includes("/_apis/packaging/feeds/")
            ? fetchFn(input)
            : new Response("Unavailable", { status: 503 });
    await expect(source({ fetchFn: failing }).listAgents!()).rejects.toThrow(
        "503",
    );
    const broken: typeof fetch = async () => {
        throw new Error("offline");
    };
    await expect(source({ fetchFn: broken }).listAgents!()).rejects.toThrow(
        "offline",
    );
});

test("corrupt memory cache is reported rather than silently replaced", async () => {
    await writeFile(
        path.join(directory, ".feed-cache-fixture.memory-view.json"),
        "corrupt",
    );
    await expect(source().listAgents!()).rejects.toThrow();
});
