// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const hash = (value) => createHash("sha256").update(value).digest("hex");

const roles = new AsyncLocalStorage();

export function observedRoles(model, prefix, receipt) {
    return Object.fromEntries(
        Object.entries(model).map(([name, value]) => [
            name,
            typeof value !== "function" || name === "fits"
                ? value
                : async function (...args) {
                      const started = performance.now();
                      return roles.run(`${prefix}.${name}`, async () => {
                          try {
                              const result = await Reflect.apply(
                                  value,
                                  model,
                                  args,
                              );
                              receipt.roleCalls.push({
                                  role: `${prefix}.${name}`,
                                  milliseconds: performance.now() - started,
                                  outcome: "RETURNED",
                              });
                              return result;
                          } catch (error) {
                              receipt.roleCalls.push({
                                  role: `${prefix}.${name}`,
                                  milliseconds: performance.now() - started,
                                  outcome: "FAILED",
                              });
                              throw error;
                          }
                      });
                  },
        ]),
    );
}

export async function liveDependencyCheckpoint(root) {
    const result = {};
    const visit = async (relative) => {
        for (const entry of await readdir(path.join(root, relative), {
            withFileTypes: true,
        })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (entry.name.endsWith(".js"))
                result[next] = hash(await readFile(path.join(root, next)));
        }
    };
    for (const directory of ["aiclient", "config"])
        await visit(path.join("packages", directory, "dist"));
    return result;
}

export function observeProvider(
    events,
    currentRole = () => "production-default",
) {
    const original = globalThis.fetch;
    globalThis.fetch = async function (...args) {
        const input = args[0];
        const url = new URL(
            typeof input === "string" ? input : (input.url ?? input.href),
        );
        const started = performance.now();
        const role = roles.getStore() ?? currentRole();
        const request =
            typeof args[1]?.body === "string"
                ? JSON.parse(args[1].body)
                : undefined;
        const response = await Reflect.apply(original, this, args);
        const item = {
            role,
            type: /\/chat\/completions$/.test(url.pathname)
                ? "chat"
                : "other-production-request",
            status: response.status,
            observedAt: new Date().toISOString(),
            durationMs: performance.now() - started,
            retryAfter: response.headers.get("retry-after"),
            serializedRequestCharacters:
                typeof args[1]?.body === "string"
                    ? args[1].body.length
                    : undefined,
            requestedOutputTokens:
                request?.max_completion_tokens ?? request?.max_tokens,
            requestedTools: request?.tools?.length ?? 0,
        };
        if (response.headers.get("content-type")?.includes("json")) {
            const body = await response.clone().json();
            if (response.ok) {
                item.model = body.model;
                item.usage = body.usage;
                if (Array.isArray(body.choices))
                    item.completionChoices = body.choices.map((choice) => ({
                        finishReason:
                            typeof choice?.finish_reason === "string"
                                ? choice.finish_reason
                                : undefined,
                        contentCharacters:
                            typeof choice?.message?.content === "string"
                                ? choice.message.content.length
                                : null,
                        refusalPresent: Boolean(choice?.message?.refusal),
                        toolCallCount: choice?.message?.tool_calls?.length ?? 0,
                    }));
            } else {
                item.errorCode = body.error?.code;
                item.errorType = body.error?.type;
                item.errorParameter = body.error?.param;
            }
        }
        events.push(item);
        return response;
    };
    return () => {
        globalThis.fetch = original;
    };
}
