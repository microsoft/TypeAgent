// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
    BoundedProcessRunner,
    SkillAcquirer,
    SkillCatalog,
    validateSkillPath,
    type ProcessRunner,
    type SkillAcquisitionRequest,
    type SkillIdentity,
} from "../src/index.js";
import { MemoryStorage } from "./memoryStorage.js";

const roots = new Set<string>();
const identity: SkillIdentity = {
    scope: "user",
    origin: "tests",
    name: "calendar",
};

afterEach(async () => {
    await Promise.all(
        [...roots].map((root) => rm(root, { recursive: true, force: true })),
    );
    roots.clear();
});

describe("SkillAcquirer", () => {
    it("stages a directory, publishes immutable updates, and retains rollback", async () => {
        const source = await createSkillDirectory("first");
        const catalog = new SkillCatalog(new MemoryStorage());
        const acquirer = createAcquirer(catalog);
        const request = directoryRequest(source);
        const first = await acquirer.acquireAndPublish(request);
        await activate(catalog, first.entry);

        expect(first.entry.revision.acquisition).toMatchObject({
            provider: "directory",
            manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        await expect(acquirer.checkForUpdate(request)).resolves.toMatchObject({
            updateAvailable: false,
            sourceChanged: false,
            contentChanged: false,
        });
        const unchanged = await acquirer.update(request);
        expect(unchanged.updated).toBe(false);
        expect(unchanged.entry.revision.revision).toBe(
            first.entry.revision.revision,
        );

        await writeSkill(source, "second");
        await expect(acquirer.checkForUpdate(request)).resolves.toMatchObject({
            updateAvailable: true,
            sourceChanged: true,
            contentChanged: true,
        });
        const second = await acquirer.update(request);
        expect(second.updated).toBe(true);
        expect(second.entry.revision.revision).not.toBe(
            first.entry.revision.revision,
        );
        await activate(catalog, second.entry);
        await catalog.rollback(identity, first.entry.revision.revision);
        expect((await catalog.get(identity))?.revision.revision).toBe(
            first.entry.revision.revision,
        );
    });

    it("rejects junctions, hooks, executables, and resource overages", async () => {
        const source = await createSkillDirectory("safe");
        const outside = await makeRoot();
        await writeFile(path.join(outside, "secret.txt"), "secret");
        await symlink(
            outside,
            path.join(source, "escape"),
            process.platform === "win32" ? "junction" : "dir",
        );
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/Symbolic links|junctions/);

        await rm(path.join(source, "escape"), { recursive: true, force: true });
        await writeFile(
            path.join(source, "package.json"),
            JSON.stringify({ scripts: { install: "node setup.js" } }),
        );
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/hooks/);
        await rm(path.join(source, "package.json"));
        await writeFile(path.join(source, "run.cmd"), "echo unsafe");
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/Executable/);
        await rm(path.join(source, "run.cmd"));
        await writeFile(
            path.join(source, "renamed.data"),
            Buffer.from([0x4d, 0x5a, 0, 0]),
        );
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/Executable/);
        await rm(path.join(source, "renamed.data"));
        await writeFile(path.join(source, "large.txt"), "12345");
        await expect(
            createAcquirer(new SkillCatalog(new MemoryStorage()), {
                maxFileBytes: 4,
            }).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/exceeds 4 bytes/);
    });

    it("acquires safe ZIP, TAR, and gzip archives without execution", async () => {
        const skill = skillMarkdown("archive");
        const zipPath = path.join(await makeRoot(), "skill.zip");
        await writeFile(
            zipPath,
            createZip([
                ["SKILL.md", skill],
                ["references/info.md", "zip"],
            ]),
        );
        const tar = createTar([
            ["SKILL.md", skill, "0"],
            ["references/info.md", "tar", "0"],
        ]);
        const tarPath = path.join(await makeRoot(), "skill.tar");
        await writeFile(tarPath, tar);
        const gzipPath = path.join(await makeRoot(), "skill.tar.gz");
        await writeFile(gzipPath, gzipSync(tar));

        for (const archivePath of [zipPath, tarPath, gzipPath]) {
            const catalog = new SkillCatalog(new MemoryStorage());
            const result = await createAcquirer(catalog).acquireAndPublish({
                ...baseRequest(),
                source: { type: "archive", path: archivePath },
            });
            expect(result.entry.revision.acquisition?.provider).toBe("archive");
            expect(
                new TextDecoder().decode(
                    await catalog.readFile(
                        identity,
                        result.entry.revision.revision,
                        "references/info.md",
                    ),
                ),
            ).toMatch(/zip|tar/);
        }
    });

    it("distinguishes source-only archive updates from content updates", async () => {
        const archivePath = path.join(await makeRoot(), "skill.zip");
        const archive = createZip([["SKILL.md", skillMarkdown("stable")]]);
        await writeFile(archivePath, archive);
        const catalog = new SkillCatalog(new MemoryStorage());
        const acquirer = createAcquirer(catalog);
        const request: SkillAcquisitionRequest = {
            ...baseRequest(),
            source: { type: "archive", path: archivePath },
        };
        const installed = await acquirer.acquireAndPublish(request);
        await activate(catalog, installed.entry);

        const changedContainer = Buffer.concat([
            archive,
            Buffer.from("changed"),
        ]);
        changedContainer.writeUInt16LE(7, archive.byteLength - 2);
        await writeFile(archivePath, changedContainer);
        await expect(acquirer.checkForUpdate(request)).resolves.toMatchObject({
            updateAvailable: true,
            sourceChanged: true,
            contentChanged: false,
        });
    });

    it("rejects archive traversal, links, and case-fold collisions", async () => {
        const root = await makeRoot();
        const cases: [string, Uint8Array, RegExp][] = [
            [
                "traversal.zip",
                createZip([
                    ["SKILL.md", skillMarkdown("safe")],
                    ["../escape", "bad"],
                ]),
                /Unsafe/,
            ],
            [
                "collision.zip",
                createZip([
                    ["SKILL.md", skillMarkdown("safe")],
                    ["Docs.txt", "one"],
                    ["docs.TXT", "two"],
                ]),
                /collision/,
            ],
            [
                "link.tar",
                createTar([
                    ["SKILL.md", skillMarkdown("safe"), "0"],
                    ["escape", "target", "2"],
                ]),
                /links/,
            ],
        ];
        for (const [name, data, error] of cases) {
            const archivePath = path.join(root, name);
            await writeFile(archivePath, data);
            await expect(
                createAcquirer(
                    new SkillCatalog(new MemoryStorage()),
                ).acquireAndPublish({
                    ...baseRequest(),
                    source: { type: "archive", path: archivePath },
                }),
            ).rejects.toThrow(error);
        }
    });

    it("uses an injectable bounded process runner for a local Git ref", async () => {
        const repository = await makeRoot();
        await writeSkill(repository, "git");
        const runner = new RecordingRunner();
        await runGit(runner, repository, ["init"]);
        await runGit(runner, repository, [
            "-c",
            "core.safecrlf=false",
            "-c",
            "user.name=Skill Test",
            "-c",
            "user.email=skill@example.invalid",
            "add",
            ".",
        ]);
        await runGit(runner, repository, [
            "-c",
            "user.name=Skill Test",
            "-c",
            "user.email=skill@example.invalid",
            "commit",
            "-m",
            "skill",
        ]);

        const catalog = new SkillCatalog(new MemoryStorage());
        const result = await createAcquirer(
            catalog,
            {},
            runner,
        ).acquireAndPublish({
            ...baseRequest(),
            source: {
                type: "git",
                repository,
                ref: "HEAD",
            },
        });
        expect(result.entry.revision.acquisition).toMatchObject({
            provider: "git",
            sourceFingerprint: expect.stringMatching(/^[a-f0-9]{40,64}$/),
        });
        expect(
            runner.calls.some(
                (call) =>
                    call.args[0] === "fetch" &&
                    call.timeoutMs > 0 &&
                    call.maxOutputBytes > 0,
            ),
        ).toBe(true);
    });

    it("requires valid matching Agent Skills frontmatter", async () => {
        const source = await makeRoot();
        await writeFile(path.join(source, "SKILL.md"), "# Missing frontmatter");
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/frontmatter/);
        await writeFile(
            path.join(source, "SKILL.md"),
            "---\nname: another-skill\ndescription: Wrong name\n---\n",
        );
        await expect(
            createAcquirer(
                new SkillCatalog(new MemoryStorage()),
            ).acquireAndPublish(directoryRequest(source)),
        ).rejects.toThrow(/does not match/);
    });
});

