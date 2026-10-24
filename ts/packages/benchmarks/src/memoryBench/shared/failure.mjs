// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function safeFailure(error) {
    const message = error?.message ?? "";
    const allowed = [
        "Source synopsis requires configured model request constraints",
        "Configured informational view capability is disabled",
        "Configured roles require a separate verified coordinator handoff",
        "Invalid synopsis output object",
        "Invalid synopsis output fields or bounds",
        "Invalid synopsis evidence",
        "Synopsis evidence is not an exact supplied retained UTF-16 range",
        "Synopsis evidence is ambiguous without an exact supplied range",
        "Synopsis requires original retained evidence",
        "Synopsis composition dropped a supplied governing qualification or contrast",
        "Source synopsis requires configured provider output capacity for uncapped requests",
        "Configured synopsis request capacity cannot fit bounded structural input",
        "Configured synopsis capacity cannot compose adjacent summaries without truncation",
    ];
    return {
        name: error?.name ?? "Error",
        category: allowed.includes(message)
            ? message
            : /401|403|credential|authentication/i.test(message)
              ? "CONFIGURED_AUTHENTICATION_FAILURE"
              : /429|throttl/i.test(message)
                ? "CONFIGURED_PROVIDER_THROTTLE"
                : /endpoint|deployment|settings|configuration|config|provider/i.test(
                        message,
                    )
                  ? "CONFIGURED_ROLE_OR_TRANSPORT_UNAVAILABLE"
                  : /timeout|abort/i.test(message)
                    ? "BOUNDED_OPERATION_CANCELLED"
                    : "UNEXPECTED_FAILURE",
        rawProviderMessageSuppressed: true,
        ownedHarnessFrames: [
            ...(error?.stack ?? "").matchAll(
                /(live-(?:stages|qualification)\.mjs:\d+:\d+)/g,
            ),
        ].map((match) => match[1]),
    };
}
