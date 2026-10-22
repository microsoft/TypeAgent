// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const VISUAL_STUDIO_AGENT_NAME = "visualStudio";
export const VISUAL_STUDIO_AGENT_ROLE = "default";
export const VISUAL_STUDIO_BRIDGE_AUTH_VERSION = 1;
export const VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV =
    "TYPEAGENT_VS_BRIDGE_CREDENTIAL_PATH";

// Discovery and handshake proofs are short-lived; verification also limits the
// sender-selected window and allows only a small amount of clock skew.
const AUTH_WINDOW_MS = 15_000;
const MAX_AUTH_WINDOW_MS = 30_000;
const CLOCK_SKEW_MS = 5_000;
const SESSION_LIFETIME_MS = 10 * 60_000;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[0-9a-f]{32}$/;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const PROOF_PATTERN = /^[0-9a-f]{64}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;

export type VisualStudioBridgeCredential = {
    version: 1;
    credentialId: string;
    secret: Buffer;
};

export type VisualStudioDiscoveryRequestAuth = {
    version: 1;
    credentialId: string;
    nonce: string;
    issuedAt: number;
    expiresAt: number;
    proof: string;
};

export type VisualStudioDiscoveryResponseAuth = {
    version: 1;
    credentialId: string;
    requestNonce: string;
    serverNonce: string;
    issuedAt: number;
    expiresAt: number;
    proof: string;
};

export type VisualStudioClientHello = {
    type: "clientHello";
    version: 1;
    credentialId: string;
    clientInstanceId: string;
    clientNonce: string;
    issuedAt: number;
    expiresAt: number;
    proof: string;
};

export type VisualStudioServerHello = {
    type: "serverHello";
    version: 1;
    credentialId: string;
    clientNonce: string;
    serverNonce: string;
    sessionId: string;
    issuedAt: number;
    expiresAt: number;
    proof: string;
};

export type VisualStudioSecureFrame = {
    type: "secureFrame";
    version: 1;
    sessionId: string;
    sequence: number;
    kind: "request" | "response";
    id: string;
    payload: string;
    proof: string;
};

export type VisualStudioSessionKeys = {
    clientToServer: Buffer;
    serverToClient: Buffer;
};

export type VisualStudioServerSession = {
    hello: VisualStudioServerHello;
    keys: VisualStudioSessionKeys;
    clientInstanceId: string;
};

type StoredCredential = {
    version: 1;
    credentialId: string;
    secret: string;
};

export type VisualStudioDiscoveryRequest = {
    agentName: string;
    role?: string;
    auth?: VisualStudioDiscoveryRequestAuth;
};

export type VisualStudioDiscoveryResponse = {
    port: number | null;
    url?: string;
};

const credentialPromises = new Map<
    string,
    Promise<VisualStudioBridgeCredential>
>();

class ReplayCache {
    private readonly entries = new Map<string, number>();

    consume(key: string, expiresAt: number, now: number): boolean {
        for (const [entry, expiry] of this.entries) {
            if (expiry < now - CLOCK_SKEW_MS) {
                this.entries.delete(entry);
            }
        }
        if (this.entries.has(key)) {
            return false;
        }
        this.entries.set(key, expiresAt);
        return true;
    }
}

const discoveryReplayCache = new ReplayCache();

export function getVisualStudioBridgeCredentialPath(): string {
    const override = process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
    if (override !== undefined) {
        return canonicalizeCredentialPathOverride(override);
    }
    return path.resolve(
        os.homedir(),
        ".typeagent",
        "visual-studio",
        "bridge-credential.json",
    );
}

function canonicalizeCredentialPathOverride(value: string): string {
    if (
        value.length === 0 ||
        value.trim() !== value ||
        value.includes("\0") ||
        !path.isAbsolute(value) ||
        (process.platform === "win32" && !isFullyQualifiedWindowsPath(value))
    ) {
        throw new Error(
            `${VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV} must be a canonicalizable absolute path without surrounding whitespace`,
        );
    }
    return path.resolve(value);
}