describe("acquisition path validation", () => {
    it.each([
        "C:/drive",
        "//server/share",
        "../escape",
        "folder/../../escape",
        "file.txt:stream",
        "CON",
        "aux.txt",
        "folder/name.",
        "folder/name ",
    ])("rejects %s", (unsafePath) => {
        expect(() => validateSkillPath(unsafePath)).toThrow("Unsafe");
    });

    it("bounds child process output", async () => {
        const runner = new BoundedProcessRunner();
        await expect(
            runner.run(
                process.execPath,
                ["-e", "console.log('x'.repeat(100))"],
                {
                    timeoutMs: 10_000,
                    maxOutputBytes: 10,
                },
            ),
        ).rejects.toThrow(/output exceeded/);
    });
});

function baseRequest(): Omit<SkillAcquisitionRequest, "source"> {
    return {
        identity,
        schemaFingerprint: "schema-v1",
    };
}

function directoryRequest(source: string): SkillAcquisitionRequest {
    return {
        ...baseRequest(),
        source: { type: "directory", path: source },
    };
}

function createAcquirer(
    catalog: SkillCatalog,
    limits: ConstructorParameters<typeof SkillAcquirer>[1]["limits"] = {},
    processRunner?: ProcessRunner,
): SkillAcquirer {
    const stagingRoot = path.join(
        process.cwd(),
        ".skill-catalog-test",
        randomUUID(),
    );
    roots.add(path.dirname(stagingRoot));
    return new SkillAcquirer(catalog, {
        stagingRoot,
        limits,
        ...(processRunner === undefined ? {} : { processRunner }),
    });
}

