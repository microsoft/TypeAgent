// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
    watchFile,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
    getConfigPath,
    getMode,
    getMcpRouting,
    readConfig,
    type Mode,
} from "./plugin-config.js";

export interface ControlMetadata {
    effectiveMode: Mode | null;
    configPath: string;
    dataRoot: string;
    source: {
        component: string;
        pid: number;
        parentPid: number;
        executable: string;
        cwd: string;
        owner: string;
        instance: string | null;
        server: string | null;
        observedAt: string;
        config: "TYPEAGENT_PLUGIN_DATA" | "CLAUDE_PLUGIN_DATA" | "default";
        mode: "TYPEAGENT_MODE" | "config" | "default" | "unowned-unread";
        routing: "delegate" | "mixed" | null;
        expectedConfigPath: string;
        expectedMode: Mode | null;
        readableOwnedConfig: boolean;
        request: ControlRequest | null;
    };
    digest: string | null;
}

export interface ControlRequest {
    sessionId: string;
    timestamp: number;
    cwd: string;
}

function publicRequest(request?: ControlRequest): ControlRequest | null {
    if (!request) return null;
    return {
        sessionId: request.sessionId,
        timestamp: request.timestamp,
        cwd: request.cwd,
    };
}

function contained(root: string, file: string): boolean {
    const suffix = relative(root, file);
    return (
        suffix !== ".." &&
        !suffix.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
        !isAbsolute(suffix)
    );
}

function admittedOwner(
    dataRoot: string,
    admissionFile: string,
    component: string,
) {
    if (
        lstatSync(dataRoot).isSymbolicLink() ||
        lstatSync(admissionFile).isSymbolicLink()
    )
        throw new Error("Control metadata admission must not be a symlink");
    const admission: {
        owner: string;
        ownedRoot: string;
        configPath: string;
        expectedMode?: Mode;
    } = JSON.parse(readFileSync(admissionFile, "utf8"));
    const root = realpathSync(dirname(dataRoot));
    const ownerFile = join(root, "evaluation-owner.json");
    if (lstatSync(ownerFile).isSymbolicLink() || !lstatSync(ownerFile).isFile())
        throw new Error("Control metadata owner marker must be a regular file");
    const owner: { owner: string } = JSON.parse(
        readFileSync(ownerFile, "utf8"),
    );
    if (
        root !== realpathSync(admission.ownedRoot) ||
        owner.owner !== admission.owner ||
        typeof owner.owner !== "string" ||
        !isAbsolute(admission.configPath) ||
        !contained(root, admission.configPath) ||
        !/^[a-z-]+$/u.test(component)
    )
        throw new Error("Control metadata admission ownership mismatch");
    if (
        admission.expectedMode !== undefined &&
        !["direct", "mcp", "dev", "bypass"].includes(admission.expectedMode)
    )
        throw new Error("Control metadata admission mode is invalid");
    return { admission, root, owner };
}

function ownedConfigReadable(root: string, configPath: string): boolean {
    const configDir = dirname(configPath);
    return (
        contained(root, configPath) &&
        existsSync(configDir) &&
        !lstatSync(configDir).isSymbolicLink() &&
        contained(root, realpathSync(configDir)) &&
        (!existsSync(configPath) ||
            (!lstatSync(configPath).isSymbolicLink() &&
                lstatSync(configPath).isFile()))
    );
}

