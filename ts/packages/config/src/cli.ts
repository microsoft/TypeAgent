// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";

import { loadConfig } from "./loader.js";
import {
    importDotEnv,
    writeConfigYamlFile,
    type ImportResult,
} from "./import.js";
import { redactFlat, redactTree } from "./redact.js";
import { fetchKeyVaultConfig } from "./keyVault.js";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import type { ConfigSource, KeyVaultOptions } from "./types.js";

/**
 * Stream-like sink used by the CLI runner. Tests substitute their
 * own implementation to capture output without touching the real
 * `process.stdout` / `process.stderr`.
 */
export interface CliIO {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

const consoleIO: CliIO = {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
};

/**
 * Argument tuple accepted by the CLI runner. Mirrors `process.argv`
 * with the leading `node` and script-path arguments stripped.
 */
export type CliArgs = string[];

const HELP = `\
typeagent-config <command> [options]

Commands:
  import <path/to/.env> [--out <yaml>]   Convert a .env file to YAML.
                                          Verifies a lossless round-trip.
                                          --out defaults to ./config.local.yaml
  show [--source] [--reveal-secrets]      Print the merged config (redacted by
                                          default).  --source annotates each
                                          key with its origin layer.
  check [--vault <name>] [--secret <s>]   Verify Azure auth + Key Vault
                                          reachability.  Returns exit code 0
                                          on success, 1 on failure.
  --help, -h                              Show this message.

Environment:
  Most commands honor TYPEAGENT_CONFIG_VAULT and
  TYPEAGENT_CONFIG_SECRET as defaults for --vault and --secret.
`;

/**
 * Run the CLI. Returns a numeric exit code (0 = success). Designed to
 * be called from a thin bin shim or directly from tests.
 */
export async function runCli(
    argv: CliArgs,
    io: CliIO = consoleIO,
): Promise<number> {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === "--help" || cmd === "-h") {
        io.stdout(HELP);
        return cmd ? 0 : 1;
    }

    try {
        switch (cmd) {
            case "import":
                return await runImport(rest, io);
            case "show":
                return await runShow(rest, io);
            case "check":
                return await runCheck(rest, io);
            default:
                io.stderr(`Unknown command: ${cmd}\n`);
                io.stdout(HELP);
                return 1;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        io.stderr(`Error: ${msg}\n`);
        return 1;
    }
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

async function runImport(args: string[], io: CliIO): Promise<number> {
    const positional: string[] = [];
    let outPath: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--out") {
            outPath = args[++i];
        } else if (a.startsWith("--")) {
            io.stderr(`Unknown flag: ${a}\n`);
            return 1;
        } else {
            positional.push(a);
        }
    }
    if (positional.length !== 1) {
        io.stderr(
            `Usage: typeagent-config import <path-to-.env> [--out <yaml>]\n`,
        );
        return 1;
    }
    const inputPath = positional[0];
    if (!fs.existsSync(inputPath)) {
        io.stderr(`File not found: ${inputPath}\n`);
        return 1;
    }
    const result: ImportResult = importDotEnv(inputPath);

    const target = outPath ?? path.resolve("config.local.yaml");
    writeConfigYamlFile(
        target,
        result.tree,
        `# Imported from ${path.relative(process.cwd(), inputPath) || inputPath}\n` +
            `# This file is gitignored — never commit secrets.\n`,
    );

    io.stdout(
        `Imported ${result.counts.total} key(s) → ${target}\n` +
            `  structured: ${result.counts.structured}\n` +
            `  extras:     ${result.counts.extras}\n` +
            (result.intentionalRewrites.length > 0
                ? `  rewrites:   ${result.intentionalRewrites.length}\n`
                : "") +
            `Round-trip verified.\n`,
    );
    return 0;
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

async function runShow(args: string[], io: CliIO): Promise<number> {
    let showSource = false;
    let revealSecrets = false;
    for (const a of args) {
        if (a === "--source") showSource = true;
        else if (a === "--reveal-secrets") revealSecrets = true;
        else if (a === "--help" || a === "-h") {
            io.stdout(
                `Usage: typeagent-config show [--source] [--reveal-secrets]\n`,
            );
            return 0;
        } else {
            io.stderr(`Unknown flag: ${a}\n`);
            return 1;
        }
    }

    const result = await loadConfig({
        populateProcessEnv: false,
        trackSources: showSource,
        strict: false,
    });

    const flat = revealSecrets ? result.env : redactFlat(result.env);
    const keys = Object.keys(flat).sort();

    if (showSource && result.sources) {
        const sources = result.sources;
        for (const k of keys) {
            const src = sources[k] ?? ("?" as ConfigSource);
            io.stdout(`${k}=${flat[k]} [${src}]\n`);
        }
    } else {
        for (const k of keys) {
            io.stdout(`${k}=${flat[k]}\n`);
        }
    }
    return 0;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

interface CheckOptions {
    vault?: string;
    secret?: string;
    credential?: TokenCredential;
}

async function runCheck(args: string[], io: CliIO): Promise<number> {
    const opts: CheckOptions = {};
    if (process.env.TYPEAGENT_CONFIG_VAULT) {
        opts.vault = process.env.TYPEAGENT_CONFIG_VAULT;
    }
    if (process.env.TYPEAGENT_CONFIG_SECRET) {
        opts.secret = process.env.TYPEAGENT_CONFIG_SECRET;
    }
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--vault") opts.vault = args[++i];
        else if (a === "--secret") opts.secret = args[++i];
        else if (a === "--help" || a === "-h") {
            io.stdout(
                `Usage: typeagent-config check [--vault <name>] [--secret <s>]\n`,
            );
            return 0;
        } else {
            io.stderr(`Unknown flag: ${a}\n`);
            return 1;
        }
    }
    if (!opts.vault) {
        io.stderr(
            `Vault name required. Pass --vault <name> or set TYPEAGENT_CONFIG_VAULT.\n`,
        );
        return 1;
    }

    const credential = opts.credential ?? new DefaultAzureCredential();
    const kvOptions: KeyVaultOptions = {
        vaultName: opts.vault,
        credential,
        failOnError: true,
    };
    if (opts.secret !== undefined) {
        kvOptions.secretName = opts.secret;
    }

    io.stdout(`Checking Key Vault ${opts.vault}…\n`);
    try {
        const tree = await fetchKeyVaultConfig(kvOptions);
        if (tree === null) {
            io.stderr(
                `Auth OK, but secret '${opts.secret ?? "typeagent-config"}' not found in vault '${opts.vault}'.\n`,
            );
            return 1;
        }
        const flat = redactTree(tree);
        const summary = yaml.dump(flat, { indent: 2, sortKeys: true });
        io.stdout(`OK. Resolved ${countLeaves(tree)} value(s).\n`);
        io.stdout(`Redacted preview:\n${summary}`);
        return 0;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        io.stderr(`FAIL: ${msg}\n`);
        return 1;
    }
}

function countLeaves(node: unknown): number {
    if (node === null || node === undefined) return 0;
    if (typeof node !== "object") return 1;
    if (Array.isArray(node)) {
        return node.reduce<number>((acc, item) => acc + countLeaves(item), 0);
    }
    let n = 0;
    for (const v of Object.values(node as Record<string, unknown>)) {
        n += countLeaves(v);
    }
    return n;
}