function isFullyQualifiedWindowsPath(value: string): boolean {
    return (
        /^[a-zA-Z]:[\\/]/.test(value) ||
        value.startsWith("\\\\") ||
        value.startsWith("//")
    );
}

export function clearVisualStudioBridgeCredentialCacheForTests(): void {
    credentialPromises.clear();
}

export function loadOrCreateVisualStudioBridgeCredential(): Promise<VisualStudioBridgeCredential> {
    const credentialPath = getVisualStudioBridgeCredentialPath();
    let promise = credentialPromises.get(credentialPath);
    if (promise === undefined) {
        promise = loadOrCreateCredential(credentialPath);
        credentialPromises.set(credentialPath, promise);
        promise.catch(() => credentialPromises.delete(credentialPath));
    }
    return promise;
}

async function loadOrCreateCredential(
    credentialPath: string,
): Promise<VisualStudioBridgeCredential> {
    const directory = path.dirname(credentialPath);
    await ensurePrivateDirectory(directory);
    try {
        await fs.lstat(credentialPath);
    } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
            throw error;
        }
        return createCredential(credentialPath, directory);
    }
    return readCredential(credentialPath);
}

async function createCredential(
    credentialPath: string,
    directory: string,
): Promise<VisualStudioBridgeCredential> {
    const secret = randomBytes(32);
    const credentialId = deriveCredentialId(secret);
    const stored: StoredCredential = {
        version: 1,
        credentialId,
        secret: secret.toString("hex"),
    };
    const temporaryPath = path.join(
        directory,
        `.bridge-credential-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
    );
    const handle = await fs.open(temporaryPath, "wx", 0o600);
    try {
        await handle.writeFile(JSON.stringify(stored), "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }

    try {
        await secureCreatedPath(directory, temporaryPath);
        try {
            await fs.link(temporaryPath, credentialPath);
        } catch (error) {
            if (!isNodeError(error, "EEXIST")) {
                throw error;
            }
        }
    } finally {
        await fs.rm(temporaryPath, { force: true });
    }

    return readCredential(credentialPath);
}

async function readCredential(
    credentialPath: string,
): Promise<VisualStudioBridgeCredential> {
    await validatePrivatePath(path.dirname(credentialPath), credentialPath);
    const raw = await fs.readFile(credentialPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredCredential>;
    if (
        parsed.version !== VISUAL_STUDIO_BRIDGE_AUTH_VERSION ||
        typeof parsed.credentialId !== "string" ||
        !ID_PATTERN.test(parsed.credentialId) ||
        typeof parsed.secret !== "string" ||
        !SECRET_PATTERN.test(parsed.secret)
    ) {
        throw new Error("Visual Studio bridge credential is malformed");
    }
    const secret = Buffer.from(parsed.secret, "hex");
    if (
        !constantTimeEqualText(parsed.credentialId, deriveCredentialId(secret))
    ) {
        throw new Error("Visual Studio bridge credential identifier mismatch");
    }
    return {
        version: 1,
        credentialId: parsed.credentialId,
        secret,
    };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
    let created = false;
    try {
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(
                "Visual Studio bridge credential directory is not a normal directory",
            );
        }
    } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
            throw error;
        }
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        created = true;
    }

    if (process.platform === "win32") {
        if (created) {
            await runWindowsAclScript("secure-directory", directory);
        }
        await runWindowsAclScript("validate-directory", directory);
        return;
    }

    if (created) {
        await fs.chmod(directory, 0o700);
    }
    await validatePosixPath(directory, true);
}

async function secureCreatedPath(
    directory: string,
    filePath: string,
): Promise<void> {
    if (process.platform === "win32") {
        await runWindowsAclScript("secure-file", directory, filePath);
    } else {
        await fs.chmod(filePath, 0o600);
    }
}

async function validatePrivatePath(
    directory: string,
    filePath: string,
): Promise<void> {
    if (process.platform === "win32") {
        await runWindowsAclScript("validate-directory", directory);
        await runWindowsAclScript("validate-file", directory, filePath);
        return;
    }
    await validatePosixPath(directory, true);
    await validatePosixPath(filePath, false);
}

async function validatePosixPath(
    targetPath: string,
    directory: boolean,
): Promise<void> {
    const stat = await fs.lstat(targetPath);
    if (
        stat.isSymbolicLink() ||
        (directory ? !stat.isDirectory() : !stat.isFile())
    ) {
        throw new Error("Visual Studio bridge credential path is unsafe");
    }
    if ((stat.mode & 0o077) !== 0) {
        throw new Error(
            "Visual Studio bridge credential permissions are too broad",
        );
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error("Visual Studio bridge credential owner is invalid");
    }
}

const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = "Stop"
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
    $null
)

function Set-PrivateDirectoryAcl([string] $target) {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($currentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($target, $acl)
}

function Set-PrivateFileAcl([string] $target) {
    $acl = [System.Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner($currentSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    [System.IO.File]::SetAccessControl($target, $acl)
}

function Assert-PrivateAcl([string] $target, [bool] $directory) {
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Credential path must not be a reparse point"
    }
    if ($directory -and -not $item.PSIsContainer) {
        throw "Credential directory is not a directory"
    }
    if (-not $directory -and $item.PSIsContainer) {
        throw "Credential file is not a file"
    }
    $sections = [System.Security.AccessControl.AccessControlSections]"Owner, Access"
    if ($directory) {
        $acl = [System.IO.Directory]::GetAccessControl($target, $sections)
    } else {
        $acl = [System.IO.File]::GetAccessControl($target, $sections)
    }
    $ownerSid = $acl.GetOwner(
        [System.Security.Principal.SecurityIdentifier]
    )
    if ($ownerSid -ne $currentSid) {
        throw "Credential path owner is not the current user"
    }
    if (-not $acl.AreAccessRulesProtected) {
        throw "Credential path inherits access rules"
    }
    $seenCurrent = $false
    $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
        $sid = [System.Security.Principal.SecurityIdentifier]$rule.IdentityReference
        if ($rule.IsInherited) {
            throw "Credential path has inherited access rules"
        }
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
            throw "Credential path has a deny rule"
        }
        if ($sid -ne $currentSid -and $sid -ne $systemSid) {
            throw "Credential path grants another principal access"
        }
        if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
            throw "Credential path rule is not FullControl"
        }
        if ($sid -eq $currentSid) {
            $seenCurrent = $true
        }
    }
    if (-not $seenCurrent) {
        throw "Credential path does not grant the current user access"
    }
}

switch ($env:TYPEAGENT_VS_ACL_OPERATION) {
    "secure-directory" { Set-PrivateDirectoryAcl $env:TYPEAGENT_VS_ACL_DIRECTORY }
    "secure-file" { Set-PrivateFileAcl $env:TYPEAGENT_VS_ACL_FILE }
    "validate-directory" { Assert-PrivateAcl $env:TYPEAGENT_VS_ACL_DIRECTORY $true }
    "validate-file" { Assert-PrivateAcl $env:TYPEAGENT_VS_ACL_FILE $false }
    default { throw "Unknown ACL operation" }
}
`;

async function runWindowsAclScript(
    operation: string,
    directory: string,
    filePath?: string,
): Promise<void> {
    const executable = path.join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    );
    const encodedCommand = Buffer.from(WINDOWS_ACL_SCRIPT, "utf16le").toString(
        "base64",
    );
    await new Promise<void>((resolve, reject) => {
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
                env: {
                    ...process.env,
                    TYPEAGENT_VS_ACL_OPERATION: operation,
                    TYPEAGENT_VS_ACL_DIRECTORY: directory,
                    ...(filePath === undefined
                        ? {}
                        : { TYPEAGENT_VS_ACL_FILE: filePath }),
                },
                windowsHide: true,
            },
            (error) => {
                if (error) {
                    reject(
                        new Error(
                            `Visual Studio bridge credential ACL validation failed: ${error.message}`,
                        ),
                    );
                } else {
                    resolve();
                }
            },
        );
    });
}

