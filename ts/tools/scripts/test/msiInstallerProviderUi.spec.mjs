// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadConfigSync } from "@typeagent/config";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const wxs = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "installers",
        "wix",
        "TypeAgent-AgentServer.wxs",
    ),
    "utf8",
);
const runServe = readFileSync(
    path.resolve(scriptsDir, "..", "..", "installers", "wix", "run-serve.ps1"),
    "utf8",
);
const installPrereqs = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "installers",
        "wix",
        "install-prereqs.ps1",
    ),
    "utf8",
);
const launchCopilotSetup = readFileSync(
    path.resolve(
        scriptsDir,
        "..",
        "..",
        "installers",
        "wix",
        "launch-copilot-setup.ps1",
    ),
    "utf8",
);

const providerRadio = wxs.match(
    /<Control Id="ProviderRadio"[\s\S]*?<\/Control>/,
)?.[0];

test("MSI labels the second page as Install Options", () => {
    assert.match(wxs, /Text="\{\\WixUI_Font_Title\}Install Options"/);
    assert.match(
        wxs,
        /Text="Choose the components to install and how TypeAgent connects to language models\."/,
    );
});

test("MSI provider selection is limited to AI Systems and GitHub Copilot", () => {
    assert.ok(providerRadio, "ProviderRadio control must exist");
    assert.match(providerRadio, /<RadioButton Value="AISYSTEMS"/);
    assert.match(providerRadio, /<RadioButton Value="COPILOT"/);
    assert.doesNotMatch(providerRadio, /<RadioButton Value="OLLAMA"/);
});

test("MSI defaults to GitHub Copilot and rejects unsupported provider values", () => {
    assert.match(
        wxs,
        /<Property Id="PROVIDER" Value="COPILOT" Secure="yes" \/>/,
    );
    assert.match(wxs, /PROVIDER="AISYSTEMS" OR PROVIDER="COPILOT"/);
    assert.match(wxs, /Ollama is not supported by this MSI/);
});

test("MSI no longer exposes embedding or Ollama host properties and controls", () => {
    assert.doesNotMatch(wxs, /<Property Id="EMBEDDING"/);
    assert.doesNotMatch(wxs, /<Property Id="OLLAMAHOST"/);
    assert.doesNotMatch(wxs, /<Control Id="EmbeddingLabel"/);
    assert.doesNotMatch(wxs, /<Control Id="EmbeddingRadio"/);
    assert.doesNotMatch(wxs, /<Control Id="OllamaHostLabel"/);
    assert.doesNotMatch(wxs, /<Control Id="OllamaHostEdit"/);
    assert.match(wxs, /NOT EMBEDDING AND NOT OLLAMAHOST/);
});

test("Copilot provisioning always uses local embeddings", () => {
    const command = wxs.match(
        /<SetProperty Id="ProvisionCopilotConfig"[\s\S]*?Value="([^"]*)"/,
    )?.[1];
    assert.ok(command, "ProvisionCopilotConfig command must exist");
    assert.ok(
        command.includes(
            "-ServeCommand provision --provider COPILOT --embedding LOCAL",
        ),
    );
    assert.ok(
        command.includes(
            "--local-embedding-cache-dir &quot;[LocalAppDataFolder]TypeAgent\\embedding-cache&quot;",
        ),
    );
    assert.ok(command.includes("--force"));
    assert.ok(command.includes("-FailOnError"));
    assert.ok(!command.includes("--ollama-host"));
    assert.match(
        wxs,
        /<CustomAction Id="ProvisionCopilotConfig"[\s\S]*?Return="check"/,
    );
});

test("provider-specific provisioning actions use exact provider gates", () => {
    assert.match(
        wxs,
        /<Custom Action="ProvisionCopilotConfig"[^>]*>\(NOT REMOVE~="ALL"\) AND \(PROVIDER="COPILOT"\)<\/Custom>/,
    );
    assert.match(
        wxs,
        /<Custom Action="ProvisionAiSystemsConfig"[^>]*>\(NOT REMOVE~="ALL"\) AND \(PROVIDER="AISYSTEMS"\)<\/Custom>/,
    );
});

