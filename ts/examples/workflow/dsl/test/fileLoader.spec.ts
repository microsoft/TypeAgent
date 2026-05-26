// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileFile, FileResolver, TaskSchemaInfo } from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

class MemoryResolver implements FileResolver {
    constructor(private files: Record<string, string>) {}
    resolve(spec: string, importerAbsPath: string): string {
        // Strip leading "./" and "../" segments by joining manually.
        const parts = importerAbsPath.split("/").slice(0, -1);
        for (const segment of spec.split("/")) {
            if (segment === "." || segment === "") continue;
            if (segment === "..") parts.pop();
            else parts.push(segment);
        }
        return parts.join("/");
    }
    read(absPath: string): string {
        const src = this.files[absPath];
        if (src === undefined) {
            throw new Error(`No such file: ${absPath}`);
        }
        return src;
    }
}

const taskSchemas: TaskSchemaInfo[] = [];

/**
 * Workflows from non-entry files are mangled to `__f{N}_{name}` to ensure
 * globally unique names in the flat IR map.  Tests that check for IR presence
 * by original name should use this helper instead of `ir.workflows[name]`.
 */
function hasWorkflow(
    ir: ReturnType<typeof compileFile>["ir"],
    name: string,
): boolean {
    if (!ir) return false;
    return Object.keys(ir.workflows).some(
        (k) =>
            k === name ||
            k === `__f0_${name}` ||
            (/^__f\d+_/.test(k) && k.endsWith(`_${name}`)),
    );
}