export function createVisualStudioDiscoveryRequestAuth(
    credential: VisualStudioBridgeCredential,
    agentName: string,
    role: string | undefined,
    now: number = Date.now(),
): VisualStudioDiscoveryRequestAuth {
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = now + AUTH_WINDOW_MS;
    return {
        version: 1,
        credentialId: credential.credentialId,
        nonce,
        issuedAt: now,
        expiresAt,
        proof: createProof(
            credential.secret,
            "typeagent-vs-discovery-request-v1",
            agentName,
            normalizeRole(agentName, role),
            credential.credentialId,
            nonce,
            String(now),
            String(expiresAt),
        ),
    };
}

export async function protectVisualStudioDiscoveryResponse(
    request: VisualStudioDiscoveryRequest,
    response: VisualStudioDiscoveryResponse,
    now: number = Date.now(),
): Promise<VisualStudioDiscoveryResponseAuth | undefined> {
    if (!isProtectedVisualStudioTuple(request.agentName, request.role)) {
        return undefined;
    }
    const credential = await loadOrCreateVisualStudioBridgeCredential();
    const accepted = acceptVisualStudioDiscoveryRequest(
        credential,
        request,
        response,
        discoveryReplayCache,
        now,
    );
    if (accepted === undefined) {
        throw new Error("Discovery authentication failed");
    }
    return accepted;
}

