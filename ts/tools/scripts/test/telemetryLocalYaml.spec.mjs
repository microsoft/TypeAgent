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

    const result = enableTelemetryLocal(file);

    assert.equal(result.changed, true);
    assert.equal(result.previouslyEnabled, false);
    const written = fs.readFileSync(file, "utf8");
    const parsed = yaml.load(written);
    assert.deepEqual(parsed.telemetry.local, {
        enabled: "true",
        otlpEndpoint: LOCAL_DEFAULTS.otlpEndpoint,
        logFile: LOCAL_DEFAULTS.logFile,
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

    enableTelemetryLocal(file);

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

    enableTelemetryLocal(file);

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

test("enable preserves user-customized local values instead of overwriting them", () => {
    const initial = [
        "telemetry:",
        "  local:",
        '    enabled: "false"',
        "    otlpEndpoint: http://my-lgtm:4318",
        "    debugBridge: false",
        "",
    ].join("\n");
    const file = makeTempFile(initial);

    const result = enableTelemetryLocal(file);

    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.telemetry.local.enabled, "true");
    // Custom values kept.
    assert.equal(parsed.telemetry.local.otlpEndpoint, "http://my-lgtm:4318");
    assert.equal(parsed.telemetry.local.debugBridge, "false");
    // Missing defaults filled in.
    assert.equal(parsed.telemetry.local.logFile, LOCAL_DEFAULTS.logFile);
    assert.equal(parsed.telemetry.local.structuredLogs, "true");
    assert.equal(result.previouslyEnabled, false);
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
    const first = enableTelemetryLocal(file);
    assert.equal(first.changed, true);
    const contents = fs.readFileSync(file, "utf8");
    const mtimeBefore = fs.statSync(file).mtimeMs;

    const second = enableTelemetryLocal(file);
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(file, "utf8"), contents);
    // File was not touched.
    assert.equal(fs.statSync(file).mtimeMs, mtimeBefore);
});

test("rejects flow-style telemetry.local instead of corrupting the document", () => {
    const file = makeTempFile('telemetry: { local: { enabled: "true" } }\n');
    assert.throws(
        () => enableTelemetryLocal(file),
        /telemetry:.*must open a block mapping/,
    );
});

test("rejects telemetry as a sequence", () => {
    const file = makeTempFile("telemetry:\n  - not: a-map\n");
    assert.throws(() => enableTelemetryLocal(file), /telemetry must be a map/);
});

test("rejects telemetry.local as a sequence", () => {
    const file = makeTempFile("telemetry:\n  local:\n    - enabled: true\n");
    assert.throws(
        () => enableTelemetryLocal(file),
        /telemetry\.local must be a map/,
    );
});

test("rejects invalid YAML", () => {
    const file = makeTempFile("telemetry: local: broken:\n  bad\n");
    assert.throws(() => enableTelemetryLocal(file), /Failed to parse/);
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

    enableTelemetryLocal(file);

    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.telemetry.local.customExperimental, "hello");
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

    enableTelemetryLocal(file);

    const written = fs.readFileSync(file, "utf8");
    assert.ok(written.includes('enabled: "true" # managed toggle'));
    assert.ok(written.includes("# Keep this local explanation."));
    assert.ok(
        written.includes("otlpEndpoint: http://my-lgtm:4318 # custom tunnel"),
    );
    assert.ok(written.includes("  # Production backend."));
    assert.equal(
        yaml.load(written).telemetry.otlpEndpoint,
        "https://backend.example",
    );
});
