#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// azure-tts.mts — synthesize and play Azure Speech TTS for the demo driver.
//
// Auth mirrors ts/packages/shell/src/main/azureSpeech.ts identity mode:
//   1. Acquire an AAD bearer token via `az account get-access-token`
//      (scope = https://cognitiveservices.azure.com).
//   2. POST SSML to https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
//      with `Authorization: Bearer aad#<resourceId>#<aadToken>`. The composite
//      header is the same format the Speech SDK produces internally for AAD.
//
// Config comes from SPEECH_SDK_REGION + SPEECH_SDK_ENDPOINT env vars, falling
// back to the nearest .env file by walking up from this script's location.
//
//
// Examples:
//   node azure-tts.mjs --text "Hello world"
//   node azure-tts.mjs --text "Hi" --voice en-US-AriaNeural --style cheerful
//   node azure-tts.mjs --text "Save it" --out out.wav --no-play

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const execFileP = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

interface Args {
    text: string;
    voice: string;
    style: string;
    rate: string;
    region: string | undefined;
    resourceId: string | undefined;
    out: string | undefined;
    noPlay: boolean;
}

interface SpeechConfig {
    region: string;
    resourceId: string;
}

interface AzureToken {
    accessToken: string;
    expiresOn: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        text: "",
        voice: "en-US-AndrewMultilingualNeural",
        style: "chat",
        rate: "+0%",
        region: undefined,
        resourceId: undefined,
        out: undefined,
        noPlay: false,
    };
    let textSeen = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`Missing value for ${a}`);
            return v;
        };
        switch (a) {
            case "--text":
                args.text = next();
                textSeen = true;
                break;
            case "--voice":
                args.voice = next();
                break;
            case "--style":
                args.style = next();
                break;
            case "--rate":
                args.rate = next();
                break;
            case "--region":
                args.region = next();
                break;
            case "--resource":
                args.resourceId = next();
                break;
            case "--out":
                args.out = next();
                break;
            case "--no-play":
                args.noPlay = true;
                break;
            case "-h":
            case "--help":
                console.log(
                    'Usage: node azure-tts.mjs --text "..." [--voice NAME] [--style NAME] [--rate +0%] [--region R] [--resource RID] [--out FILE] [--no-play]',
                );
                process.exit(0);

            default:
                throw new Error(`Unknown argument: ${a}`);
        }
    }
    if (!textSeen) throw new Error("--text is required");
    return args;
}

function resolveConfig(
    regionArg: string | undefined,
    resourceIdArg: string | undefined,
): SpeechConfig {
    let region = regionArg ?? process.env["SPEECH_SDK_REGION"];
    let resourceId = resourceIdArg ?? process.env["SPEECH_SDK_ENDPOINT"];
    if (region && resourceId) return { region, resourceId };

    let dir = SCRIPT_DIR;
    while (true) {
        const candidate = join(dir, ".env");
        if (existsSync(candidate)) {
            for (const line of readFileSync(candidate, "utf8").split(/\r?\n/)) {
                const m = line.match(
                    /^(SPEECH_SDK_REGION|SPEECH_SDK_ENDPOINT)=(.+)$/,
                );
                if (!m) continue;
                if (m[1] === "SPEECH_SDK_REGION" && !region) region = m[2];
                if (m[1] === "SPEECH_SDK_ENDPOINT" && !resourceId)
                    resourceId = m[2];
            }
            break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    if (!region || !resourceId) {
        throw new Error(
            "Azure Speech config not found. Set SPEECH_SDK_REGION and SPEECH_SDK_ENDPOINT, or place them in a .env file.",
        );
    }
    return { region, resourceId };
}

async function getAadToken(): Promise<string> {
    const cachePath = join(tmpdir(), "typeagent-azure-speech-token.json");
    if (existsSync(cachePath)) {
        try {
            const cached: AzureToken = JSON.parse(
                readFileSync(cachePath, "utf8"),
            );
            const expiresOn = new Date(cached.expiresOn);
            if (expiresOn.getTime() > Date.now() + 5 * 60_000)
                return cached.accessToken;
        } catch {
            // fall through to refresh
        }
    }
    const args = [
        "account",
        "get-access-token",
        "--resource",
        "https://cognitiveservices.azure.com",
        "--output",
        "json",
    ];
    const opts = { windowsHide: true, shell: process.platform === "win32" };
    const { stdout } = await execFileP("az", args, opts);
    const obj: AzureToken = JSON.parse(stdout);
    writeFileSync(cachePath, JSON.stringify(obj), "utf8");
    return obj.accessToken;
}

const XML_ENTITIES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
};

function escapeXml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);
}

// Map common SAPI-style voice names ("Microsoft Aria Natural") to the Azure
// shortName the Speech REST endpoint expects ("en-US-AriaNeural"). Leaves
// already-Azure-style names untouched.
function normalizeVoice(name: string): string {
    const m = name.match(/^Microsoft\s+(\w+)\s+(?:Online\s*\()?Natural\)?$/i);
    return m ? `en-US-${m[1]}Neural` : name;
}

function buildSsml(args: Args): string {
    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>
<voice name='${normalizeVoice(args.voice)}'><mstts:express-as style='${args.style}'><prosody rate='${args.rate}'>${escapeXml(args.text)}</prosody></mstts:express-as></voice>
</speak>`;
}

async function synthesize(
    cfg: SpeechConfig,
    token: string,
    ssml: string,
    outFile: string,
): Promise<void> {
    const url = `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer aad#${cfg.resourceId}#${token}`,
            "Content-Type": "application/ssml+xml; charset=utf-8",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "typeagent-demo-driver",
        },
        body: ssml,
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `TTS request failed: ${res.status} ${res.statusText}\n${body}`,
        );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, buf);
}

function playSync(file: string): Promise<void> {
    let cmd: string;
    let cmdArgs: string[];
    switch (process.platform) {
        case "win32":
            cmd = "powershell";
            cmdArgs = [
                "-NoProfile",
                "-Command",
                `(New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`,
            ];
            break;
        case "darwin":
            cmd = "afplay";
            cmdArgs = [file];
            break;
        case "linux":
            cmd = "paplay";
            cmdArgs = [file];
            break;
        default:
            throw new Error(
                `Audio playback not implemented for ${process.platform}`,
            );
    }
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, cmdArgs, { stdio: "ignore" });
        child.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
        );
        child.on("error", reject);
    });
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cfg = resolveConfig(args.region, args.resourceId);
    const token = await getAadToken();
    const ssml = buildSsml(args);
    const outFile =
        args.out ?? join(tmpdir(), `typeagent-tts-${randomUUID()}.wav`);
    await synthesize(cfg, token, ssml, outFile);

    if (args.noPlay) {
        process.stdout.write(outFile + "\n");
        return;
    }
    try {
        await playSync(outFile);
    } finally {
        if (!args.out) {
            try {
                await unlink(outFile);
            } catch {
                /* best-effort cleanup */
            }
        }
    }
}

main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(msg + "\n");
    process.exit(1);
});