async function createSkillDirectory(description: string): Promise<string> {
    const root = await makeRoot();
    await writeSkill(root, description);
    return root;
}

async function writeSkill(root: string, description: string): Promise<void> {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "SKILL.md"), skillMarkdown(description));
}

function skillMarkdown(description: string): string {
    return `---\nname: calendar\ndescription: ${description}\n---\n# Calendar\n`;
}

async function makeRoot(): Promise<string> {
    const root = path.join(process.cwd(), ".skill-catalog-test", randomUUID());
    roots.add(path.dirname(root));
    await mkdir(root, { recursive: true });
    return root;
}

async function activate(
    catalog: SkillCatalog,
    entry: Awaited<ReturnType<SkillCatalog["publish"]>>,
): Promise<void> {
    await catalog.transition(identity, entry.revision.revision, "validated");
    await catalog.transition(identity, entry.revision.revision, "approved");
    await catalog.activate(identity, entry.revision.revision);
}

class RecordingRunner implements ProcessRunner {
    public readonly calls: {
        args: readonly string[];
        timeoutMs: number;
        maxOutputBytes: number;
    }[] = [];
    private readonly runner = new BoundedProcessRunner();

    public run(
        command: string,
        args: readonly string[],
        options: Parameters<ProcessRunner["run"]>[2],
    ) {
        this.calls.push({
            args,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: options.maxOutputBytes,
        });
        return this.runner.run(command, args, options);
    }
}

async function runGit(
    runner: ProcessRunner,
    cwd: string,
    args: readonly string[],
): Promise<void> {
    await runner.run("git", args, {
        cwd,
        timeoutMs: 10_000,
        maxOutputBytes: 1024 * 1024,
    });
}

function createTar(
    entries: readonly [path: string, content: string, type: string][],
): Uint8Array {
    const chunks: Buffer[] = [];
    for (const [entryPath, text, type] of entries) {
        const content = Buffer.from(text);
        const header = Buffer.alloc(512);
        header.write(entryPath, 0, 100, "utf8");
        writeTarOctal(header, 100, 8, type === "0" ? 0o600 : 0o777);
        writeTarOctal(header, 108, 8, 0);
        writeTarOctal(header, 116, 8, 0);
        writeTarOctal(header, 124, 12, content.byteLength);
        writeTarOctal(header, 136, 12, 0);
        header.fill(0x20, 148, 156);
        header.write(type, 156, 1, "ascii");
        header.write("ustar\0", 257, 6, "ascii");
        header.write("00", 263, 2, "ascii");
        writeTarOctal(
            header,
            148,
            8,
            [...header].reduce((sum, value) => sum + value, 0),
        );
        chunks.push(header, content);
        const padding = (512 - (content.byteLength % 512)) % 512;
        if (padding > 0) {
            chunks.push(Buffer.alloc(padding));
        }
    }
    chunks.push(Buffer.alloc(1024));
    return Buffer.concat(chunks);
}

function writeTarOctal(
    target: Buffer,
    offset: number,
    length: number,
    value: number,
): void {
    const octal = value.toString(8).padStart(length - 2, "0");
    target.write(`${octal}\0 `, offset, length, "ascii");
}

function createZip(
    entries: readonly [path: string, content: string][],
): Uint8Array {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let localOffset = 0;
    for (const [entryPath, text] of entries) {
        const name = Buffer.from(entryPath);
        const content = Buffer.from(text);
        const checksum = crc32(content);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(content.byteLength, 18);
        local.writeUInt32LE(content.byteLength, 22);
        local.writeUInt16LE(name.byteLength, 26);
        localChunks.push(local, name, content);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0314, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(content.byteLength, 20);
        central.writeUInt32LE(content.byteLength, 24);
        central.writeUInt16LE(name.byteLength, 28);
        central.writeUInt32LE((0o100600 * 0x10000) >>> 0, 38);
        central.writeUInt32LE(localOffset, 42);
        centralChunks.push(central, name);
        localOffset += local.byteLength + name.byteLength + content.byteLength;
    }
    const central = Buffer.concat(centralChunks);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.byteLength, 12);
    end.writeUInt32LE(localOffset, 16);
    return Buffer.concat([...localChunks, central, end]);
}

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