/** Opt-in, non-secret control receipt. Never reads a config outside its fresh admitted owner root. */
export function publishControlMetadata(
    component: string,
    request?: ControlRequest,
): ControlMetadata | undefined {
    const dataRoot = process.env.TYPEAGENT_USER_DATA_DIR;
    if (!dataRoot || !isAbsolute(dataRoot)) return undefined;
    const admissionFile = join(dataRoot, "native-control-admission.json");
    if (!existsSync(admissionFile)) return undefined;
    const { admission, root, owner } = admittedOwner(
        dataRoot,
        admissionFile,
        component,
    );
    const configPath = resolve(getConfigPath());
    const readable = ownedConfigReadable(root, configPath);
    const config = readable ? readConfig() : undefined;
    const envMode = process.env.TYPEAGENT_MODE;
    const environmentMode =
        envMode === "direct" ||
        envMode === "mcp" ||
        envMode === "dev" ||
        envMode === "bypass";
    const effectiveMode = readable || environmentMode ? getMode() : null;
    const sourceMode = environmentMode
        ? "TYPEAGENT_MODE"
        : !readable
          ? "unowned-unread"
          : ["direct", "mcp", "dev", "bypass"].includes(config?.mode ?? "")
            ? "config"
            : "default";
    const metadata: ControlMetadata = {
        effectiveMode,
        configPath,
        dataRoot: realpathSync(dataRoot),
        source: {
            component,
            pid: process.pid,
            parentPid: process.ppid,
            executable: process.execPath,
            cwd: process.cwd(),
            owner: owner.owner,
            instance: process.env.INSTANCE_NAME ?? null,
            server:
                process.env.TYPEAGENT_HOST && process.env.TYPEAGENT_PORT
                    ? `ws://${process.env.TYPEAGENT_HOST}:${process.env.TYPEAGENT_PORT}`
                    : null,
            observedAt: new Date().toISOString(),
            config:
                process.env.TYPEAGENT_PLUGIN_DATA !== undefined
                    ? "TYPEAGENT_PLUGIN_DATA"
                    : process.env.CLAUDE_PLUGIN_DATA !== undefined
                      ? "CLAUDE_PLUGIN_DATA"
                      : "default",
            mode: sourceMode,
            routing: readable ? getMcpRouting() : null,
            expectedConfigPath: admission.configPath,
            expectedMode: admission.expectedMode ?? null,
            readableOwnedConfig: readable,
            request: publicRequest(request),
        },
        digest: readable
            ? createHash("sha256")
                  .update(
                      JSON.stringify({
                          configPath,
                          dataRoot: realpathSync(dataRoot),
                          effectiveMode,
                          mcpRouting: getMcpRouting(),
                      }),
                  )
                  .digest("hex")
            : null,
    };
    const directory = join(dataRoot, "native-control");
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink())
        throw new Error("Control metadata output must not be a symlink");
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${component}-${process.pid}.json`);
    const pending = `${file}.pending`;
    writeFileSync(pending, `${JSON.stringify(metadata)}\n`, { flag: "wx" });
    renameSync(pending, file);
    return metadata;
}

export function assertControlBinding(
    control: ControlMetadata | undefined,
): void {
    if (!control) return;
    if (
        !control.source.readableOwnedConfig ||
        control.configPath !== control.source.expectedConfigPath
    )
        throw new Error(
            "Native control config binding mismatch; no translation admitted",
        );
    if (
        control.source.expectedMode !== null &&
        control.effectiveMode !== control.source.expectedMode
    )
        throw new Error(
            "Native control mode mismatch; no translation admitted",
        );
}

export function readControlledMode(
    component: string,
    request?: ControlRequest,
): Mode {
    const control = publishControlMetadata(component, request);
    assertControlBinding(control);
    return control?.effectiveMode ?? getMode();
}

export function controlDiagnosticEnabled(
    control: ControlMetadata | undefined,
): boolean {
    if (!control) return false;
    return (
        JSON.parse(
            readFileSync(
                join(control.dataRoot, "native-control-admission.json"),
                "utf8",
            ),
        ).diagnosticTransitions === true
    );
}

export function monitorControlMetadata(component: string): void {
    const control = publishControlMetadata(component);
    assertControlBinding(control);
    if (!control || !controlDiagnosticEnabled(control)) return;
    watchFile(control.configPath, { interval: 200, persistent: false }, () => {
        try {
            publishControlMetadata(component);
        } catch (error) {
            console.error(
                `[control] ${error instanceof Error ? error.message : "Metadata refresh failed"}`,
            );
        }
    });
}
