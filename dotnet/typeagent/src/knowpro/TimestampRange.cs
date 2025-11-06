// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro;

public struct TimestampRange
{
    [JsonPropertyName("start")]
    public string StartTimestamp { get; set; }

    [JsonPropertyName("end")]
    public string? EndTimestamp { get; set; }
}
