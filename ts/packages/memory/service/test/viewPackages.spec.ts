// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, mkdir, stat, symlink, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    inspectMemoryViewPackage,
    loadMemoryViewPackage,
    parseMemoryViewManifest,
} from "../src/viewPackages.js";
import { viewExtensionDigest } from "../src/viewExtensions.js";

let root: string;
const manifest = {
    schemaVersion: 1,
    packId: "synthetic-pack",
    files: ["provider.mjs", "prompt.md"],
    providers: [{ providerId: "synthetic", factory: "create" }],
};

beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "memory-view-package-"));
    const schema = { type: "string", maxLength: 200 };
    const descriptor = {
        apiVersion: 1,
        label: "Synthetic",
        identity: {
            providerId: "synthetic",
            version: "1",
            implementationDigest: viewExtensionDigest("code"),
            inputContract: "input-v1",
            outputContract: "output-v1",
            schemaDigest: viewExtensionDigest(schema),
            recipeDigest: viewExtensionDigest("recipe"),
        },
        outputSchema: schema,
        definitions: [
            { id: "summary", eligibilityVersion: "1", mode: "static" },
        ],
        limits: {
            maxSources: 1,
            maxInputChars: 100,
            maxOutputChars: 100,
            maxModelCalls: 1,
            timeoutMs: 1000,
        },
    };
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
            name: "synthetic-views",
            version: "1.0.0",
            type: "module",
            exports: {
                "./memory/views/manifest": "./pack.json",
                "./memory/views/provider": "./provider.mjs",
            },
        }),
    );
    await writeFile(path.join(root, "pack.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "prompt.md"), "Synthetic prompt");
    await writeFile(
        path.join(root, "provider.mjs"),
        `export function create(context) {
        context.mark();
        return {descriptor:${JSON.stringify(descriptor)}, authorize:async()=>false,
        evaluateEligibility:async()=>{throw new Error("No model during activation")},
        prepare:async()=>{throw new Error("No prepare during activation")},
        generate:async()=>{throw new Error("No generation during activation")}};
    }`,
    );
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test("inspection is data-only and activation selects a factory without construction", async () => {
    const installed = await inspectMemoryViewPackage(root);
    let calls = 0;
    const providers = await loadMemoryViewPackage(installed, [
        { providerId: "synthetic", context: { mark: () => calls++ } },
    ]);
    expect(calls).toBe(1);
    expect(providers[0].descriptor.identity.providerId).toBe("synthetic");
});

test("changed prompt assets cannot activate an installed pack", async () => {
    const installed = await inspectMemoryViewPackage(root);
    await writeFile(path.join(root, "prompt.md"), "Changed");
    await expect(
        loadMemoryViewPackage(installed, [
            { providerId: "synthetic", context: {} },
        ]),
    ).rejects.toThrow("changed");
});

test("unknown or duplicate selections fail before a factory runs", async () => {
    const installed = await inspectMemoryViewPackage(root);
    await expect(
        loadMemoryViewPackage(installed, [
            { providerId: "unknown", context: {} },
        ]),
    ).rejects.toThrow("not installed");
    await expect(
        loadMemoryViewPackage(
            installed,
            Array(2).fill({ providerId: "synthetic", context: {} }),
        ),
    ).rejects.toThrow("Duplicate");
});

test.each(["../outside", "C:/outside", "folder\\outside", "/outside"])(
    "escaped asset %s is rejected",
    (file) => {
        expect(() =>
            parseMemoryViewManifest({ ...manifest, files: [file] }),
        ).toThrow("relative");
    },
);

test("missing assets, unknown fields and duplicate provider identities fail", async () => {
    await rm(path.join(root, "prompt.md"));
    await expect(inspectMemoryViewPackage(root)).rejects.toThrow();
    expect(() => parseMemoryViewManifest({ ...manifest, extra: true })).toThrow(
        "fields",
    );
    expect(() =>
        parseMemoryViewManifest({
            ...manifest,
            providers: [...manifest.providers, ...manifest.providers],
        }),
    ).toThrow("Duplicate");
});

test("unknown factory or wrong provider output fails explicitly", async () => {
    await writeFile(
        path.join(root, "provider.mjs"),
        "export function create(){return {authorize(){},evaluateEligibility(){},prepare(){},generate(){},descriptor:{identity:{providerId:'wrong'}}}}",
    );
    const installed = await inspectMemoryViewPackage(root);
    await expect(
        loadMemoryViewPackage(installed, [
            { providerId: "synthetic", context: {} },
        ]),
    ).rejects.toThrow("different");
});

test("unselected factories need not exist and selected ones must exist", async () => {
    await writeFile(
        path.join(root, "pack.json"),
        JSON.stringify({
            ...manifest,
            providers: [
                ...manifest.providers,
                { providerId: "unselected", factory: "missing" },
            ],
        }),
    );
    const installed = await inspectMemoryViewPackage(root);
    await loadMemoryViewPackage(installed, [
        { providerId: "synthetic", context: { mark: () => {} } },
    ]);
    await expect(
        loadMemoryViewPackage(installed, [
            { providerId: "unselected", context: {} },
        ]),
    ).rejects.toThrow("unavailable");
});

test("a changed already-imported pack requires restart even after explicit reinspection", async () => {
    await loadMemoryViewPackage(await inspectMemoryViewPackage(root), [
        { providerId: "synthetic", context: { mark: () => {} } },
    ]);
    await writeFile(path.join(root, "prompt.md"), "New prompt");
    await expect(
        loadMemoryViewPackage(await inspectMemoryViewPackage(root), [
            { providerId: "synthetic", context: { mark: () => {} } },
        ]),
    ).rejects.toThrow("restart");
});

test("directory links cannot escape the package's declared asset boundary", async () => {
    const outside = `${root}-outside`;
    await mkdir(outside);
    try {
        await writeFile(path.join(outside, "prompt.md"), "Outside");
        await symlink(outside, path.join(root, "linked"), "junction");
        await writeFile(
            path.join(root, "pack.json"),
            JSON.stringify({
                ...manifest,
                files: ["provider.mjs", "linked/prompt.md"],
            }),
        );
        await expect(inspectMemoryViewPackage(root)).rejects.toThrow("escapes");
    } finally {
        await rm(outside, { recursive: true, force: true });
    }
});

test("relative package roots are never resolved against process cwd", async () => {
    await expect(inspectMemoryViewPackage("relative")).rejects.toThrow(
        "absolute",
    );
});

test("manifest file and provider bounds accept the limit and reject one beyond it", () => {
    const files = Array.from(
        { length: 256 },
        (_, index) => `asset-${index}.md`,
    );
    const providers = Array.from({ length: 64 }, (_, index) => ({
        providerId: `provider-${index}`,
        factory: `create${index}`,
    }));
    expect(
        parseMemoryViewManifest({ ...manifest, files, providers }).files,
    ).toHaveLength(256);
    expect(
        parseMemoryViewManifest({ ...manifest, files, providers }).providers,
    ).toHaveLength(64);
    expect(() =>
        parseMemoryViewManifest({ ...manifest, files: [...files, "extra.md"] }),
    ).toThrow("oversized");
    expect(() =>
        parseMemoryViewManifest({
            ...manifest,
            providers: [
                ...providers,
                { providerId: "extra", factory: "extra" },
            ],
        }),
    ).toThrow("oversized");
    expect(() =>
        parseMemoryViewManifest({ ...manifest, schemaVersion: 2 }),
    ).toThrow("Unsupported");
});

test("the 32 MiB asset budget includes package and manifest metadata", async () => {
    const metadata = await Promise.all(
        ["package.json", "pack.json", "provider.mjs"].map((filename) =>
            stat(path.join(root, filename)),
        ),
    );
    const maximumPromptBytes =
        32 * 1024 * 1024 - metadata.reduce((sum, file) => sum + file.size, 0);
    await writeFile(
        path.join(root, "prompt.md"),
        Buffer.alloc(maximumPromptBytes),
    );
    expect((await inspectMemoryViewPackage(root)).packId).toBe(
        "synthetic-pack",
    );
    await writeFile(
        path.join(root, "prompt.md"),
        Buffer.alloc(maximumPromptBytes + 1),
    );
    await expect(inspectMemoryViewPackage(root)).rejects.toThrow(
        "bound exceeded",
    );
});
