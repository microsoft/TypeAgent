// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    configureShellTestModel,
    getShellTestModel,
} from "../shellTestModel.js";

const originalModel = process.env.TYPEAGENT_SHELL_TEST_MODEL;

afterEach(() => {
    if (originalModel === undefined)
        delete process.env.TYPEAGENT_SHELL_TEST_MODEL;
    else process.env.TYPEAGENT_SHELL_TEST_MODEL = originalModel;
});

test("unconfigured suites preserve product model selection", async () => {
    delete process.env.TYPEAGENT_SHELL_TEST_MODEL;
    const send = jest.fn<(request: string) => Promise<string>>();
    await configureShellTestModel(send);
    expect(getShellTestModel()).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
});

test("pins translation and explanation and reapplies after a session change", async () => {
    process.env.TYPEAGENT_SHELL_TEST_MODEL = " GPT_4_O ";
    const send = jest.fn(async (request: string) => {
        const kind = request.split(" ")[1];
        return `Model for ${kind} is set to GPT_4_O`;
    });
    await configureShellTestModel(send);
    await configureShellTestModel(send);
    expect(send.mock.calls).toEqual([
        ["@config translation model GPT_4_O"],
        ["@config explainer model GPT_4_O"],
        ["@config translation model GPT_4_O"],
        ["@config explainer model GPT_4_O"],
    ]);
});

test("invalid model selection fails rather than silently falling back", async () => {
    process.env.TYPEAGENT_SHELL_TEST_MODEL = "GPT_4_O";
    await expect(
        configureShellTestModel(async () => "Invalid model name: GPT_4_O"),
    ).rejects.toThrow("Failed to configure shell test translation model");
});

test("empty override fails explicitly", () => {
    process.env.TYPEAGENT_SHELL_TEST_MODEL = " ";
    expect(getShellTestModel).toThrow(
        "TYPEAGENT_SHELL_TEST_MODEL must name a configured model",
    );
});
