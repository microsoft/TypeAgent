// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function uint8ArrayToBase64(buffer: ArrayBuffer): string {
    return Buffer.from(buffer).toString("base64");
}

export function base64ToUint8Array(base64: string): Uint8Array {
    return Buffer.from(base64, "base64");
}