export function acceptVisualStudioDiscoveryRequest(
    credential: VisualStudioBridgeCredential,
    request: VisualStudioDiscoveryRequest,
    response: VisualStudioDiscoveryResponse,
    replayCache: {
        consume: (key: string, expiresAt: number, now: number) => boolean;
    },
    now: number = Date.now(),
): VisualStudioDiscoveryResponseAuth | undefined {
    const auth = request.auth;
    if (
        !isProtectedVisualStudioTuple(request.agentName, request.role) ||
        auth === undefined ||
        !verifyDiscoveryRequest(credential, request, auth, now) ||
        !replayCache.consume(
            `${auth.credentialId}:${auth.nonce}`,
            auth.expiresAt,
            now,
        )
    ) {
        return undefined;
    }
    const serverNonce = randomBytes(32).toString("hex");
    const expiresAt = now + AUTH_WINDOW_MS;
    return {
        version: 1,
        credentialId: credential.credentialId,
        requestNonce: auth.nonce,
        serverNonce,
        issuedAt: now,
        expiresAt,
        proof: createProof(
            credential.secret,
            "typeagent-vs-discovery-response-v1",
            request.agentName,
            normalizeRole(request.agentName, request.role),
            credential.credentialId,
            auth.nonce,
            serverNonce,
            String(now),
            String(expiresAt),
            response.port === null ? "null" : String(response.port),
            response.url ?? "",
        ),
    };
}

export function verifyVisualStudioDiscoveryResponse(
    credential: VisualStudioBridgeCredential,
    request: {
        agentName: string;
        role?: string;
        auth: VisualStudioDiscoveryRequestAuth;
    },
    response: VisualStudioDiscoveryResponse & {
        auth?: VisualStudioDiscoveryResponseAuth;
    },
    now: number = Date.now(),
): boolean {
    const auth = response.auth;
    if (
        auth === undefined ||
        auth.version !== VISUAL_STUDIO_BRIDGE_AUTH_VERSION ||
        !constantTimeEqualText(auth.credentialId, credential.credentialId) ||
        !constantTimeEqualText(auth.requestNonce, request.auth.nonce) ||
        !NONCE_PATTERN.test(auth.serverNonce) ||
        !SESSION_ID_PATTERN.test(auth.credentialId) ||
        !PROOF_PATTERN.test(auth.proof) ||
        !isFresh(auth.issuedAt, auth.expiresAt, now)
    ) {
        return false;
    }
    const expected = createProof(
        credential.secret,
        "typeagent-vs-discovery-response-v1",
        request.agentName,
        normalizeRole(request.agentName, request.role),
        credential.credentialId,
        request.auth.nonce,
        auth.serverNonce,
        String(auth.issuedAt),
        String(auth.expiresAt),
        response.port === null ? "null" : String(response.port),
        response.url ?? "",
    );
    return constantTimeEqualText(auth.proof, expected);
}

