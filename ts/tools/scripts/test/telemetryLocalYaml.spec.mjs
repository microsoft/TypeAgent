// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
    disableTelemetryLocal,
    enableTelemetryLocal,
    LOCAL_DEFAULTS,
} from "../lib/telemetryLocalYaml.mjs";

function makeTempFile(initial) {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "typeagent-telemetry-local-"),
    );
    const file = path.join(dir, "config.local.yaml");
    if (initial !== undefined) {
        fs.writeFileSync(file, initial, "utf8");
    }
    return file;
}

test("enable creates a fresh block when the file does not exist", () => {
    const file = makeTempFile(undefined);
    fs.rmSync(file, { force: true });

    const result = enableTelemetryLocal(file, "http://127.0.0.1:54321");

    assert.equal(result.changed, true);
    assert.equal(result.previouslyEnabled, false);
    const written = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(written);
    assert.deepEqual(parsed.telemetry.local, {
        enabled: "true",
        otlpEndpoint: "http://127.0.0.1:54321",
        logFile: LOCAL_DEFAULTS.logFile,
        logRetentionBytes: LOCAL_DEFAULTS.logRetentionBytes,
        debugBridge: "true",
        structuredLogs: "true",
    });
    // Enabled must round-trip as the string "true" — the flat env layer
    // drops YAML false booleans, so we intentionally use strings for this
    // one field.
    assert.ok(/enabled: "true"/.test(written));
});

test("enable preserves comments and unrelated sections when telemetry is absent", () => {
    const initial = [
        "# Top-of-file comment.",
        "azureOpenAI:",
        "  defaultAuth: identity # inline comment",
        "vault:",
        "  shared: aisystems",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    enableTelemetryLocal(file, "http://127.0.0.1:54321");

    const written = fs.readFileSync(file, "utf8");
    assert.ok(written.includes("# Top-of-file comment."));
    assert.ok(written.includes("defaultAuth: identity # inline comment"));
    assert.ok(written.includes("shared: aisystems"));
    assert.ok(written.includes("telemetry:"));
    assert.ok(written.includes("  local:"));
    const parsed = yaml.load(written);
    assert.equal(parsed.telemetry.local.enabled, "true");
    assert.equal(parsed.azureOpenAI.defaultAuth, "identity");
    assert.equal(parsed.vault.shared, "aisystems");
});

test("enable adds the local block under an existing telemetry section without touching siblings", () => {
    const initial = [
        "telemetry:",
        "  otlpEndpoint: http://existing:4318 # backend",
        "  # this comment belongs to telemetry",
        "vault:",
        "  shared: aisystems",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    enableTelemetryLocal(file, "http://127.0.0.1:54321");

    const written = fs.readFileSync(file, "utf8");
    assert.ok(
        written.includes("otlpEndpoint: http://existing:4318 # backend"),
        "must preserve the existing backend endpoint line verbatim",
    );
    assert.ok(
        written.includes("# this comment belongs to telemetry"),
        "must preserve the existing telemetry comment",
    );
    const parsed = yaml.load(written);
    assert.equal(parsed.telemetry.otlpEndpoint, "http://existing:4318");
    assert.equal(parsed.telemetry.local.enabled, "true");
});

test("enable overwrites a customized otlpEndpoint but preserves other customized values", () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "false"',
        "    otlpEndpoint: http://my-lgtm:4318",
        "    debugBridge: false",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    const result = enableTelemetryLocal(file, "http://127.0.0.1:54321");

    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.telemetry.local.enabled, "true");
    // startLocalTelemetry.mjs owns otlpEndpoint: Docker assigns the OTLP
    // host port dynamically on every start, so a stale/custom value must
    // not survive a toggle.
    assert.equal(parsed.telemetry.local.otlpEndpoint, "http://127.0.0.1:54321");
    // Unrelated customized values are still preserved.
    assert.equal(parsed.telemetry.local.debugBridge, "false");
    // Missing defaults filled in.
    assert.equal(parsed.telemetry.local.logFile, LOCAL_DEFAULTS.logFile);
    assert.equal(parsed.telemetry.local.structuredLogs, "true");
    assert.equal(result.previouslyEnabled, false);
});

test("enable requires a discovered otlpEndpoint instead of writing a broken config", () => {
    const file = makeTempFile(undefined);
    fs.rmSync(file, { force: true });

    assert.throws(
        () => enableTelemetryLocal(file),
        /otlpEndpoint must be a non-empty string/,
    );
    assert.equal(
        fs.existsSync(file),
        false,
        "must not create the file when validation fails",
    );
});

