// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function translatedRequestMatchesIngress(
    translatedRequest: unknown,
    ingress: string,
): boolean {
    return (
        typeof translatedRequest === "string" &&
        (translatedRequest === ingress ||
            translatedRequest === ingress.replaceAll("\r\n", "\n"))
    );
}
