// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
    acceptVisualStudioClientHello,
    acceptVisualStudioDiscoveryRequest,
    createVisualStudioReplayCache,
    createVisualStudioSecureFrame,
    getVisualStudioBridgeCredentialPath,
    verifyVisualStudioSecureFrame,
    verifyVisualStudioServerHello,
    VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV,
    type VisualStudioBridgeCredential,
    type VisualStudioClientHello,
    type VisualStudioDiscoveryRequestAuth,
    type VisualStudioDiscoveryResponseAuth,
    type VisualStudioSecureFrame,
    type VisualStudioServerHello,
} from "@typeagent/websocket-utils/visualStudioBridgeAuth";

type InteropRequest = {
    credential: {
        version: 1;
        credentialId: string;
        secret: string;
    };
    now: number;
    fallbackCredentialPath: string;
    canonicalOverrideInput: string;
    canonicalOverridePath: string;
    discovery: {
        agentName: string;
        role: string;
        auth: VisualStudioDiscoveryRequestAuth;
    };
    clientHello: VisualStudioClientHello;
};

type InteropResponse = {
    discoveryResponse: {
        port: number;
        url: string;
        auth: VisualStudioDiscoveryResponseAuth;
    };
    serverHello: VisualStudioServerHello;
    requestFrame: VisualStudioSecureFrame;
};

async function readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function getCredential(request: InteropRequest): VisualStudioBridgeCredential {
    return {
        version: 1,
        credentialId: request.credential.credentialId,
        secret: Buffer.from(request.credential.secret, "hex"),
    };
}

function verifyFallbackPath(request: InteropRequest): void {
    const originalOverride =
        process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
    const originalGeneral = process.env["TYPEAGENT_USER_DATA_DIR"];
    try {
        delete process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        process.env["TYPEAGENT_USER_DATA_DIR"] = path.join(
            process.cwd(),
            "typescript-only-user-data",
        );
        const actual = getVisualStudioBridgeCredentialPath();
        const matches =
            process.platform === "win32"
                ? actual.toLowerCase() ===
                  request.fallbackCredentialPath.toLowerCase()
                : actual === request.fallbackCredentialPath;
        if (!matches) {
            throw new Error(
                `Credential fallback mismatch: TypeScript=${actual}, C#=${request.fallbackCredentialPath}`,
            );
        }
        process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] =
            request.canonicalOverrideInput;
        const canonicalOverride = getVisualStudioBridgeCredentialPath();
        const overrideMatches =
            process.platform === "win32"
                ? canonicalOverride.toLowerCase() ===
                  request.canonicalOverridePath.toLowerCase()
                : canonicalOverride === request.canonicalOverridePath;
        if (!overrideMatches) {
            throw new Error(
                `Credential override mismatch: TypeScript=${canonicalOverride}, C#=${request.canonicalOverridePath}`,
            );
        }
    } finally {
        if (originalOverride === undefined) {
            delete process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV];
        } else {
            process.env[VISUAL_STUDIO_BRIDGE_CREDENTIAL_PATH_ENV] =
                originalOverride;
        }
        if (originalGeneral === undefined) {
            delete process.env["TYPEAGENT_USER_DATA_DIR"];
        } else {
            process.env["TYPEAGENT_USER_DATA_DIR"] = originalGeneral;
        }
    }
}

async function respond(
    requestPath: string,
    responsePath: string,
): Promise<void> {
    const request = await readJson<InteropRequest>(requestPath);
    const credential = getCredential(request);
    verifyFallbackPath(request);

    const discoveryResponse = {
        port: 43123,
        url: "ws://127.0.0.1:43123",
    };
    const discoveryAuth = acceptVisualStudioDiscoveryRequest(
        credential,
        request.discovery,
        discoveryResponse,
        createVisualStudioReplayCache(),
        request.now,
    );
    if (discoveryAuth === undefined) {
        throw new Error("TypeScript rejected the C# discovery request");
    }

    const session = acceptVisualStudioClientHello(
        credential,
        request.clientHello,
        createVisualStudioReplayCache(),
        request.now,
    );
    if (session === undefined) {
        throw new Error("TypeScript rejected the C# client hello");
    }
    const requestId = "0123456789abcdef0123456789abcdef";
    const response: InteropResponse = {
        discoveryResponse: {
            ...discoveryResponse,
            auth: discoveryAuth,
        },
        serverHello: session.hello,
        requestFrame: createVisualStudioSecureFrame(
            session.hello.sessionId,
            1,
            "request",
            requestId,
            {
                actionName: "getActiveFile",
                parameters: { source: "typescript" },
            },
            session.keys.serverToClient,
        ),
    };
    await fs.writeFile(responsePath, JSON.stringify(response, null, 2), "utf8");
}

async function verify(
    requestPath: string,
    responsePath: string,
    finalPath: string,
): Promise<void> {
    const request = await readJson<InteropRequest>(requestPath);
    const response = await readJson<InteropResponse>(responsePath);
    const final = await readJson<{ responseFrame: VisualStudioSecureFrame }>(
        finalPath,
    );
    const verifiedHello = verifyVisualStudioServerHello(
        getCredential(request),
        request.clientHello,
        response.serverHello,
        request.now,
    );
    if (verifiedHello === undefined) {
        throw new Error("TypeScript rejected its serialized server hello");
    }
    const verifiedFrame = verifyVisualStudioSecureFrame<{
        id: string;
        success: boolean;
        result: { source: string };
    }>(
        final.responseFrame,
        verifiedHello.hello.sessionId,
        1,
        "response",
        verifiedHello.keys.clientToServer,
        request.now,
        verifiedHello.hello.expiresAt,
    );
    if (
        verifiedFrame === undefined ||
        !verifiedFrame.payload.success ||
        verifiedFrame.payload.result.source !== "csharp"
    ) {
        throw new Error("TypeScript rejected the C# response frame");
    }
}

const [command, ...args] = process.argv.slice(2);
if (command === "respond" && args.length === 2) {
    await respond(args[0], args[1]);
} else if (command === "verify" && args.length === 3) {
    await verify(args[0], args[1], args[2]);
} else {
    throw new Error(
        "Usage: visualStudioBridgeInterop.js respond <request> <response> | verify <request> <response> <final>",
    );
}