test('disable flips enabled to "false" and preserves all other local values', () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "true"',
        "    otlpEndpoint: http://my-lgtm:4318",
        "    logFile: ~/logs/x.jsonl",
        "    debugBridge: true",
        "    structuredLogs: true",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    const result = disableTelemetryLocal(file);

    assert.equal(result.changed, true);
    assert.equal(result.previouslyEnabled, true);
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.telemetry.local.enabled, "false");
    assert.equal(parsed.telemetry.local.otlpEndpoint, "http://my-lgtm:4318");
    assert.equal(parsed.telemetry.local.logFile, "~/logs/x.jsonl");
    assert.equal(parsed.telemetry.local.debugBridge, "true");
    assert.equal(parsed.telemetry.local.structuredLogs, "true");
});

test("second identical enable is a no-op that does not rewrite the file", () => {
    const file = makeTempFile("");
    const first = enableTelemetryLocal(file, "http://127.0.0.1:54321");
    assert.equal(first.changed, true);
    const contents = fs.readFileSync(file, "utf8");
    const mtimeBefore = fs.statSync(file).mtimeMs;

    const second = enableTelemetryLocal(file, "http://127.0.0.1:54321");
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(file, "utf8"), contents);
    // File was not touched.
    assert.equal(fs.statSync(file).mtimeMs, mtimeBefore);
});

test("rejects flow-style telemetry.local instead of corrupting the document", () => {
    const file = makeTempFile('telemetry: { local: { enabled: "true" } }\n');
    assert.throws(
        () => enableTelemetryLocal(file, "http://127.0.0.1:54321"),
        /telemetry:.*must open a block mapping/,
    );
});

test("rejects telemetry as a sequence", () => {
    const file = makeTempFile("telemetry:\n  - not: a-map\n");
    assert.throws(
        () => enableTelemetryLocal(file, "http://127.0.0.1:54321"),
        /telemetry must be a map/,
    );
});

test("rejects telemetry.local as a sequence", () => {
    const file = makeTempFile("telemetry:\n  local:\n    - enabled: true\n");
    assert.throws(
        () => enableTelemetryLocal(file, "http://127.0.0.1:54321"),
        /telemetry\.local must be a map/,
    );
});

test("rejects invalid YAML", () => {
    const file = makeTempFile("telemetry: local: broken:\n  bad\n");
    assert.throws(
        () => enableTelemetryLocal(file, "http://127.0.0.1:54321"),
        /Failed to parse/,
    );
});

test("enable preserves unrelated custom local keys", () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "false"',
        "    otlpEndpoint: http://my-lgtm:4318",
        "    customExperimental: hello",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    enableTelemetryLocal(file, "http://127.0.0.1:54321");

    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.telemetry.local.customExperimental, "hello");
});

test("enable preserves a custom logRetentionBytes value instead of overwriting it", () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "false"',
        "    logRetentionBytes: 12345",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    enableTelemetryLocal(file, "http://127.0.0.1:54321");

    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    // Custom retention value kept — this is a value key, not a toggle.
    assert.equal(parsed.telemetry.local.logRetentionBytes, 12345);
    assert.equal(parsed.telemetry.local.enabled, "true");
});

test("enable inserts the default logRetentionBytes as an unquoted YAML number", () => {
    const file = makeTempFile("");
    enableTelemetryLocal(file, "http://127.0.0.1:54321");
    const written = fs.readFileSync(file, "utf8");
    // The resolver's parseNonNegativeInteger rejects quoted numbers except
    // as plain decimal digits, but YAML numbers must not be quoted for
    // js-yaml to round-trip them as `number`.
    assert.ok(
        /logRetentionBytes:\s*524288000\s*$/m.test(written),
        `Expected unquoted logRetentionBytes: 524288000 in:\n${written}`,
    );
    const parsed = yaml.load(written);
    assert.equal(typeof parsed.telemetry.local.logRetentionBytes, "number");
    assert.equal(parsed.telemetry.local.logRetentionBytes, 524288000);
});

test("toggle preserves local comments and comments before the next sibling", () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "false" # managed toggle',
        "    # Keep this local explanation.",
        "    otlpEndpoint: http://my-lgtm:4318 # custom tunnel",
        "  # Production backend.",
        "  otlpEndpoint: https://backend.example",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    enableTelemetryLocal(file, "http://127.0.0.1:61234");

    const written = fs.readFileSync(file, "utf8");
    assert.ok(written.includes('enabled: "true" # managed toggle'));
    assert.ok(written.includes("# Keep this local explanation."));
    // otlpEndpoint's value is overwritten (this launcher owns it) but its
    // inline comment survives the rewrite.
    assert.ok(
        written.includes(
            "otlpEndpoint: http://127.0.0.1:61234 # custom tunnel",
        ),
    );
    assert.ok(written.includes("  # Production backend."));
    const parsed = yaml.load(written);
    assert.equal(parsed.telemetry.otlpEndpoint, "https://backend.example");
    assert.equal(parsed.telemetry.local.otlpEndpoint, "http://127.0.0.1:61234");
});
