// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, realpath, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check } from "./quality-contract.mjs";
import {
    validateCampaignOutputs,
    scoreCampaignArtifacts,
    validateExampleRunArtifacts,
} from "./quality-view-campaign.mjs";

export const ownershipMarker = ".quality-view-campaign-owner.json";
export const help = `Offline informational-view campaign tools (no network, models or credentials)

node quality-view-campaign-cli.mjs validate --root <project-relative-owned-root>
  --construction <file> --campaign <file> --run <file> --outputs <file>
  --mapping <file> --out <new-file>
node quality-view-campaign-cli.mjs score <same flags>
  --gold <file> --review <file> --annotations <file>
node quality-view-campaign-cli.mjs validate-example --root <owned-example-run>
  --construction <project-relative-file> --receipt receipt.json --saved saved.json
  --rendered rendered.txt --source-mapping source-mapping.json
  --request-evidence request-evidence.json --out <new-diagnostic-file>

For validate/score, file flags are relative to --root. Root must already contain
${ownershipMarker} with
{"schemaVersion":1,"purpose":"quality-view-campaign","ownerId":"your-owner-id"}.
Symlinks, paths outside the project, frozen fixtures, holdout paths and
credential filenames are refused. --out is created exclusively, never replaced.
Gold is explicit evaluator-custodied input; no frozen loader is used.
--help does not read files. No acquisition or execution commands exist.
validate-example accepts the runner's .wiki-views-owned.json marker and exact
ViewVersion/snapshot files. It never produces production quality scores or
fabricates wire requests, usage, or citation resolution receipts.
Only its --construction flag is project-relative; artifact files stay root-relative.
`;

const baseFlags = [
    "root",
    "construction",
    "campaign",
    "run",
    "outputs",
    "mapping",
    "out",
];
const reviewFlags = ["gold", "review", "annotations"];
const exampleFlags = [
    "root",
    "construction",
    "receipt",
    "saved",
    "rendered",
    "source-mapping",
    "request-evidence",
    "out",
];

function commandFlags(command) {
    return command === "validate-example"
        ? exampleFlags
        : [...baseFlags, ...(command === "score" ? reviewFlags : [])];
}
const forbidden =
    /^(?:quality-fixtures|holdout|heldout|\.typeagent|\.npmrc|\.env(?:\..*)?|config(?:\.local|\.sample)?\.ya?ml|credentials(?:\..*)?|secrets(?:\..*)?)$/i;

function relativeName(value) {
    check(
        typeof value === "string" &&
            value.length > 0 &&
            !path.isAbsolute(value),
        "Project-relative path required",
    );
    const pieces = value.split(/[\\/]/);
    check(
        pieces.every(
            (piece) =>
                piece &&
                piece !== "." &&
                piece !== ".." &&
                !/[<>:"|?*\x00-\x1f]/.test(piece) &&
                !/[. ]$/.test(piece) &&
                !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
                    piece,
                ) &&
                !forbidden.test(piece),
        ),
        "Unsafe/frozen/holdout/credential path",
    );
    return pieces;
}

async function confined(base, name, absentLeaf = false) {
    const pieces = relativeName(name);
    let current = base;
    for (let index = 0; index < pieces.length; index++) {
        current = path.join(current, pieces[index]);
        try {
            const stat = await lstat(current);
            check(!stat.isSymbolicLink(), "Symlink/junction paths are refused");
            if (index < pieces.length - 1)
                check(stat.isDirectory(), "Path parent must be directory");
            if (absentLeaf && index === pieces.length - 1)
                throw new Error("Output already exists; refusing overwrite");
        } catch (error) {
            if (
                error.code === "ENOENT" &&
                absentLeaf &&
                index === pieces.length - 1
            )
                return current;
            throw error;
        }
    }
    return current;
}

function parse(args) {
    const command = args[0];
    check(
        ["validate", "score", "validate-example"].includes(command),
        "Expected validate, score or validate-example; use --help",
    );
    const allowed = commandFlags(command);
    const flags = {};
    for (let index = 1; index < args.length; index += 2) {
        const key = args[index]?.replace(/^--/, "");
        check(
            args[index]?.startsWith("--") && allowed.includes(key),
            "Unknown CLI flag",
        );
        check(
            flags[key] === undefined &&
                args[index + 1] &&
                !args[index + 1].startsWith("--"),
            "Duplicate flag or missing flag value",
        );
        flags[key] = args[index + 1];
    }
    for (const key of allowed) check(flags[key], `Missing --${key}`);
    return { command, flags };
}

export async function main(
    args,
    {
        cwd = process.cwd(),
        stdout = process.stdout,
        stderr = process.stderr,
    } = {},
) {
    try {
        if (args.length === 1 && args[0] === "--help") {
            stdout.write(help);
            return 0;
        }
        const { command, flags } = parse(args);
        const project = await realpath(cwd);
        const root = await confined(project, flags.root);
        check(
            (await lstat(root)).isDirectory(),
            "Owned root must be directory",
        );
        const markerPath = await confined(
            root,
            command === "validate-example"
                ? ".wiki-views-owned.json"
                : ownershipMarker,
        );
        const marker = JSON.parse(await readFile(markerPath, "utf8"));
        check(
            marker.schemaVersion === 1 &&
                (command === "validate-example"
                    ? marker.owner === "wiki-views"
                    : marker.purpose === "quality-view-campaign" &&
                      typeof marker.ownerId === "string" &&
                      marker.ownerId.trim()),
            "Campaign ownership marker required",
        );
        const out = await confined(root, flags.out, true);
        const inputNames = commandFlags(command).filter(
            (key) => !["root", "out"].includes(key),
        );
        const paths = await Promise.all(
            inputNames.map((key) =>
                confined(
                    command === "validate-example" && key === "construction"
                        ? project
                        : root,
                    flags[key],
                ),
            ),
        );
        check(!paths.includes(out), "Output must not replace input");
        const inputs = Object.fromEntries(
            await Promise.all(
                inputNames.map(async (key, index) => [
                    key,
                    command === "validate-example" && key !== "construction"
                        ? await readFile(paths[index], "utf8")
                        : JSON.parse(
                              (await readFile(paths[index], "utf8")).replace(
                                  /^\uFEFF/,
                                  "",
                              ),
                          ),
                ]),
            ),
        );
        const {
            construction,
            campaign,
            run,
            outputs,
            mapping,
            annotations,
            gold,
            review,
        } = inputs;
        const result =
            command === "validate-example"
                ? validateExampleRunArtifacts(construction, {
                      receipt: inputs.receipt,
                      saved: inputs.saved,
                      rendered: inputs.rendered,
                      sourceMapping: inputs["source-mapping"],
                      requestEvidence: inputs["request-evidence"],
                  })
                : command === "validate"
                  ? {
                        schemaVersion: 1,
                        status: "validated-identities-and-schedule-only",
                        runHash: validateCampaignOutputs(
                            construction,
                            campaign,
                            run,
                            outputs,
                            mapping,
                        ),
                        semanticQualityEvaluated: false,
                    }
                  : scoreCampaignArtifacts(
                        construction,
                        campaign,
                        run,
                        outputs,
                        annotations,
                        gold,
                        review,
                        mapping,
                    );
        await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, {
            flag: "wx",
        });
        stdout.write(`${command}: wrote ${flags.out}\n`);
        return 0;
    } catch (error) {
        stderr.write(`${error.message}\n`);
        return 1;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    process.exitCode = await main(process.argv.slice(2));
}
