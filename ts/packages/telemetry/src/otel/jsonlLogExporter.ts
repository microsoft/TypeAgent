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

export interface JsonlLogExporterOptions {
    readonly filePath: string;
    readonly serviceName: string;
    readonly processName?: string;
    readonly pid?: number;
    readonly maxPendingRecords?: number;
    readonly diagnostic?: (message: string, error?: unknown) => void;
}

const activePaths = new Set<string>();
const DEFAULT_MAX_PENDING_RECORDS = 2_048;
const DIAGNOSTIC_INTERVAL_MS = 60_000;

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
        if (activePaths.has(this.filePath)) {
            throw new Error(
                `A JSONL log exporter already owns "${this.filePath}" in this process.`,
            );
        }
        activePaths.add(this.filePath);
        this.diagnostic = options.diagnostic ?? writeDiagnostic;
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
                activePaths.delete(this.filePath);
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
): string {
    if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("JSONL pid must be a positive integer.");
    }
    const service = sanitizePathSegment(serviceName);
    const processRole = sanitizePathSegment(processName);
    const hadPidPlaceholder = template.includes("{pid}");
    const hadProcessPlaceholder = template.includes("{process}");
    if (!hadProcessPlaceholder && hadPidPlaceholder) {
        template = template.replaceAll("{pid}", "{process}-{pid}");
    }
    let resolved = template
        .replaceAll("{service}", service)
        .replaceAll("{process}", processRole)
        .replaceAll("{pid}", String(pid));
    if (!hadPidPlaceholder) {
        const parsed = path.parse(resolved);
        resolved = path.join(
            parsed.dir,
            `${parsed.name}${hadProcessPlaceholder ? "" : `-${processRole}`}-${pid}${parsed.ext || ".jsonl"}`,
        );
    }
    return path.resolve(resolved);
}

function sanitizePathSegment(value: string): string {
    const sanitized = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .slice(0, 64);
    return sanitized || "typeagent";
}

function serializeLogRecord(record: ReadableLogRecord): string {
    const serialized = JSON.stringify({
        timestamp: hrTimeToIso(record.hrTime),
        observedTimestamp: hrTimeToIso(record.hrTimeObserved),
        severityText: record.severityText,
        severityNumber: record.severityNumber,
        body: record.body,
        resource: record.resource.attributes,
        eventName: record.eventName,
        traceId: record.spanContext?.traceId,
        spanId: record.spanContext?.spanId,
        traceFlags: record.spanContext?.traceFlags,
        attributes: record.attributes,
        instrumentationScope: {
            name: record.instrumentationScope.name,
            version: record.instrumentationScope.version,
            attributes: record.instrumentationScope.attributes,
        },
        droppedAttributesCount: record.droppedAttributesCount,
    });
    return `${serialized}\n`;
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
