// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

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

test("MSI defaults to AI Systems and rejects unsupported provider values", () => {
    assert.match(
        wxs,
        /<Property Id="PROVIDER" Value="AISYSTEMS" Secure="yes" \/>/,
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
            "provision --provider COPILOT --embedding LOCAL --force",
        ),
    );
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
                "-UserDataDir &quot;[UserProfileFolder].typeagent&quot;",
            ),
        );
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
    assert.ok(prereqs.includes("-UserDataDir"));
    assert.ok(prereqs.includes("-RuntimeRoot"));
});
