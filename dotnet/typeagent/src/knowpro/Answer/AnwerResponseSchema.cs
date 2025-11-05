// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json.Serialization;
using Microsoft.TypeChat.Schema;

namespace TypeAgent.KnowPro.Answer;

/// <summary>
/// Type of answer produced by the generator.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum AnswerType
{
    [Comment("If question cannot be accurately answered from [ANSWER CONTEXT]")]
    NoAnswer,

    [Comment("Fully answer question")]
    Answered,
}

public sealed class AnswerResponse
{
    [JsonPropertyName("type")]
    [Comment("use \"NoAnswer\" if no highly relevant answer found in the [ANSWER CONTEXT]")]
    public AnswerType Type { get; set; }

    [JsonPropertyName("answer")]
    [Comment("the answer to display if [ANSWER CONTEXT] is highly relevant and can be used to answer the user's question")]
    public string? Answer { get; set; }

    [JsonPropertyName("whyNoAnswer")]
    [Comment("If NoAnswer, explain why..")]
    [Comment("particularly explain why you didn't use any supplied entities")]
    public string? WhyNoAnswer { get; set; }
}
