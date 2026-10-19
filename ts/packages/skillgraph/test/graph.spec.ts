// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SkillGraph } from "../src/graph.js";
import { parseHelp, SpecStore } from "../src/specs.js";
import { commandsFromCode } from "../src/shell.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test → test/fixtures (fixtures are not compiled).
const root = path.resolve(here, "../../test/fixtures/skills");

describe("skillgraph check on fixture skills", () => {
    it("checks commands without treating examples or separate skill scopes as errors", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillgraph-noise-"));
        try {
            const roots = ["one", "two"].map((name) => path.join(dir, name));
            for (const root of roots) {
                const skill = path.join(root, "review");
                fs.mkdirSync(path.join(skill, "scripts"), { recursive: true });
                const text =
                    '---\nname: review\ndescription: Review\n---\n`var x = "CANARY";` `GET /api/items HTTP/1.1`\n`../references/missing.md` `../../etc/passwd`\n| Example | Value |\n| --- | --- |\n| `x` | `[example](<url>)` |\n[missing](<missing.md>)\n```bash\npython3 -c "\nfrom pathlib import Path\ndoc = {}\n"\npython scripts/missing.py\n```';
                fs.writeFileSync(path.join(skill, "SKILL.md"), text);
            }
            const result = new SkillGraph({ roots, probe: false }).build();
            expect(result.skills).toHaveLength(2);
            expect(result.diagnostics.map((d) => d.rule).sort()).toEqual([
                "link-broken",
                "link-broken",
                "script-missing",
                "script-missing",
            ]);
            const shell =
                "python3 <<'PY'\nfrom pathlib import Path\nPY\ngh pr view 1 --json \"a # b\"";
            const commands = commandsFromCode("bash", shell, 1, 1);
            expect(commands.map((c) => c.tool)).toEqual(["gh"]);
            expect(commands[0].args).toContain("a # b");
            const comment = commandsFromCode(
                "bash",
                'gh pr list;# "\ngh pr view 1',
                1,
                1,
            );
            expect(comment).toHaveLength(2);
            const multiline = commandsFromCode(
                "bash",
                'gh pr view 1 --body "a\nb" --missing',
                1,
                1,
            )[0];
            expect([
                multiline.argLines.at(-1),
                multiline.argCols.at(-1),
            ]).toEqual([2, 4]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it("reports each broken reference once, with the spec version", async () => {
        // Fake `gh` on PATH so the help probe is hermetic.
        const bin = fs.mkdtempSync(path.join(os.tmpdir(), "skillgraph-bin-"));
        fs.writeFileSync(
            path.join(bin, "gh"),
            `#!/bin/sh
case "$*" in
  --version) echo "gh version 2.62.0" ;;
  "pr --help") printf 'USAGE\\n  gh pr <command> [flags]\\n\\nCOMMANDS\\n  comment:  Add a comment\\n  view:     View a PR\\n' ;;
  *) printf 'USAGE\\n  gh <command>\\n\\nCOMMANDS\\n  pr:  Pull requests\\n' ;;
esac
`,
            { mode: 0o755 },
        );
        process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
        const store = new SpecStore(
            path.join(os.tmpdir(), `skillgraph-test-${process.pid}`),
        );
        const graph = new SkillGraph(
            { roots: [root, root], probe: true },
            store,
        );
        const res = await graph.buildWithProbes();
        const got = res.diagnostics
            .filter((d) => d.severity !== "info")
            .map((d) => `${path.basename(d.at.file)}:${d.at.line} ${d.rule}`)
            .sort();
        expect(got).toEqual([
            "SKILL.md:14 anchor-missing",
            "SKILL.md:16 flag-unknown",
            "SKILL.md:20 subcommand-unknown",
            "SKILL.md:24 skill-unknown",
        ]);
        const sub = res.diagnostics.find(
            (d) => d.rule === "subcommand-unknown",
        );
        expect(sub?.message).toContain('did you mean "comment"');
        expect(sub?.spec?.version).toBe("2.62.0");
        expect(
            res.diagnostics.some(
                (d) =>
                    d.rule === "orphan" && d.at.file.endsWith("old_fetch.py"),
            ),
        ).toBe(true);
    });

    it("reads help sections and transcripts without hardcoded tool lists", () => {
        // Rows under "Arguments:"/"Options" are not subcommands (codex mcp add).
        const help = parseHelp(
            "Usage: x mcp add [OPTIONS] <NAME> -- <COMMAND>...\n\nArguments:\n  servers   Server names\n\nOptions:\n      --url <URL>  URL\n",
        );
        expect(help.subcommands).toEqual([]);
        // `$ ` prompts mark a transcript: unprompted lines are output (tirith receipt).
        const cmds = commandsFromCode(
            "bash",
            "$ tirith receipt last\n  Domains referenced: x.sh",
            1,
            1,
        );
        expect(cmds.map((c) => c.tool)).toEqual(["tirith"]);
        // PowerShell: PS prompt, `&` call operator, backtick continuation,
        // cmdlets skipped, `pwsh -File` unwrapped.
        const ps = commandsFromCode(
            "powershell",
            "PS C:\\> & .\\scripts\\sync.ps1 -Name a `\n  -dry\nGet-ChildItem -Recurse\nPS> pwsh -NoProfile -File scripts/sync.ps1 -Nmae b",
            1,
            1,
        );
        expect(ps.map((c) => [c.tool, c.args])).toEqual([
            ["./scripts/sync.ps1", ["-Name", "a", "-dry"]],
            ["scripts/sync.ps1", ["-Nmae", "b"]],
        ]);
    });
});
