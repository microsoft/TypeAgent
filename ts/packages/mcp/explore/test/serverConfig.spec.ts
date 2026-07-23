// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import {
    normalizeProviderBaseUrl,
    parseExploreServerOptions,
    resolveExploreApiKey,
} from "../src/serverConfig.js";

describe("explore server configuration", () => {
    it("parses the repository, model route, credential name, and telemetry path", () => {
        expect(
            parseExploreServerOptions(
                [
                    "--repo",
                    "./repo",
                    "--model=azure/gpt-5.6-luna",
                    "--base-url",
                    "http://localhost:4627/v1",
                    "--api-key-env=CUSTOM_PROVIDER_API_KEY",
                    "--max-tool-calls=8",
                    "--telemetry-file",
                    "./usage.json",
                ],
                {},
                "/workspace",
            ),
        ).toEqual({
            repoRoot: path.resolve("/workspace/repo"),
            model: "azure/gpt-5.6-luna",
            baseUrl: "http://localhost:4627/v1",
            apiKeyEnv: "CUSTOM_PROVIDER_API_KEY",
            maxToolCalls: 8,
            telemetryFile: path.resolve("/workspace/usage.json"),
        });
    });

    it("uses explicit TypeAgent environment fallbacks", () => {
        expect(
            parseExploreServerOptions(
                [],
                {
                    TYPEAGENT_EXPLORE_ROOT: "/repo",
                    TYPEAGENT_EXPLORE_MODEL: "azure/gpt-5.6-terra",
                    TYPEAGENT_EXPLORE_BASE_URL: "http://localhost:4627/v1/",
                    TYPEAGENT_EXPLORE_API_KEY_ENV: "LITELLM_KEY",
                    TYPEAGENT_EXPLORE_TELEMETRY_FILE: "/tmp/usage.json",
                },
                "/workspace",
            ),
        ).toEqual({
            repoRoot: "/repo",
            model: "azure/gpt-5.6-terra",
            baseUrl: "http://localhost:4627/v1",
            apiKeyEnv: "LITELLM_KEY",
            maxToolCalls: 8,
            telemetryFile: "/tmp/usage.json",
        });
    });

    it("enables both language servers with repeatable process arguments", () => {
        const options = parseExploreServerOptions(
            [
                "--model",
                "azure/gpt-5.6-luna",
                "--base-url",
                "http://localhost:4627/v1",
                "--enable-lsp",
                "--request-timeout-ms",
                "120000",
                "--python-lsp-command",
                "/tools/uvx",
                "--python-lsp-arg=--from",
                "--python-lsp-arg=python-lsp-server",
                "--python-lsp-arg=pylsp",
                "--typescript-lsp-command",
                "/tools/typescript-language-server",
                "--lsp-server-command",
                "gopls=/tools/gopls-custom",
                "--lsp-server-arg",
                "gopls=-remote=auto",
                "--disable-lsp-server",
                "eslint",
            ],
            {},
            "/workspace",
        );

        expect(options.lsp?.requestTimeoutMs).toBe(30_000);
        expect(
            options.lsp?.servers.find((server) => server.id === "pylsp")
                ?.command,
        ).toEqual({
                command: "/tools/uvx",
                args: ["--from", "python-lsp-server", "pylsp"],
        });
        expect(
            options.lsp?.servers.find((server) => server.id === "typescript")
                ?.command,
        ).toEqual({
                command: "/tools/typescript-language-server",
                args: ["--stdio"],
        });
        expect(options.lsp?.servers.length).toBeGreaterThan(30);
        expect(
            options.lsp?.servers.find((server) => server.id === "gopls")
                ?.command,
        ).toEqual({
            command: "/tools/gopls-custom",
            args: ["-remote=auto"],
        });
        expect(
            options.lsp?.servers.some((server) => server.id === "eslint"),
        ).toBe(false);
        expect(options.reasoningRequestTimeoutMs).toBe(120_000);
        expect(() =>
            parseExploreServerOptions(
                [
                    "--model",
                    "azure/gpt-5.6-luna",
                    "--base-url",
                    "http://localhost:4627/v1",
                    "--enable-lsp=true",
                ],
                {},
                "/workspace",
            ),
        ).toThrow(/does not accept a value/i);
        expect(() =>
            parseExploreServerOptions(
                [
                    "--model",
                    "azure/gpt-5.6-luna",
                    "--base-url",
                    "http://localhost:4627/v1",
                    "--request-timeout-ms",
                    "999",
                ],
                {},
                "/workspace",
            ),
        ).toThrow(/request-timeout-ms/i);
    });

    it("requires a model and base URL and rejects unknown arguments", () => {
        expect(() => parseExploreServerOptions([], {}, "/workspace")).toThrow(
            "--model",
        );
        expect(() =>
            parseExploreServerOptions(
                ["--model", "azure/gpt-5.6-sol"],
                {},
                "/workspace",
            ),
        ).toThrow("--base-url");
        expect(() =>
            parseExploreServerOptions(
                [
                    "--model",
                    "azure/gpt-5.6-sol",
                    "--base-url",
                    "http://localhost:4627/v1",
                    "--unknown",
                ],
                {},
                "/workspace",
            ),
        ).toThrow("Unknown argument");
        expect(() =>
            parseExploreServerOptions(
                [
                    "--model",
                    "azure/gpt-5.6-sol",
                    "--base-url",
                    "http://localhost:4627/v1",
                    "--max-tool-calls",
                    "0",
                ],
                {},
                "/workspace",
            ),
        ).toThrow("--max-tool-calls");
        expect(() =>
            parseExploreServerOptions(
                [
                    "--model",
                    "claude-sonnet-4.6",
                    "--base-url",
                    "http://localhost:4627/v1",
                ],
                {},
                "/workspace",
            ),
        ).toThrow(/luna.*terra.*sol/i);
    });

    it("keeps the provider base URL for the Responses BYOK transport", () => {
        expect(normalizeProviderBaseUrl("http://localhost:4627/v1/")).toBe(
            "http://localhost:4627/v1",
        );
        expect(() => normalizeProviderBaseUrl("file:///tmp/model")).toThrow(
            "http or https",
        );
    });

    it("resolves the named BYOK credential without changing process state", () => {
        expect(
            resolveExploreApiKey(
                { apiKeyEnv: "LITELLM_KEY" },
                { LITELLM_KEY: "secret" },
            ),
        ).toBe("secret");
        expect(() =>
            resolveExploreApiKey({ apiKeyEnv: "LITELLM_KEY" }, {}),
        ).toThrow("LITELLM_KEY");
    });
});