test("MSI lifecycle actions pin user config and runtime directories", () => {
    const commands = [
        "ProvisionCopilotConfig",
        "ProvisionAiSystemsConfig",
        "StartAgentServer",
        "EnableAutostart",
        "DisableAutostart",
    ].map((id) => {
        const command = wxs.match(
            new RegExp(`<SetProperty Id="${id}"[\\s\\S]*?Value="([^"]*)"`),
        )?.[1];
        assert.ok(command, `${id} command must exist`);
        return command;
    });

    for (const command of commands) {
        assert.ok(
            command.includes(
                "-LocalAppDataDir &quot;[LocalAppDataFolder].&quot;",
            ),
        );
        assert.ok(!command.includes("[UserProfileFolder]"));
        assert.ok(
            command.includes(
                "-RuntimeRoot &quot;[LocalAppDataFolder]TypeAgent\\runtimes&quot;",
            ),
        );
    }

    const prereqs = wxs.match(
        /<SetProperty Id="InstallPrereqs"[\s\S]*?Value="([^"]*)"/,
    )?.[1];
    assert.ok(prereqs, "InstallPrereqs command must exist");
    assert.ok(
        prereqs.includes("-LocalAppDataDir &quot;[LocalAppDataFolder].&quot;"),
    );
    assert.ok(!prereqs.includes("[UserProfileFolder]"));
    assert.ok(prereqs.includes("-RuntimeRoot"));

    assert.doesNotMatch(wxs, /\[UserProfileFolder\]/);
    assert.match(wxs, /Id="StartAgentServer"[\s\S]*?-ServeCommand start/);
    assert.match(
        wxs,
        /Id="EnableAutostart"[\s\S]*?-ServeCommand autostart -ServeCommandArg enable/,
    );
    assert.match(
        wxs,
        /Id="DisableAutostart"[\s\S]*?-ServeCommand autostart -ServeCommandArg disable/,
    );
    for (const script of [runServe, installPrereqs, launchCopilotSetup]) {
        assert.match(script, /TYPEAGENT_COPILOT_RUNTIME_ROOT/);
        assert.doesNotMatch(script, /\$env:TYPEAGENT_RUNTIME_ROOT\s*=/);
    }
});

test(
    "run-serve preserves the named provision command through powershell -File",
    { skip: process.platform !== "win32" },
    () => {
        const tempDir = mkdtempSync(
            path.join(os.tmpdir(), "typeagent run-serve-"),
        );
        try {
            const argsPath = path.join(tempDir, "args.json");
            const fakeServePath = path.join(tempDir, "fake-serve.mjs");
            const localAppDataDir = path.join(
                tempDir,
                "profile",
                "AppData",
                "Local",
                ".",
            );
            writeFileSync(
                fakeServePath,
                `import fs from "node:fs"; fs.writeFileSync(process.env.TYPEAGENT_TEST_ARGS_PATH, JSON.stringify({ args: process.argv.slice(2), userDataDir: process.env.TYPEAGENT_USER_DATA_DIR }));`,
                "utf8",
            );

            const runServePath = path.resolve(
                scriptsDir,
                "..",
                "..",
                "installers",
                "wix",
                "run-serve.ps1",
            );
            const result = spawnSync(
                "powershell.exe",
                [
                    "-ExecutionPolicy",
                    "Bypass",
                    "-NoProfile",
                    "-NonInteractive",
                    "-File",
                    `"${runServePath}"`,
                    "-ServePath",
                    `"${fakeServePath}"`,
                    "-LocalAppDataDir",
                    `"${localAppDataDir}"`,
                    "-FailOnError",
                    "-ServeCommand",
                    "provision",
                    "--provider",
                    "COPILOT",
                    "--embedding",
                    "LOCAL",
                    "--force",
                ],
                {
                    encoding: "utf8",
                    env: {
                        ...process.env,
                        TYPEAGENT_TEST_ARGS_PATH: argsPath,
                    },
                    windowsVerbatimArguments: true,
                },
            );

            assert.equal(result.status, 0, result.stderr || result.stdout);
            const invocation = JSON.parse(readFileSync(argsPath, "utf8"));
            assert.deepEqual(invocation.args, [
                "provision",
                "--provider",
                "COPILOT",
                "--embedding",
                "LOCAL",
                "--force",
            ]);
            assert.equal(
                invocation.userDataDir,
                path.join(
                    realpathSync.native(tempDir),
                    "profile",
                    ".typeagent",
                ),
            );
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    },
);

test("generated Copilot config passes strict loading with local embeddings", () => {
    const tempDir = mkdtempSync(
        path.join(os.tmpdir(), "typeagent-copilot-config-"),
    );
    try {
        const configPath = path.join(tempDir, "config.local.yaml");
        const embeddingCacheDir = path.join(tempDir, "embedding-cache");
        const generatorPath = path.resolve(
            scriptsDir,
            "..",
            "generate-selfhost-config.mjs",
        );
        const result = spawnSync(
            process.execPath,
            [
                generatorPath,
                "--provider",
                "copilot",
                "--embedding",
                "local",
                "--local-embedding-cache-dir",
                embeddingCacheDir,
                "--out",
                configPath,
                "--force",
            ],
            { encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);

        const loaded = loadConfigSync({
            defaultsPath: path.join(tempDir, "missing-defaults.yaml"),
            localPath: configPath,
            dotEnvPath: path.join(tempDir, "missing.env"),
            populateProcessEnv: false,
            strict: true,
        });
        assert.equal(loaded.env.TYPEAGENT_MODEL_PROVIDER, "copilot");
        assert.equal(
            loaded.env.COPILOT_FALLBACK_MODELS,
            '["gpt-5.4-mini","gpt-5-mini","gpt-5.4"]',
        );
        assert.equal(loaded.env.TYPEAGENT_EMBEDDING_PROVIDER, "local");
        assert.equal(
            loaded.env.TYPEAGENT_EMBEDDING_MODEL,
            "Xenova/all-MiniLM-L6-v2",
        );
        assert.equal(
            loaded.env.TYPEAGENT_EMBEDDING_CACHE_DIR,
            embeddingCacheDir,
        );
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});
