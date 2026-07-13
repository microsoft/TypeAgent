// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * build-wiki.mjs
 *
 * Prepares the TypeAgent engineering wiki for a DocFX build. The docset root is
 * ts/docs itself: the architecture, plans, overview, and contributing content
 * are native files in this tree, so they need no copying. The only content that
 * lives outside ts/docs is the package/agent documentation under ts/packages,
 * which this script crawls and stages in at build time.
 *
 * It does two things:
 *
 *   1. STAGE — copies each package/agent's documentation under
 *      ts/docs/{packages,agents}: every root-level markdown file (README.md and
 *      README.AUTOGEN.md are renamed to overview.md / generated.md, all other
 *      root markdown keeps its name) plus a mirror of the package's docs/
 *      directory if one exists. Links are rewritten (in-wiki when the target is
 *      also staged, GitHub URL otherwise) and a "source of truth" banner is
 *      prepended. Staged files are git-ignored.
 *
 *   2. NAVIGATE — regenerates toc.yml for the file-system-driven sections:
 *        packages/ and agents/   (one node per package, from ts/packages)
 *        architecture/           (grouped by the ARCH_GROUPS taxonomy below;
 *                                 folds the former Design content into the
 *                                 "Workflow system" group)
 *
 * Usage (from anywhere):
 *   node ts/docs/scripts/build-wiki.mjs            # clean + stage + toc
 *   node ts/docs/scripts/build-wiki.mjs --check    # CI: warn on uncategorized arch docs
 *   node ts/docs/scripts/build-wiki.mjs --clean    # remove staged/generated output only
 *
 * After running this, build the site with:  docfx build ts/docs/docfx.json
 */

import { promises as fs } from "node:fs";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    AGENT_EXPLORER_FILE,
    buildAgentExplorer,
} from "./agent-explorer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, ".."); // ts/docs (the docset root)
const tsDir = path.resolve(docsRoot, ".."); // ts
const packagesDir = path.join(tsDir, "packages"); // ts/packages
const agentsDir = path.join(packagesDir, "agents"); // ts/packages/agents
const repoRoot = path.resolve(tsDir, ".."); // repo root

const GITHUB_BASE = "https://github.com/microsoft/TypeAgent";
const BRANCH = "main";
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    "test",
    ".git",
    "obj",
    "_site",
]);

// Page policy for package/agent docs (see contributing/doc-autogen.md):
//   both | overview | generated
const PAGE_POLICY = process.env.WIKI_PAGE_POLICY ?? "both";
const SOURCE_README = "README.md";
const SOURCE_GENERATED = "README.AUTOGEN.md";
const STAGED_OVERVIEW = "overview.md";
const STAGED_GENERATED = "generated.md";