function verifyDiscoveryRequest(
    credential: VisualStudioBridgeCredential,
    request: VisualStudioDiscoveryRequest,
    auth: VisualStudioDiscoveryRequestAuth,
    now: number,
): boolean {
    if (
        auth.version !== VISUAL_STUDIO_BRIDGE_AUTH_VERSION ||
        !constantTimeEqualText(auth.credentialId, credential.credentialId) ||
        !NONCE_PATTERN.test(auth.nonce) ||
        !PROOF_PATTERN.test(auth.proof) ||
        !isFresh(auth.issuedAt, auth.expiresAt, now)
    ) {
        return false;
    }
    const expected = createProof(
        credential.secret,
        "typeagent-vs-discovery-request-v1",
        request.agentName,
        normalizeRole(request.agentName, request.role),
        credential.credentialId,
        auth.nonce,
        String(auth.issuedAt),
        String(auth.expiresAt),
    );
    return constantTimeEqualText(auth.proof, expected);
}

export function createVisualStudioClientHello(
    credential: VisualStudioBridgeCredential,
    clientInstanceId: string,
    now: number = Date.now(),
): VisualStudioClientHello {
    const clientNonce = randomBytes(32).toString("hex");
    const expiresAt = now + AUTH_WINDOW_MS;
    return {
        type: "clientHello",
        version: 1,
        credentialId: credential.credentialId,
        clientInstanceId,
        clientNonce,
        issuedAt: now,
        expiresAt,
        proof: createProof(
            credential.secret,
            "typeagent-vs-client-hello-v1",
            credential.credentialId,
            clientInstanceId,
            clientNonce,
            String(now),
            String(expiresAt),
        ),
    };
}

export function acceptVisualStudioClientHello(
    credential: VisualStudioBridgeCredential,
    value: unknown,
    replayCache: {
        consume: (key: string, expiresAt: number, now: number) => boolean;
    },
    now: number = Date.now(),
): VisualStudioServerSession | undefined {
    if (!isClientHello(value)) {
        return undefined;
    }
    const expected = createProof(
        credential.secret,
        "typeagent-vs-client-hello-v1",
        credential.credentialId,
        value.clientInstanceId,
        value.clientNonce,
        String(value.issuedAt),
        String(value.expiresAt),
    );
    if (
        !constantTimeEqualText(value.credentialId, credential.credentialId) ||
        !isFresh(value.issuedAt, value.expiresAt, now) ||
        !constantTimeEqualText(value.proof, expected) ||
        !replayCache.consume(
            `${value.credentialId}:${value.clientNonce}`,
            value.expiresAt,
            now,
        )
    ) {
        return undefined;
    }

    const serverNonce = randomBytes(32).toString("hex");
    const sessionId = randomBytes(16).toString("hex");
    const expiresAt = now + SESSION_LIFETIME_MS;
    const hello: VisualStudioServerHello = {
        type: "serverHello",
        version: 1,
        credentialId: credential.credentialId,
        clientNonce: value.clientNonce,
        serverNonce,
        sessionId,
        issuedAt: now,
        expiresAt,
        proof: createProof(
            credential.secret,
            "typeagent-vs-server-hello-v1",
            credential.credentialId,
            value.clientInstanceId,
            value.clientNonce,
            serverNonce,
            sessionId,
            String(now),
            String(expiresAt),
        ),
    };
    return {
        hello,
        keys: deriveSessionKeys(
            credential,
            value.clientInstanceId,
            value.clientNonce,
            serverNonce,
            sessionId,
        ),
        clientInstanceId: value.clientInstanceId,
    };
}

export function verifyVisualStudioServerHello(
    credential: VisualStudioBridgeCredential,
    clientHello: VisualStudioClientHello,
    value: unknown,
    now: number = Date.now(),
):
    | { hello: VisualStudioServerHello; keys: VisualStudioSessionKeys }
    | undefined {
    if (
        !isServerHello(value) ||
        !constantTimeEqualText(value.credentialId, credential.credentialId) ||
        !constantTimeEqualText(value.clientNonce, clientHello.clientNonce) ||
        !isFresh(value.issuedAt, value.expiresAt, now, SESSION_LIFETIME_MS)
    ) {
        return undefined;
    }
    const expected = createProof(
        credential.secret,
        "typeagent-vs-server-hello-v1",
        credential.credentialId,
        clientHello.clientInstanceId,
        clientHello.clientNonce,
        value.serverNonce,
        value.sessionId,
        String(value.issuedAt),
        String(value.expiresAt),
    );
    if (!constantTimeEqualText(value.proof, expected)) {
        return undefined;
    }
    return {
        hello: value,
        keys: deriveSessionKeys(
            credential,
            clientHello.clientInstanceId,
            clientHello.clientNonce,
            value.serverNonce,
            value.sessionId,
        ),
    };
}

