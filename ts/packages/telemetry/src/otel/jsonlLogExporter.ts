// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type {
    LogRecordExporter,
    ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { TYPEAGENT_SPAN_ATTRIBUTES } from "./traceContract.js";

export interface JsonlLogExporterOptions {
    readonly filePath: string;
    readonly serviceName: string;
    readonly processName?: string;
    readonly pid?: number;
    readonly startedAt?: Date;
    readonly maxPendingRecords?: number;
    readonly diagnostic?: (message: string, error?: unknown) => void;
}

const activePaths = new Set<string>();
const DEFAULT_MAX_PENDING_RECORDS = 2_048;
const DIAGNOSTIC_INTERVAL_MS = 60_000;

/**
 * Return the stable identity used for in-process JSONL path ownership.
 * Windows paths are case-insensitive, so ownership checks must be as well.
 */
export function getJsonlLogPathIdentity(
    filePath: string,
    caseInsensitive = process.platform === "win32",
): string {
    const resolved = path.resolve(filePath);
    return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/**
 * Read-only view of every normalized file-path identity currently owned by a live
 * {@link JsonlLogExporter} in this process. Cleanup (`logRetention.ts`)
 * uses this to protect concurrently-open exporter files from deletion.
 * The set is snapshotted by the caller — do not mutate it.
 *
 * `activePaths` protects against *in-process* re-ownership only. Cross-
 * process protection is best-effort: retention runs `unlink` and treats
 * an `EBUSY`/`EPERM`/other failure as a diagnostic-and-skip. On Windows
 * the filesystem itself typically refuses to delete a file another
 * process still has open, so peer processes' live logs are normally
 * left in place; on POSIX the peer's fd stays valid after unlink and
 * the file is only reaped when every handle is closed. Neither offers
 * a hard cross-process guarantee.
 */
export function getActiveJsonlLogPaths(): ReadonlySet<string> {
    return activePaths;
}

export class JsonlLogExporter implements LogRecordExporter {
    public readonly filePath: string;
    private readonly maxPendingRecords: number;
    private readonly diagnostic: (message: string, error?: unknown) => void;
    private tail: Promise<void> = Promise.resolve();
    private destination: Promise<fs.FileHandle> | undefined;
    private pendingRecords = 0;
    private droppedRecords = 0;
    private stopped = false;
    private lastDiagnosticAt = 0;

    constructor(options: JsonlLogExporterOptions) {
        this.filePath = resolveJsonlLogPath(
            options.filePath,
            options.serviceName,
            options.pid,
            options.processName,
            options.startedAt,
        );
        this.maxPendingRecords =
            options.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS;
        if (
            !Number.isInteger(this.maxPendingRecords) ||
            this.maxPendingRecords <= 0
        ) {
            throw new Error(
                "JSONL maxPendingRecords must be a positive integer.",
            );
        }
        const pathIdentity = getJsonlLogPathIdentity(this.filePath);
        if (activePaths.has(pathIdentity)) {
            throw new Error(
                `A JSONL log exporter already owns "${this.filePath}" in this process.`,
            );
        }
        this.diagnostic = options.diagnostic ?? writeDiagnostic;
        activePaths.add(pathIdentity);
        this.reportDiagnostic(`OpenTelemetry JSONL logs: ${this.filePath}`);
    }

    public export(
        records: ReadableLogRecord[],
        resultCallback: (result: ExportResult) => void,
    ): void {
        if (this.stopped) {
            resultCallback({
                code: ExportResultCode.FAILED,
                error: new Error("JSONL log exporter is shut down."),
            });
            return;
        }

        const capacity = Math.max(
            0,
            this.maxPendingRecords - this.pendingRecords,
        );
        const accepted = records.slice(0, capacity);
        const dropped = records.length - accepted.length;
        if (dropped > 0) {
            this.droppedRecords += dropped;
            this.reportRateLimited(
                `OpenTelemetry JSONL queue full; dropped ${dropped} record(s), ${this.droppedRecords} total.`,
            );
        }
        if (accepted.length === 0) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        let content: string;
        try {
            content = accepted.map(serializeLogRecord).join("");
        } catch (error) {
            this.droppedRecords += accepted.length;
            this.reportRateLimited(
                `OpenTelemetry JSONL serialization failed; dropped ${accepted.length} record(s).`,
                error,
            );
            resultCallback({
                code: ExportResultCode.FAILED,
                error: asError(error),
            });
            return;
        }

        this.pendingRecords += accepted.length;
        const operation = this.tail.then(async () => {
            const file = await (this.destination ??= this.openDestination());
            await file.appendFile(content, "utf8");
        });
        this.tail = operation.catch(() => undefined);
        void operation
            .then(
                () => resultCallback({ code: ExportResultCode.SUCCESS }),
                (error) => {
                    this.droppedRecords += accepted.length;
                    this.reportRateLimited(
                        `OpenTelemetry JSONL write failed; dropped ${accepted.length} record(s).`,
                        error,
                    );
                    resultCallback({
                        code: ExportResultCode.FAILED,
                        error: asError(error),
                    });
                },
            )
            .finally(() => {
                this.pendingRecords -= accepted.length;
            });
    }

    public forceFlush(): Promise<void> {
        return this.tail;
    }

    public async shutdown(): Promise<void> {
        if (this.stopped) {
            await this.tail;
            return;
        }
        this.stopped = true;
        try {
            await this.tail;
        } finally {
            try {
                const file = await this.destination?.catch(() => undefined);
                await file?.close();
            } finally {
                activePaths.delete(getJsonlLogPathIdentity(this.filePath));
            }
        }
    }

    public getDroppedRecordCount(): number {
        return this.droppedRecords;
    }

    private reportRateLimited(message: string, error?: unknown): void {
        const now = Date.now();
        if (now - this.lastDiagnosticAt < DIAGNOSTIC_INTERVAL_MS) {
            return;
        }
        this.lastDiagnosticAt = now;
        this.reportDiagnostic(message, error);
    }

    private reportDiagnostic(message: string, error?: unknown): void {
        try {
            this.diagnostic(message, error);
        } catch {
            // Diagnostics must never affect exporter ownership or requests.
        }
    }

    private async openDestination(): Promise<fs.FileHandle> {
        const directory = path.dirname(this.filePath);
        const createdDirectory =
            (await fs.mkdir(directory, {
                recursive: true,
                mode: 0o700,
            })) !== undefined;
        const file = await fs.open(this.filePath, "a", 0o600);
        try {
            if (process.platform === "win32") {
                await setPrivateWindowsAcl(
                    directory,
                    this.filePath,
                    createdDirectory,
                );
            } else {
                await Promise.all([
                    ...(createdDirectory ? [fs.chmod(directory, 0o700)] : []),
                    file.chmod(0o600),
                ]);
            }
            return file;
        } catch (error) {
            await file.close();
            throw error;
        }
    }
}

const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = "Stop"
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User

if ($env:TYPEAGENT_SECURE_LOG_DIRECTORY -eq "true") {
    $directoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
    $directoryAcl.SetOwner($identity)
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $directoryAcl.AddAccessRule($directoryRule)
    [System.IO.Directory]::SetAccessControl(
        $env:TYPEAGENT_LOG_DIRECTORY,
        $directoryAcl
    )
}

$fileAcl = [System.Security.AccessControl.FileSecurity]::new()
$fileAcl.SetOwner($identity)
$fileAcl.SetAccessRuleProtection($true, $false)
$fileRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow
)
$fileAcl.AddAccessRule($fileRule)
[System.IO.File]::SetAccessControl($env:TYPEAGENT_LOG_FILE, $fileAcl)
`;

function setPrivateWindowsAcl(
    directory: string,
    filePath: string,
    secureDirectory: boolean,
): Promise<void> {
    const executable = path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    );
    const encodedCommand = Buffer.from(WINDOWS_ACL_SCRIPT, "utf16le").toString(
        "base64",
    );
    return new Promise((resolve, reject) => {
        execFile(
            executable,
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                encodedCommand,
            ],
            {
                windowsHide: true,
                env: {
                    ...process.env,
                    TYPEAGENT_LOG_DIRECTORY: directory,
                    TYPEAGENT_LOG_FILE: filePath,
                    TYPEAGENT_SECURE_LOG_DIRECTORY: String(secureDirectory),
                },
            },
            (error) => {
                if (error === null) {
                    resolve();
                } else {
                    reject(error);
                }
            },
        );
    });
}

export function resolveJsonlLogPath(
    template: string,
    serviceName: string,
    pid = process.pid,
    processName = "process",
    startedAt = new Date(),
): string {
    if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("JSONL pid must be a positive integer.");
    }
    if (Number.isNaN(startedAt.getTime())) {
        throw new Error("JSONL start timestamp must be a valid date.");
    }
    const service = sanitizePathSegment(serviceName);
    const processRole = sanitizePathSegment(processName);
    const timestamp = formatFileTimestamp(startedAt);
    const hadPidPlaceholder = template.includes("{pid}");
    const hadProcessPlaceholder = template.includes("{process}");
    let hadTimestampPlaceholder = template.includes("{timestamp}");
    if (!hadProcessPlaceholder && hadPidPlaceholder) {
        template = template.replaceAll(
            "{pid}",
            `{process}${hadTimestampPlaceholder ? "" : "-{timestamp}"}-{pid}`,
        );
        hadTimestampPlaceholder = true;
    }
    let resolved = template
        .replaceAll("{service}", service)
        .replaceAll("{process}", processRole)
        .replaceAll("{timestamp}", timestamp)
        .replaceAll("{pid}", String(pid));
    if (!hadPidPlaceholder || !hadTimestampPlaceholder) {
        const parsed = path.parse(resolved);
        resolved = path.join(
            parsed.dir,
            `${parsed.name}${hadProcessPlaceholder ? "" : `-${processRole}`}${hadTimestampPlaceholder ? "" : `-${timestamp}`}${hadPidPlaceholder ? "" : `-${pid}`}${parsed.ext || ".jsonl"}`,
        );
    }
    return path.resolve(resolved);
}

function formatFileTimestamp(value: Date): string {
    return value
        .toISOString()
        .replaceAll("-", "")
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/, "Z");
}

function sanitizePathSegment(value: string): string {
    const sanitized = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .slice(0, 64);
    return sanitized || "typeagent";
}

function serializeLogRecord(record: ReadableLogRecord): string {
    const attributes = { ...record.attributes };
    const sessionId = takeStringAttribute(
        attributes,
        TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID,
    );
    const activationId = takeStringAttribute(
        attributes,
        TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID,
    );
    const requestId = takeStringAttribute(
        attributes,
        TYPEAGENT_SPAN_ATTRIBUTES.REQUEST_ID,
    );
    const correlationId = takeStringAttribute(
        attributes,
        TYPEAGENT_SPAN_ATTRIBUTES.TRACE_ID,
    );
    const namespace = takeStringAttribute(attributes, "debug.namespace");
    const spanContext = record.spanContext;
    const { body, message } = takeBodyMessage(record.body);
    const serialized = JSON.stringify({
        timestamp: hrTimeToIso(record.hrTime),
        ...(record.severityText === undefined
            ? {}
            : { severity: record.severityText }),
        ...(record.eventName === undefined ? {} : { event: record.eventName }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(activationId === undefined ? {} : { activationId }),
        ...(requestId === undefined ? {} : { requestId }),
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(spanContext === undefined
            ? {}
            : {
                  traceId: spanContext.traceId,
                  spanId: spanContext.spanId,
              }),
        ...(namespace === undefined ? {} : { namespace }),
        ...(message === undefined ? {} : { message }),
        body,
        ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
    });
    return `${serialized}\n`;
}

function takeBodyMessage(body: unknown): {
    body: unknown;
    message: string | undefined;
} {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return { body, message: undefined };
    }
    const source = body as Record<string, unknown>;
    if (typeof source.message !== "string") {
        return { body, message: undefined };
    }
    const {
        message,
        sessionId: _sessionId,
        activationId: _activationId,
        requestId: _requestId,
        traceId: _traceId,
        ...rest
    } = source;
    return { body: rest, message };
}

function takeStringAttribute(
    attributes: Record<string, unknown>,
    name: string,
): string | undefined {
    const value = attributes[name];
    if (typeof value !== "string") {
        return undefined;
    }
    delete attributes[name];
    return value;
}

function hrTimeToIso([seconds, nanos]: readonly [number, number]): string {
    return new Date(seconds * 1_000 + nanos / 1_000_000).toISOString();
}

function writeDiagnostic(message: string, error?: unknown): void {
    const suffix = error === undefined ? "" : ` ${asError(error).message}`;
    process.stderr.write(`[typeagent:telemetry] ${message}${suffix}\n`);
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