// Architecture taxonomy. Each architecture doc is grouped into a sub-directory
// and the architecture toc is generated from this. A doc not listed here lands
// in "Uncategorized" so nothing silently disappears — assign it by adding its
// filename to a group. The former Design tree lives in the "workflows" group's
// directory (ts/docs/architecture/workflows/**).
const ARCH_GROUPS = [
    {
        dir: "core",
        name: "Core routing & execution",
        files: [
            "dispatcher.md",
            "actionGrammar.md",
            "completion.md",
            "messageQueueing.md",
            "user-settings.md",
        ],
    },
    {
        dir: "collision",
        name: "Collision resolution",
        files: [
            "collision-analysis.md",
            "collision-rollout.md",
            "context-weighted-collision-resolution-design.md",
            "collision-optimize-cookbook.md",
        ],
    },
    {
        dir: "memory",
        name: "Memory",
        files: ["memory.md"],
    },
    {
        dir: "agents",
        name: "Agents & conversations",
        files: ["agent-patterns.md", "agentServerConversations.md"],
    },
    {
        dir: "lifecycle",
        name: "Agent installation & lifecycle",
        files: ["agent-sources.md", "agent-lifecycle.md"],
    },
    {
        dir: "browser",
        name: "Browser agent",
        files: ["browserAgent.md", "browserRpc.md", "browserScenarios.md"],
    },
    {
        dir: "workflows",
        name: "Workflow system",
        designTree: true, // directory mirrors a full tree (folded-in Design)
    },
    {
        dir: "doc-pipeline",
        name: "Documentation pipeline",
        files: ["doc-autogen.md", "doc-autogen-setup.md"],
    },
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const cleanOnly = args.has("--clean");

const winFs = process.platform === "win32";
const norm = (p) => (winFs ? path.resolve(p).toLowerCase() : path.resolve(p));
const toPosix = (p) => p.split(path.sep).join("/");

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function isDirSync(p) {
    try {
        return statSync(p).isDirectory();
    } catch {
        return false;
    }
}

async function firstHeading(file) {
    try {
        const text = await fs.readFile(file, "utf8");
        for (const line of text.split(/\r?\n/)) {
            const m = /^#\s+(.+?)\s*$/.exec(line);
            if (m) return m[1].replace(/`/g, "");
        }
    } catch {
        /* ignore */
    }
    return null;
}

async function findPackageDirs(root, excludeSubdir) {
    const result = [];
    async function rec(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        if (entries.some((e) => e.isFile() && e.name === "package.json")) {
            result.push(dir);
        }
        for (const e of entries) {
            if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name === "src") {
                continue;
            }
            const full = path.join(dir, e.name);
            if (excludeSubdir && norm(full) === norm(excludeSubdir)) continue;
            await rec(full);
        }
    }
    await rec(root);
    return result;
}

// ---------------------------------------------------------------------------
// Package / agent staging
// ---------------------------------------------------------------------------

function stagedBaseName(sourceName) {
    return sourceName.toLowerCase() === SOURCE_GENERATED.toLowerCase()
        ? STAGED_GENERATED
        : STAGED_OVERVIEW;
}

async function selectReadmeSources(dir) {
    const hasOverview = await exists(path.join(dir, SOURCE_README));
    const hasGenerated = await exists(path.join(dir, SOURCE_GENERATED));
    const wantOverview =
        hasOverview && (PAGE_POLICY !== "generated" || !hasGenerated);
    const wantGenerated =
        hasGenerated && (PAGE_POLICY !== "overview" || !hasOverview);
    const sources = [];
    if (wantOverview) sources.push(SOURCE_README);
    if (wantGenerated) sources.push(SOURCE_GENERATED);
    if (sources.length === 0) {
        if (hasOverview) sources.push(SOURCE_README);
        else if (hasGenerated) sources.push(SOURCE_GENERATED);
    }
    return { sources, hasOverview, hasGenerated };
}

/** Mirror *.md and image files under `srcDir` into `destDir`. */
async function collectMarkdownTree(srcDir, destDir, items) {
    async function rec(dir, ddir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const s = path.join(dir, e.name);
            const d = path.join(ddir, e.name);
            if (e.isDirectory()) {
                await rec(s, d);
            } else if (e.isFile()) {
                const lower = e.name.toLowerCase();
                if (lower.endsWith(".md"))
                    items.push({ origAbs: s, destAbs: d, kind: "md" });
                else if (IMAGE_RE.test(e.name))
                    items.push({ origAbs: s, destAbs: d, kind: "img" });
            }
        }
    }
    await rec(srcDir, destDir);
}

/**
 * Stage one package's docs: every root-level markdown file (README.md and
 * README.AUTOGEN.md are renamed to overview.md / generated.md; all other root
 * markdown keeps its name), plus a mirror of the package's docs/ directory if
 * one exists.
 */
async function collectPackageItems(dir, section, rel, items) {
    const destBase = path.join(docsRoot, section, rel);
    // 1. README / README.AUTOGEN (page-policy controlled, renamed).
    const { sources } = await selectReadmeSources(dir);
    for (const name of sources) {
        items.push({
            origAbs: path.join(dir, name),
            destAbs: path.join(destBase, stagedBaseName(name)),
            kind: "md",
        });
    }
    // 2. Every other root-level markdown file (name preserved).
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        entries = [];
    }
    for (const e of entries) {
        if (!e.isFile()) continue;
        const lower = e.name.toLowerCase();
        if (!lower.endsWith(".md")) continue;
        if (lower === "readme.md" || lower === "readme.autogen.md") continue;
        items.push({
            origAbs: path.join(dir, e.name),
            destAbs: path.join(destBase, e.name),
            kind: "md",
        });
    }
    // 3. Mirror the docs/ subtree (markdown + images) if present.
    const docsDir = path.join(dir, "docs");
    if (await exists(docsDir)) {
        await collectMarkdownTree(docsDir, path.join(destBase, "docs"), items);
    }
}

async function collectStaged() {
    const items = [];
    for (const dir of await findPackageDirs(packagesDir, agentsDir)) {
        await collectPackageItems(
            dir,
            "packages",
            path.relative(packagesDir, dir),
            items,
        );
    }

    async function writeAgentExplorer() {
        const pkgDirs = await findPackageDirs(agentsDir);
        const { markdown } = await buildAgentExplorer(pkgDirs, tsDir);
        const target = path.join(docsRoot, "agents", AGENT_EXPLORER_FILE);
        await fs.writeFile(target, markdown, "utf8");
        console.log(`wrote ${toPosix(path.relative(docsRoot, target))}`);
    }
    for (const dir of await findPackageDirs(agentsDir)) {
        await collectPackageItems(
            dir,
            "agents",
            path.relative(agentsDir, dir),
            items,
        );
    }
    return items;
}

function withinDocs(abs) {
    const rel = path.relative(docsRoot, abs);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function githubUrl(absPath) {
    const rel = path.relative(repoRoot, absPath);
    if (rel.startsWith("..")) return GITHUB_BASE;
    const posix = toPosix(rel);
    const kind = IMAGE_RE.test(absPath)
        ? "raw"
        : isDirSync(absPath)
          ? "tree"
          : "blob";
    return `${GITHUB_BASE}/${kind}/${BRANCH}/${posix}`;
}

function rewriteTarget(rawUrl, origAbs, destAbs, destMap) {
    let url = rawUrl.trim();
    const angle = url.startsWith("<") && url.endsWith(">");
    if (angle) url = url.slice(1, -1);
    if (
        !url ||
        url.startsWith("#") ||
        url.startsWith("//") ||
        /^[a-z][a-z0-9+.-]*:/i.test(url)
    ) {
        return rawUrl;
    }
    let suffix = "";
    const hashIdx = url.search(/[#?]/);
    if (hashIdx >= 0) {
        suffix = url.slice(hashIdx);
        url = url.slice(0, hashIdx);
    }
    if (!url) return rawUrl;

    const fsPath = decodeURIComponent(url.replace(/%20/g, " "));
    const origTarget = path.resolve(path.dirname(origAbs), fsPath);
    const mapped = destMap.get(norm(origTarget));

    let newUrl;
    if (mapped) {
        newUrl = toPosix(path.relative(path.dirname(destAbs), mapped));
        if (!newUrl.startsWith(".")) newUrl = `./${newUrl}`;
        newUrl = newUrl.replace(/ /g, "%20");
    } else {
        newUrl = githubUrl(origTarget);
    }
    newUrl += suffix;
    return angle ? `<${newUrl}>` : newUrl;
}

function rewriteLinks(content, origAbs, destAbs, destMap) {
    content = content.replace(
        /(!?\[[^\]]*\])\(\s*(<[^>]*>|[^()\s]+)((?:\s+"[^"]*")?)\s*\)/g,
        (m, label, url, title) =>
            `${label}(${rewriteTarget(url, origAbs, destAbs, destMap)}${title})`,
    );
    content = content.replace(
        /^([ \t]*\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/gm,
        (m, head, url, rest) =>
            `${head}${rewriteTarget(url, origAbs, destAbs, destMap)}${rest}`,
    );
    return content;
}

function sourceBanner(origAbs, destAbs) {
    const repoRel = toPosix(path.relative(repoRoot, origAbs));
    const blobUrl = `${GITHUB_BASE}/blob/${BRANCH}/${repoRel}`;
    if (origAbs.toLowerCase().endsWith("readme.autogen.md")) {
        const autogenDoc = toPosix(
            path.relative(
                path.dirname(destAbs),
                path.join(docsRoot, "contributing", "doc-autogen.md"),
            ),
        );
        return (
            `> [!NOTE]\n` +
            `> **Generated reference.** Produced by the doc-autogen pipeline from ` +
            `[\`${repoRel}\`](${blobUrl}). Do not edit it directly — regenerate it ` +
            `(see [doc-autogen](${autogenDoc})).\n\n`
        );
    }
    return (
        `> [!NOTE]\n` +
        `> **Source of truth.** Edit this page at [\`${repoRel}\`](${blobUrl}). ` +
        `This copy is assembled for the wiki and is not edited here.\n\n`
    );
}

async function stage(items) {
    const destMap = new Map();
    for (const it of items) destMap.set(norm(it.origAbs), it.destAbs);
    let mdCount = 0;
    let imgCount = 0;
    for (const it of items) {
        await fs.mkdir(path.dirname(it.destAbs), { recursive: true });
        if (it.kind === "img") {
            await fs.copyFile(it.origAbs, it.destAbs);
            imgCount++;
            continue;
        }
        let content = await fs.readFile(it.origAbs, "utf8");
        content = rewriteLinks(content, it.origAbs, it.destAbs, destMap);
        content = sourceBanner(it.origAbs, it.destAbs) + content;
        await fs.writeFile(it.destAbs, content, "utf8");
        mdCount++;
    }
    console.log(`staged ${mdCount} markdown + ${imgCount} images`);
}

// ---------------------------------------------------------------------------
// Navigation (toc.yml)
// ---------------------------------------------------------------------------

/**
 * Extra toc entries for a package beyond its Overview / Generated README:
 * every other root-level markdown file, and a "docs" node mirroring docs/.
 * hrefs are relative to `rootDir` (the section's toc.yml location).
 */
async function extraPackageTocItems(dir, rel, rootDir) {
    const out = [];
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        entries = [];
    }
    const others = entries
        .filter(
            (e) =>
                e.isFile() &&
                e.name.toLowerCase().endsWith(".md") &&
                e.name.toLowerCase() !== "readme.md" &&
                e.name.toLowerCase() !== "readme.autogen.md",
        )
        .map((e) => e.name)
        .sort();
    for (const f of others) {
        const title =
            (await firstHeading(path.join(dir, f))) ?? f.replace(/\.md$/i, "");
        out.push({ name: title, href: `${rel}/${f}` });
    }
    const docsDir = path.join(dir, "docs");
    if (await exists(docsDir)) {
        const docsItems = await buildDocsToc(docsDir, rootDir);
        if (docsItems.length) {
            const node = { name: "docs", items: docsItems };
            for (const t of ["README.md", "index.md"]) {
                if (await exists(path.join(docsDir, t))) {
                    node.href = `${rel}/docs/${t}`;
                    break;
                }
            }
            out.push(node);
        }
    }
    return out;
}

async function buildPackageToc(rootDir, excludeSubdir) {
    const pkgDirs = await findPackageDirs(rootDir, excludeSubdir);
    const rels = pkgDirs
        .map((d) => toPosix(path.relative(rootDir, d)))
        .filter((r) => r && r !== ".")
        .sort();
    const root = { children: new Map() };
    for (const rel of rels) {
        let node = root;
        for (const seg of rel.split("/")) {
            if (!node.children.has(seg))
                node.children.set(seg, { children: new Map() });
            node = node.children.get(seg);
        }
        node.rel = rel;
        node.isPackage = true;
    }
    async function emit(node) {
        const items = [];
        for (const [seg, child] of [...node.children.entries()].sort((a, b) =>
            a[0].localeCompare(b[0]),
        )) {
            const childItems = await emit(child);
            if (child.isPackage) {
                const dir = path.join(rootDir, child.rel);
                const { sources } = await selectReadmeSources(dir);
                const stageOverview = sources.includes(SOURCE_README);
                const stageGenerated = sources.includes(SOURCE_GENERATED);
                const overviewHref = stageOverview
                    ? `${child.rel}/${STAGED_OVERVIEW}`
                    : undefined;
                const generatedHref = stageGenerated
                    ? `${child.rel}/${STAGED_GENERATED}`
                    : undefined;
                const leaves = [];
                let primaryHref;
                if (overviewHref) {
                    primaryHref = overviewHref;
                    if (generatedHref)
                        leaves.push({
                            name: "Generated README",
                            href: generatedHref,
                        });
                } else if (generatedHref) {
                    primaryHref = generatedHref;
                }
                const item = { name: seg, href: primaryHref };
                const extra = await extraPackageTocItems(
                    dir,
                    child.rel,
                    rootDir,
                );
                const subItems = [...leaves, ...extra, ...childItems];
                if (subItems.length) item.items = subItems;
                if (!item.href && !item.items) continue;
                items.push(item);
            } else if (childItems.length) {
                items.push({ name: seg, items: childItems });
            }
        }
        return items;
    }
    return emit(root);
}

/**
 * Mirror a docs directory tree as a toc. `hrefRoot` is the directory the toc.yml
 * lives in (hrefs are computed relative to it); it defaults to `walkRoot`.
 */
async function buildDocsToc(walkRoot, hrefRoot = walkRoot) {
    async function emit(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return { items: [], topicHref: undefined };
        }
        const mdFiles = entries
            .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
            .map((e) => e.name);
        const subDirs = entries
            .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
            .map((e) => e.name)
            .sort();
        const topic = ["README.md", "index.md", "PLAN.md"]
            .map((c) =>
                mdFiles.find((f) => f.toLowerCase() === c.toLowerCase()),
            )
            .find(Boolean);
        const items = [];
        for (const f of mdFiles.sort()) {
            if (f === topic) continue;
            const rel = toPosix(path.relative(hrefRoot, path.join(dir, f)));
            const title =
                (await firstHeading(path.join(dir, f))) ??
                f.replace(/\.md$/i, "");
            items.push({ name: title, href: rel });
        }
        for (const sd of subDirs) {
            const { items: childItems, topicHref } = await emit(
                path.join(dir, sd),
            );
            if (!childItems.length && !topicHref) continue;
            const node = { name: sd };
            if (topicHref) node.href = topicHref;
            if (childItems.length) node.items = childItems;
            items.push(node);
        }
        const topicHref = topic
            ? toPosix(path.relative(hrefRoot, path.join(dir, topic)))
            : undefined;
        return { items, topicHref };
    }
    const { items } = await emit(walkRoot);
    return items;
}

async function buildArchitectureToc() {
    const archDir = path.join(docsRoot, "architecture");
    const items = [];
    for (const g of ARCH_GROUPS) {
        const gDir = path.join(archDir, g.dir);
        if (g.designTree) {
            const sub = await buildDocsToc(gDir, archDir);
            if (!sub.length) continue;
            const node = { name: g.name, items: sub };
            for (const topic of ["README.md", "index.md", "workflows.md"]) {
                if (await exists(path.join(gDir, topic))) {
                    node.href = `${g.dir}/${topic}`;
                    break;
                }
            }
            items.push(node);
        } else {
            const leaves = [];
            for (const f of g.files) {
                if (await exists(path.join(gDir, f))) {
                    const title =
                        (await firstHeading(path.join(gDir, f))) ??
                        f.replace(/\.md$/i, "");
                    leaves.push({ name: title, href: `${g.dir}/${f}` });
                }
            }
            if (leaves.length) items.push({ name: g.name, items: leaves });
        }
    }
    // Uncategorized: any root-level architecture/*.md other than index.md.
    let rootMd = [];
    try {
        rootMd = (await fs.readdir(archDir)).filter(
            (f) =>
                f.toLowerCase().endsWith(".md") &&
                f.toLowerCase() !== "index.md",
        );
    } catch {
        /* ignore */
    }
    if (rootMd.length) {
        const leaves = [];
        for (const f of rootMd.sort()) {
            const title =
                (await firstHeading(path.join(archDir, f))) ??
                f.replace(/\.md$/i, "");
            leaves.push({ name: title, href: f });
        }
        items.push({ name: "Uncategorized", items: leaves });
    }
    return items;
}

const GENERATED_HEADER =
    "# <auto-generated> Do not edit by hand.\n" +
    "# Regenerate with: node ts/docs/scripts/build-wiki.mjs\n\n";

function yamlString(s) {
    if (/[:#{}\[\],&*?|<>=!%@`"']/.test(s) || /^\s|\s$/.test(s))
        return JSON.stringify(s);
    return s;
}

function toYaml(items, indent = 0) {
    const pad = "  ".repeat(indent);
    let out = "";
    for (const item of items) {
        out += `${pad}- name: ${yamlString(item.name)}\n`;
        if (item.href) out += `${pad}  href: ${item.href}\n`;
        if (item.topicHref) out += `${pad}  topicHref: ${item.topicHref}\n`;
        if (item.items && item.items.length) {
            out += `${pad}  items:\n`;
            out += toYaml(item.items, indent + 2);
        }
    }
    return out;
}

async function writeToc(targetFile, items) {
    const body =
        GENERATED_HEADER +
        toYaml([{ name: "Overview", href: "index.md" }, ...items]);
    await fs.writeFile(targetFile, body, "utf8");
    console.log(`wrote ${toPosix(path.relative(docsRoot, targetFile))}`);
}

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function safeReaddir(dir) {
    try {
        return await fs.readdir(dir);
    } catch {
        return [];
    }
}

/** Remove staged package/agent docs + generated tocs; keep native content. */
async function clean() {
    for (const section of ["packages", "agents"]) {
        const dir = path.join(docsRoot, section);
        for (const name of await safeReaddir(dir)) {
            if (name === "index.md") continue;
            await fs.rm(path.join(dir, name), { recursive: true, force: true });
        }
    }
    for (const toc of ["architecture/toc.yml"]) {
        await fs.rm(path.join(docsRoot, toc), { force: true });
    }
    console.log("cleaned staged + generated output");
}

// ---------------------------------------------------------------------------

async function main() {
    if (checkOnly) {
        const archItems = await buildArchitectureToc();
        const unc = archItems.find((i) => i.name === "Uncategorized");
        if (unc) {
            console.error(
                `Uncategorized architecture docs: ${unc.items.map((i) => i.href).join(", ")}\n` +
                    "  Assign each to a group in ARCH_GROUPS (ts/docs/scripts/build-wiki.mjs).",
            );
            process.exit(1);
        }
        console.log("check passed.");
        return;
    }

    await clean();
    if (cleanOnly) return;

    const items = await collectStaged();
    await stage(items);
    await writeAgentExplorer();

    await writeToc(
        path.join(docsRoot, "packages", "toc.yml"),
        await buildPackageToc(packagesDir, agentsDir),
    );
    await writeToc(
        path.join(docsRoot, "agents", "toc.yml"),
        [{ name: "Agent & action explorer", href: AGENT_EXPLORER_FILE }].concat(
            await buildPackageToc(agentsDir),
        ),
    );
    await writeToc(
        path.join(docsRoot, "architecture", "toc.yml"),
        await buildArchitectureToc(),
    );

    console.log("done. Now run: docfx build ts/docs/docfx.json");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