export function createVisualStudioSecureFrame(
    sessionId: string,
    sequence: number,
    kind: "request" | "response",
    id: string,
    payload: unknown,
    key: Buffer,
): VisualStudioSecureFrame {
    const encodedPayload = Buffer.from(
        JSON.stringify(payload),
        "utf8",
    ).toString("base64");
    return {
        type: "secureFrame",
        version: 1,
        sessionId,
        sequence,
        kind,
        id,
        payload: encodedPayload,
        proof: createProof(
            key,
            "typeagent-vs-secure-frame-v1",
            sessionId,
            String(sequence),
            kind,
            id,
            encodedPayload,
        ),
    };
}

export function verifyVisualStudioSecureFrame<T>(
    value: unknown,
    sessionId: string,
    expectedSequence: number,
    expectedKind: "request" | "response",
    key: Buffer,
    now: number,
    sessionExpiresAt: number,
): { frame: VisualStudioSecureFrame; payload: T } | undefined {
    if (
        !isSecureFrame(value) ||
        now > sessionExpiresAt ||
        !constantTimeEqualText(value.sessionId, sessionId) ||
        value.sequence !== expectedSequence ||
        value.kind !== expectedKind
    ) {
        return undefined;
    }
    const expected = createProof(
        key,
        "typeagent-vs-secure-frame-v1",
        sessionId,
        String(value.sequence),
        value.kind,
        value.id,
        value.payload,
    );
    if (!constantTimeEqualText(value.proof, expected)) {
        return undefined;
    }
    try {
        return {
            frame: value,
            payload: JSON.parse(
                Buffer.from(value.payload, "base64").toString("utf8"),
            ) as T,
        };
    } catch {
        return undefined;
    }
}

export function createVisualStudioReplayCache(): {
    consume: (key: string, expiresAt: number, now: number) => boolean;
} {
    return new ReplayCache();
}

export function createVisualStudioRequestId(): string {
    return randomBytes(16).toString("hex");
}

function deriveSessionKeys(
    credential: VisualStudioBridgeCredential,
    clientInstanceId: string,
    clientNonce: string,
    serverNonce: string,
    sessionId: string,
): VisualStudioSessionKeys {
    const fields = [
        credential.credentialId,
        clientInstanceId,
        clientNonce,
        serverNonce,
        sessionId,
    ];
    // Direction-specific domain labels prevent request MACs from being
    // reflected and accepted as responses.
    return {
        clientToServer: createMac(
            credential.secret,
            "typeagent-vs-session-client-to-server-v1",
            ...fields,
        ),
        serverToClient: createMac(
            credential.secret,
            "typeagent-vs-session-server-to-client-v1",
            ...fields,
        ),
    };
}

function isProtectedVisualStudioTuple(
    agentName: string,
    role: string | undefined,
): boolean {
    return (
        agentName === VISUAL_STUDIO_AGENT_NAME &&
        (role === undefined || role === VISUAL_STUDIO_AGENT_ROLE)
    );
}

function normalizeRole(agentName: string, role: string | undefined): string {
    // Discovery historically permits an omitted Visual Studio role. Authenticate
    // that spelling as the canonical "default" tuple in both runtimes.
    return agentName === VISUAL_STUDIO_AGENT_NAME && role === undefined
        ? VISUAL_STUDIO_AGENT_ROLE
        : (role ?? "");
}

