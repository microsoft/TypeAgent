// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StopReason =
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "pause_turn"
    | "refusal"
    | "model_context_window_exceeded";

export type Model = string & {};

export interface TextBlock {
    citations: unknown[] | null;
    text: string;
    type: "text";
}

export interface ToolUseBlock {
    id: string;
    caller?: unknown;
    input: unknown;
    name: string;
    type: "tool_use";
}

export interface ThinkingBlock {
    signature: string;
    thinking: string;
    type: "thinking";
}

export interface RedactedThinkingBlock {
    data: string;
    type: "redacted_thinking";
}

export type ContentBlock =
    | TextBlock
    | ThinkingBlock
    | RedactedThinkingBlock
    | ToolUseBlock
    | { type: string; [k: string]: unknown };

export interface TextBlockParam {
    text: string;
    type: "text";
    cache_control?: unknown | null;
    citations?: unknown[] | null;
}

export type ContentBlockParam =
    | TextBlockParam
    | ToolUseBlock
    | { type: string; [k: string]: unknown };

export interface MessageParam {
    content: string | Array<ContentBlockParam>;
    role: "user" | "assistant" | "system";
}

export interface Usage {
    cache_creation?: unknown | null;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    inference_geo?: string | null;
    input_tokens: number;
    output_tokens: number;
    output_tokens_details?: unknown | null;
    server_tool_use?: unknown | null;
    service_tier?: "standard" | "priority" | "batch" | null;
}

export interface Message {
    id: string;
    container?: unknown | null;
    content: Array<ContentBlock>;
    model: Model;
    role: "assistant";
    stop_details?: unknown | null;
    stop_reason: StopReason | null;
    stop_sequence: string | null;
    type: "message";
    usage: Usage;
}

export interface Tool {
    input_schema: Tool.InputSchema;
    name: string;
    description?: string;
    type?: "custom" | null;
    [k: string]: unknown;
}

export namespace Tool {
    export interface InputSchema {
        type: "object";
        properties?: unknown | null;
        required?: Array<string> | null;
        [k: string]: unknown;
    }
}

export type ToolChoice =
    | { type: "auto"; disable_parallel_tool_use?: boolean }
    | { type: "any"; disable_parallel_tool_use?: boolean }
    | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
    | { type: "none" };

export interface MessageCreateParamsBase {
    max_tokens: number;
    messages: Array<MessageParam>;
    model: Model;
    stream?: boolean;
    system?: string | Array<TextBlockParam>;
    temperature?: number;
    tool_choice?: ToolChoice;
    tools?: Array<Tool>;
    top_k?: number;
    top_p?: number;
}

export interface MessageCreateParamsNonStreaming
    extends MessageCreateParamsBase {
    stream?: false;
}

export interface MessageCreateParamsStreaming extends MessageCreateParamsBase {
    stream: true;
}

export type MessageCreateParams =
    | MessageCreateParamsNonStreaming
    | MessageCreateParamsStreaming;

export interface TextDelta {
    text: string;
    type: "text_delta";
}

export interface MessageDeltaUsage {
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    input_tokens: number | null;
    output_tokens: number;
    output_tokens_details?: unknown | null;
    server_tool_use?: unknown | null;
}

export interface RawContentBlockDeltaEvent {
    delta: TextDelta | { type: string; [k: string]: unknown };
    index: number;
    type: "content_block_delta";
}

export interface RawMessageDeltaEvent {
    delta: {
        stop_reason: StopReason | null;
        stop_sequence: string | null;
        [k: string]: unknown;
    };
    type: "message_delta";
    usage: MessageDeltaUsage;
}

export interface RawMessageStartEvent {
    message: Message;
    type: "message_start";
}

export interface RawMessageStopEvent {
    type: "message_stop";
}

export interface RawContentBlockStartEvent {
    content_block: ContentBlock;
    index: number;
    type: "content_block_start";
}

export interface RawContentBlockStopEvent {
    index: number;
    type: "content_block_stop";
}

export type RawMessageStreamEvent =
    | RawMessageStartEvent
    | RawMessageDeltaEvent
    | RawMessageStopEvent
    | RawContentBlockStartEvent
    | RawContentBlockDeltaEvent
    | RawContentBlockStopEvent;
