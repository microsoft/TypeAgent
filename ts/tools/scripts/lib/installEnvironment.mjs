// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function parseRegistry(npmrcContent) {
    for (const line of npmrcContent.split(/\r?\n/)) {
        const match = line.match(/^\s*registry\s*=\s*(\S+)/);
        if (match) return match[1];
    }
    return undefined;
}

export function nativeInstallEnvironment(npmrcContent, env = process.env) {
    const result = { ...env };
    if (result.FOUNDRY_LOCAL_NUGET_FEEDS !== undefined) return result;
    const registry =
        env.npm_config_registry ??
        env.NPM_CONFIG_REGISTRY ??
        parseRegistry(npmrcContent);
    if (!registry) return result;
    const expanded = registry.replace(/\$\{([^}]+)\}/g, (_match, name) => {
        if (!env[name])
            throw new Error(
                `The npm registry references an unset environment variable: ${name}`,
            );
        return env[name];
    });
    let url;
    try {
        url = new URL(expanded);
    } catch {
        throw new Error("The configured npm registry is not a valid URL");
    }
    if (
        url.hostname !== "pkgs.dev.azure.com" &&
        !/^[^.]+\.pkgs\.visualstudio\.com$/i.test(url.hostname)
    )
        return result;
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/\/_packaging\/[^/]+\/npm(?:\/registry)?\/?$/.test(url.pathname)
    )
        throw new Error(
            "The Azure Artifacts npm registry must be an HTTPS feed URL without embedded credentials, query parameters or a fragment",
        );
    url.pathname = url.pathname.replace(
        /\/npm(?:\/registry)?\/?$/,
        "/nuget/v3/index.json",
    );
    result.FOUNDRY_LOCAL_NUGET_FEEDS = url.href;
    result.FOUNDRY_LOCAL_NUGET_MODE ??= "dotnet";
    return result;
}