function isFresh(
    issuedAt: number,
    expiresAt: number,
    now: number,
    maxWindow: number = MAX_AUTH_WINDOW_MS,
): boolean {
    return (
        Number.isSafeInteger(issuedAt) &&
        Number.isSafeInteger(expiresAt) &&
        expiresAt > issuedAt &&
        expiresAt - issuedAt <= maxWindow &&
        issuedAt <= now + CLOCK_SKEW_MS &&
        expiresAt >= now - CLOCK_SKEW_MS
    );
}

function isClientHello(value: unknown): value is VisualStudioClientHello {
    if (!isRecord(value)) return false;
    return (
        value["type"] === "clientHello" &&
        value["version"] === VISUAL_STUDIO_BRIDGE_AUTH_VERSION &&
        typeof value["credentialId"] === "string" &&
        ID_PATTERN.test(value["credentialId"]) &&
        typeof value["clientInstanceId"] === "string" &&
        ID_PATTERN.test(value["clientInstanceId"]) &&
        typeof value["clientNonce"] === "string" &&
        NONCE_PATTERN.test(value["clientNonce"]) &&
        typeof value["issuedAt"] === "number" &&
        typeof value["expiresAt"] === "number" &&
        typeof value["proof"] === "string" &&
        PROOF_PATTERN.test(value["proof"])
    );
}

function isServerHello(value: unknown): value is VisualStudioServerHello {
    if (!isRecord(value)) return false;
    return (
        value["type"] === "serverHello" &&
        value["version"] === VISUAL_STUDIO_BRIDGE_AUTH_VERSION &&
        typeof value["credentialId"] === "string" &&
        ID_PATTERN.test(value["credentialId"]) &&
        typeof value["clientNonce"] === "string" &&
        NONCE_PATTERN.test(value["clientNonce"]) &&
        typeof value["serverNonce"] === "string" &&
        NONCE_PATTERN.test(value["serverNonce"]) &&
        typeof value["sessionId"] === "string" &&
        SESSION_ID_PATTERN.test(value["sessionId"]) &&
        typeof value["issuedAt"] === "number" &&
        typeof value["expiresAt"] === "number" &&
        typeof value["proof"] === "string" &&
        PROOF_PATTERN.test(value["proof"])
    );
}

function isSecureFrame(value: unknown): value is VisualStudioSecureFrame {
    if (!isRecord(value)) return false;
    return (
        value["type"] === "secureFrame" &&
        value["version"] === VISUAL_STUDIO_BRIDGE_AUTH_VERSION &&
        typeof value["sessionId"] === "string" &&
        SESSION_ID_PATTERN.test(value["sessionId"]) &&
        typeof value["sequence"] === "number" &&
        Number.isSafeInteger(value["sequence"]) &&
        value["sequence"] > 0 &&
        (value["kind"] === "request" || value["kind"] === "response") &&
        typeof value["id"] === "string" &&
        ID_PATTERN.test(value["id"]) &&
        typeof value["payload"] === "string" &&
        typeof value["proof"] === "string" &&
        PROOF_PATTERN.test(value["proof"])
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deriveCredentialId(secret: Buffer): string {
    return createHash("sha256").update(secret).digest("hex").slice(0, 32);
}

function createProof(key: Buffer, domain: string, ...fields: string[]): string {
    return createMac(key, domain, ...fields).toString("hex");
}

function createMac(key: Buffer, domain: string, ...fields: string[]): Buffer {
    // Cross-runtime canonical encoding: UTF-8 domain label followed by each
    // ordered field prefixed with LF. Domain labels separate protocol phases.
    const hmac = createHmac("sha256", key);
    hmac.update(domain, "utf8");
    for (const field of fields) {
        hmac.update("\n", "utf8");
        hmac.update(field, "utf8");
    }
    return hmac.digest();
}

function constantTimeEqualText(left: string, right: string): boolean {
    // timingSafeEqual requires equal lengths; all authenticated fields have
    // fixed formats, so a length mismatch is rejected before comparison.
    const leftBytes = Buffer.from(left, "utf8");
    const rightBytes = Buffer.from(right, "utf8");
    return (
        leftBytes.length === rightBytes.length &&
        timingSafeEqual(leftBytes, rightBytes)
    );
}

function isNodeError(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === code
    );
}