describe("compileFile (Phase 7 — cross-file imports)", () => {
    test("loads a single file with no imports", () => {
        const resolver = new MemoryResolver({
            "/p/main.wf": `
                export workflow main(x: number): number {
                    const r = x + 1;
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
    });

    test("loads an imported workflow and resolves a call across files", () => {
        const resolver = new MemoryResolver({
            "/p/helper.wf": `
                export workflow double(n: number): number {
                    const r = n * 2;
                    return r;
                }
            `,
            "/p/main.wf": `
                import { double } from "./helper.wf";
                export workflow main(x: number): number {
                    const y = double(x);
                    return y;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
        // Helper workflow body must be present in the workflows table.
        expect(hasWorkflow(result.ir, "double")).toBe(true);
    });

    test("rejects import of a non-exported workflow", () => {
        const resolver = new MemoryResolver({
            "/p/helper.wf": `
                workflow secret(n: number): number {
                    const r = n;
                    return r;
                }
            `,
            "/p/main.wf": `
                import { secret } from "./helper.wf";
                export workflow main(x: number): number {
                    const y = secret(x);
                    return y;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => /not exported/i.test(e.message))).toBe(
            true,
        );
    });

    test("rejects import of a non-existent name", () => {
        const resolver = new MemoryResolver({
            "/p/helper.wf": `
                export workflow other(n: number): number {
                    const r = n;
                    return r;
                }
            `,
            "/p/main.wf": `
                import { missing } from "./helper.wf";
                export workflow main(x: number): number {
                    const y = missing(x);
                    return y;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => /not found/i.test(e.message))).toBe(
            true,
        );
    });

    test("aliases resolve calls to the canonical name", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow summarize(s: string): string {
                    return s;
                }
            `,
            "/p/main.wf": `
                import { summarize as articleSummarize } from "./lib.wf";
                export workflow main(s: string): string {
                    const out = articleSummarize(s);
                    return out;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        // The IR carries the canonical workflow name, not the alias.
        expect(hasWorkflow(result.ir, "summarize")).toBe(true);
        expect(result.ir?.workflows["articleSummarize"]).toBeUndefined();
    });

    // P7-T1: same file imported under multiple local names. The loader
    // dedupes by resolved path, so the body appears once in the IR and
    // both local names rewrite to the same mangled canonical.
    test("same workflow imported under two aliases lowers to a single body", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow helper(n: number): number {
                    return n;
                }
            `,
            "/p/main.wf": `
                import { helper } from "./lib.wf";
                import { helper as helper2 } from "./lib.wf";
                export workflow main(x: number): number {
                    const a = helper(x);
                    const b = helper2(x);
                    return a;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);

        // Exactly one body for `helper`, mangled (non-entry file).
        const helperKeys = Object.keys(result.ir!.workflows).filter((k) =>
            /(^|_)helper$/.test(k),
        );
        expect(helperKeys).toHaveLength(1);

        // Both call sites resolve to the same canonical mangled name.
        const mainBody = result.ir!.workflows["main"];
        const calls = Object.values(mainBody.nodes).filter(
            (n: any) => n.kind === "workflowCall",
        );
        expect(calls).toHaveLength(2);
        const refs = new Set(
            calls.map((c: any) => c.workflowRef?.name as string),
        );
        expect(refs.size).toBe(1);
        expect([...refs][0]).toBe(helperKeys[0]);
    });

    // P7-T6: empty import `import { } from "./foo.wf"`. Parser accepts it
    // (zero specifiers); loader BFS still pulls foo.wf into the module
    // graph, so foo.wf's workflows are mangled and emitted into the merged
    // IR. They are unreachable from source names in the entry file (no
    // local-map entry binds them). See dsl/future/tree-shaking.md for
    // the open question of pruning unreachable workflows.
    test("empty import pulls file into graph but binds no local names", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow helper(n: number): number {
                    return n;
                }
            `,
            "/p/main.wf": `
                import { } from "./lib.wf";
                export workflow main(x: number): number {
                    return x;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);

        // helper is in the merged IR (loader pulled lib.wf into the graph
        // despite the empty import; emit is non-tree-shaking).
        const helperKeys = Object.keys(result.ir!.workflows).filter((k) =>
            /(^|_)helper$/.test(k),
        );
        expect(helperKeys).toHaveLength(1);

        // But no local name in main.wf binds it, so main has no calls.
        const mainBody = result.ir!.workflows["main"];
        const calls = Object.values(mainBody.nodes).filter(
            (n: any) => n.kind === "workflowCall",
        );
        expect(calls).toHaveLength(0);
    });

    test("rejects duplicate exported workflow names across files", () => {
        const resolver = new MemoryResolver({
            "/p/a.wf": `
                export workflow shared(x: number): number {
                    return x;
                }
            `,
            "/p/main.wf": `
                import { shared } from "./a.wf";
                export workflow shared(x: number): number {
                    return x;
                }
                export workflow main(x: number): number {
                    const r = shared(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) => /collide|duplicate/i.test(e.message)),
        ).toBe(true);
    });

    test("private workflows with the same name in different files do not conflict", () => {
        const resolver = new MemoryResolver({
            "/p/helper.wf": `
                workflow helper(x: number): number {
                    const r = x * 2;
                    return r;
                }
                export workflow double(x: number): number {
                    const r = helper(x);
                    return r;
                }
            `,
            "/p/main.wf": `
                import { double } from "./helper.wf";
                workflow helper(x: number): number {
                    const r = x + 1;
                    return r;
                }
                export workflow main(x: number): number {
                    const a = helper(x);
                    const b = double(a);
                    return b;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
    });

    test("two files exporting the same name is allowed when only one is imported", () => {
        // Both a.wf and b.wf export 'helper'. main.wf only imports from a.wf.
        // There should be no collision — the Phase 2 global check was removed
        // precisely because this situation is valid.
        const resolver = new MemoryResolver({
            "/p/a.wf": `
                export workflow helper(x: number): number {
                    return x * 2;
                }
            `,
            "/p/b.wf": `
                export workflow helper(x: number): number {
                    return x + 10;
                }
            `,
            "/p/main.wf": `
                import { helper } from "./a.wf";
                export workflow main(x: number): number {
                    const r = helper(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
        // a.wf's helper is bundled; b.wf is not loaded (not imported).
        expect(hasWorkflow(result.ir, "helper")).toBe(true);
    });

    test("two files exporting the same name imported with different aliases is allowed", () => {
        // Both a.wf and b.wf export 'helper'. main.wf imports both with different aliases.
        // Both get mangled to unique IR names; no collision.
        const resolver = new MemoryResolver({
            "/p/a.wf": `
                export workflow helper(x: number): number {
                    return x * 2;
                }
            `,
            "/p/b.wf": `
                export workflow helper(x: number): number {
                    return x + 10;
                }
            `,
            "/p/main.wf": `
                import { helper as aHelper } from "./a.wf";
                import { helper as bHelper } from "./b.wf";
                export workflow main(x: number): number {
                    const a = aHelper(x);
                    const b = bHelper(x);
                    return a;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
    });

    test("missing file is reported as a compile error", () => {
        const resolver = new MemoryResolver({
            "/p/main.wf": `
                import { x } from "./missing.wf";
                export workflow main(x: number): number {
                    return x;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) =>
                /Cannot read file|No such file/i.test(e.message),
            ),
        ).toBe(true);
    });

    test("transitive imports (A -> B -> C) all resolve", () => {
        const resolver = new MemoryResolver({
            "/p/c.wf": `
                export workflow inc(n: number): number {
                    const r = n + 1;
                    return r;
                }
            `,
            "/p/b.wf": `
                import { inc } from "./c.wf";
                export workflow incTwice(n: number): number {
                    const a = inc(n);
                    const b = inc(a);
                    return b;
                }
            `,
            "/p/main.wf": `
                import { incTwice } from "./b.wf";
                export workflow main(x: number): number {
                    const y = incTwice(x);
                    return y;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(hasWorkflow(result.ir, "inc")).toBe(true);
        expect(hasWorkflow(result.ir, "incTwice")).toBe(true);
    });

    test("entry selection considers only the entry file", () => {
        // helper.wf has `export workflow other(...)`; the entry file
        // has no exported workflow. The compiler must require --entry
        // even though there is a single exported workflow in the
        // overall set (it lives in the imported file).
        const resolver = new MemoryResolver({
            "/p/helper.wf": `
                export workflow other(n: number): number {
                    return n;
                }
            `,
            "/p/main.wf": `
                import { other } from "./helper.wf";
                workflow alpha(x: number): number {
                    const r = other(x);
                    return r;
                }
                workflow beta(x: number): number {
                    return x;
                }
            `,
        });
        const noEntry = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(noEntry.errors.length).toBeGreaterThan(0);

        const withEntry = compileFile("/p/main.wf", taskSchemas, {
            resolver,
            entry: "alpha",
        });
        expect(withEntry.errors).toEqual([]);
        expect(withEntry.ir?.entry).toBe("alpha");
    });

    test("alias rewrite applies to parameter default expressions", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow getDefault(): number {
                    return 42;
                }
            `,
            "/p/main.wf": `
                import { getDefault as gd } from "./lib.wf";
                export workflow main(x: number = gd()): number {
                    return x;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(hasWorkflow(result.ir, "getDefault")).toBe(true);
    });

    test("parameter default in an imported workflow references a transitively-imported workflow", () => {
        // main imports `bWrap` from b.wf; bWrap's param default calls
        // `seed()`, which b.wf itself imports from c.wf. Verifies that
        // the per-file param-default rewrite composes correctly across
        // three files (entry -> B -> C).
        const resolver = new MemoryResolver({
            "/p/c.wf": `
                export workflow seed(): number {
                    return 7;
                }
            `,
            "/p/b.wf": `
                import { seed } from "./c.wf";
                export workflow bWrap(x: number = seed()): number {
                    return x;
                }
            `,
            "/p/main.wf": `
                import { bWrap } from "./b.wf";
                export workflow main(): number {
                    const r = bWrap();
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        expect(result.ir?.entry).toBe("main");
        expect(hasWorkflow(result.ir, "bWrap")).toBe(true);
        expect(hasWorkflow(result.ir, "seed")).toBe(true);
    });

    test("loader reports multiple errors in a single compile", () => {
        // Two independent Phase 3 errors in the same file: one
        // missing import and one not-exported import. The loader
        // should report both rather than fail-fast on the first.
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                workflow priv(): number {
                    return 1;
                }
                export workflow other(): number {
                    return 2;
                }
            `,
            "/p/main.wf": `
                import { nope, priv } from "./lib.wf";
                export workflow main(): number {
                    const a = nope();
                    const b = priv();
                    return a + b;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        const messages = result.errors.map((e) => e.message).join("\n");
        expect(messages).toMatch(/'nope' not found/);
        expect(messages).toMatch(/'priv' is not exported/);
    });

    test("mutually-importing files load without infinite loop", () => {
        const resolver = new MemoryResolver({
            "/p/a.wf": `
                import { fromB } from "./b.wf";
                export workflow fromA(x: number): number {
                    return x;
                }
            `,
            "/p/b.wf": `
                import { fromA } from "./a.wf";
                export workflow fromB(x: number): number {
                    return x;
                }
            `,
        });
        const result = compileFile("/p/a.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
    });

    test("import name collides with locally-declared workflow", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow foo(x: number): number {
                    return x;
                }
            `,
            "/p/main.wf": `
                import { foo } from "./lib.wf";
                workflow foo(x: number): number {
                    return x;
                }
                export workflow main(x: number): number {
                    const r = foo(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        // Either local-collision or duplicate-name error is acceptable.
        expect(
            result.errors.some((e) =>
                /(duplicate|collides|already)/i.test(e.message),
            ),
        ).toBe(true);
    });

    test("two aliases pointing to the same local name collide", () => {
        const resolver = new MemoryResolver({
            "/p/lib1.wf": `
                export workflow a(x: number): number { return x; }
            `,
            "/p/lib2.wf": `
                export workflow b(x: number): number { return x; }
            `,
            "/p/main.wf": `
                import { a as same } from "./lib1.wf";
                import { b as same } from "./lib2.wf";
                export workflow main(x: number): number {
                    const r = same(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => /collides/i.test(e.message))).toBe(
            true,
        );
    });

    test("type mismatch on cross-file call is reported", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow needsNumber(n: number): number {
                    return n;
                }
            `,
            "/p/main.wf": `
                import { needsNumber } from "./lib.wf";
                export workflow main(s: string): number {
                    const r = needsNumber(s);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((e) => e.phase === "typecheck")).toBe(true);
    });

    test("call cycle through imports is rejected", () => {
        const resolver = new MemoryResolver({
            "/p/a.wf": `
                import { b } from "./b.wf";
                export workflow a(x: number): number {
                    const r = b(x);
                    return r;
                }
            `,
            "/p/b.wf": `
                import { a } from "./a.wf";
                export workflow b(x: number): number {
                    const r = a(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/a.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) => /recursi|cycle/i.test(e.message)),
        ).toBe(true);
    });

    test("alias rewrite reaches imported calls inside nested AST nodes", () => {
        const resolver = new MemoryResolver({
            "/p/lib.wf": `
                export workflow inc(n: number): number {
                    return n + 1;
                }
            `,
            "/p/main.wf": `
                import { inc as plus1 } from "./lib.wf";
                export workflow main(xs: number[]): number[] {
                    const ys = map(xs, (x) => {
                        const r = plus1(x);
                        return r;
                    });
                    return ys;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors).toEqual([]);
        // The canonical name reaches the IR even though the alias was
        // used inside a map() body.
        expect(hasWorkflow(result.ir, "inc")).toBe(true);
    });

    test("parse errors in imported files are reported with file path", () => {
        const resolver = new MemoryResolver({
            "/p/broken.wf": `
                export workflow oops(x: number): number {
                    this is not valid syntax
                }
            `,
            "/p/main.wf": `
                import { oops } from "./broken.wf";
                export workflow main(x: number): number {
                    const r = oops(x);
                    return r;
                }
            `,
        });
        const result = compileFile("/p/main.wf", taskSchemas, { resolver });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some(
                (e) =>
                    /broken\.wf/.test(e.message) &&
                    (e.phase === "parse" || e.phase === "lex"),
            ),
        ).toBe(true);
    });
});

describe("compileFile workspaceRoot containment (default Node resolver)", () => {
    let tmpRoot: string;
    let outsideRoot: string;
    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-loader-"));
        // Create a sibling directory that lives outside tmpRoot to host
        // the "secret" file that the containment check should block.
        outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-outside-"));
    });
    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.rmSync(outsideRoot, { recursive: true, force: true });
    });

    test("default (no workspaceRoot) blocks imports that escape the entry file's directory", () => {
        // Place helper.wf OUTSIDE tmpRoot; main.wf imports it via ../.
        // With the new default, workspaceRoot = entry-file directory, so
        // this should be rejected without an explicit workspaceRoot.
        const outsideHelper = path.join(outsideRoot, "helper.wf");
        fs.writeFileSync(
            outsideHelper,
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const main = path.join(tmpRoot, "main.wf");
        const rel = path
            .relative(tmpRoot, outsideHelper)
            .split(path.sep)
            .join("/");
        fs.writeFileSync(
            main,
            `import { other } from "./${rel}";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        const result = compileFile(main, taskSchemas);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) =>
                /outside workspace root/i.test(e.message),
            ),
        ).toBe(true);
    });

    test("explicit workspaceRoot can widen the allowed import scope", () => {
        // Same setup, but explicitly passing the parent directory as workspaceRoot
        // should allow the ../sibling import.
        const outsideHelper = path.join(outsideRoot, "helper.wf");
        fs.writeFileSync(
            outsideHelper,
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const main = path.join(tmpRoot, "main.wf");
        const rel = path
            .relative(tmpRoot, outsideHelper)
            .split(path.sep)
            .join("/");
        fs.writeFileSync(
            main,
            `import { other } from "./${rel}";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        // Use the common parent of both dirs as the workspace root.
        const commonParent = path.dirname(tmpRoot);
        const result = compileFile(main, taskSchemas, {
            workspaceRoot: commonParent,
        });
        expect(result.errors).toEqual([]);
    });

    test("workspaceRoot blocks imports that escape the root", () => {
        const outsideHelper = path.join(outsideRoot, "helper.wf");
        fs.writeFileSync(
            outsideHelper,
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const main = path.join(tmpRoot, "main.wf");
        const rel = path
            .relative(tmpRoot, outsideHelper)
            .split(path.sep)
            .join("/");
        fs.writeFileSync(
            main,
            `import { other } from "./${rel}";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        const result = compileFile(main, taskSchemas, {
            workspaceRoot: tmpRoot,
        });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) =>
                /outside workspace root/i.test(e.message),
            ),
        ).toBe(true);
    });

    test("workspaceRoot permits imports that stay inside the root", () => {
        const subDir = path.join(tmpRoot, "lib");
        fs.mkdirSync(subDir);
        fs.writeFileSync(
            path.join(subDir, "helper.wf"),
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const main = path.join(tmpRoot, "main.wf");
        fs.writeFileSync(
            main,
            `import { other } from "./lib/helper.wf";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        const result = compileFile(main, taskSchemas, {
            workspaceRoot: tmpRoot,
        });
        expect(result.errors).toEqual([]);
    });

    test("workspaceRoot blocks symlinks that escape the root", () => {
        const realHelper = path.join(outsideRoot, "helper.wf");
        fs.writeFileSync(
            realHelper,
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const linkPath = path.join(tmpRoot, "helper.wf");
        try {
            fs.symlinkSync(realHelper, linkPath);
        } catch (e) {
            // Symlinks may be unsupported (e.g., restricted Windows
            // without Developer Mode). Skip test in that case.
            console.warn("Skipping symlink test:", (e as Error).message);
            return;
        }
        const main = path.join(tmpRoot, "main.wf");
        fs.writeFileSync(
            main,
            `import { other } from "./helper.wf";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        const result = compileFile(main, taskSchemas, {
            workspaceRoot: tmpRoot,
        });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(
            result.errors.some((e) =>
                /outside workspace root/i.test(e.message),
            ),
        ).toBe(true);
    });

    // P7-T4: documents that the entry file itself is NOT subject to
    // containment — only its imports are. A caller pointing compileFile
    // at a file outside workspaceRoot is loading exactly the file it
    // asked for; the containment check protects against unintended
    // *transitive* reads via imports.
    test("entry file outside workspaceRoot loads; its escaping imports are blocked", () => {
        // Entry lives in outsideRoot, workspaceRoot is tmpRoot.
        const main = path.join(outsideRoot, "main.wf");
        fs.writeFileSync(
            main,
            `export workflow main(x: number): number {\n` +
                `  return x;\n` +
                `}\n`,
        );
        // No imports → loads cleanly even though entry is outside the root.
        const ok = compileFile(main, taskSchemas, {
            workspaceRoot: tmpRoot,
        });
        expect(ok.errors).toEqual([]);

        // Add a sibling import that lives next to the entry (also
        // outside workspaceRoot) → import is rejected.
        const sibling = path.join(outsideRoot, "helper.wf");
        fs.writeFileSync(
            sibling,
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        fs.writeFileSync(
            main,
            `import { other } from "./helper.wf";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        const blocked = compileFile(main, taskSchemas, {
            workspaceRoot: tmpRoot,
        });
        expect(blocked.errors.length).toBeGreaterThan(0);
        expect(
            blocked.errors.some((e) =>
                /outside workspace root/i.test(e.message),
            ),
        ).toBe(true);
    });

    // P7-T5: relative workspaceRoot is resolved against process.cwd()
    // via path.resolve in createNodeResolver; behavior should be
    // identical to passing the equivalent absolute path.
    test("relative workspaceRoot is resolved against process.cwd()", () => {
        const subDir = path.join(tmpRoot, "lib");
        fs.mkdirSync(subDir);
        fs.writeFileSync(
            path.join(subDir, "helper.wf"),
            `export workflow other(n: number): number {\n  return n;\n}\n`,
        );
        const main = path.join(tmpRoot, "main.wf");
        fs.writeFileSync(
            main,
            `import { other } from "./lib/helper.wf";\n` +
                `export workflow main(x: number): number {\n` +
                `  const r = other(x);\n` +
                `  return r;\n` +
                `}\n`,
        );
        // Switch cwd to tmpRoot's parent so we can address tmpRoot by
        // its basename ("./<basename>"). Restore after the test.
        const prevCwd = process.cwd();
        process.chdir(path.dirname(tmpRoot));
        try {
            const result = compileFile(main, taskSchemas, {
                workspaceRoot: `./${path.basename(tmpRoot)}`,
            });
            expect(result.errors).toEqual([]);
        } finally {
            process.chdir(prevCwd);
        }
    });
});
