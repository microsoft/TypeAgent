// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace TypeAgent.AIClient;
public class TokenCounter
{
    public uint TokensIn { get; private set; }
    public uint TokensOut { get; private set; }

    public uint AverageTokensIn => TokensIn == 0 ? 0 : (uint)(TokensIn / Latencies.Count);
    public uint AverageTokensOut => TokensOut == 0 ? 0 : (uint)(TokensOut / Latencies.Count);

    public TimeSpan AverageLatency { get; private set; }

    public List<TimeSpan> Latencies { get; } = [];
    public TimeSpan TotalTime { get; private set; }

    internal void Add(OpenAIChatModel.Usage usage, TimeSpan latency)
    {
        TokensIn += usage.PromptTokens;
        TokensOut += usage.CompletionTokens;

        Latencies.Add(latency);
        TotalTime += latency;

        AverageLatency = TimeSpan.FromMilliseconds(TotalTime.TotalMilliseconds / Latencies.Count);
    }

    public static TokenCounter operator +(TokenCounter a, TokenCounter b)
    {
        var result = new TokenCounter();
        result.TokensIn = a.TokensIn + b.TokensIn;
        result.TokensOut = a.TokensOut + b.TokensOut;
        result.TotalTime = a.TotalTime + b.TotalTime;
        result.Latencies.AddRange(a.Latencies);
        result.Latencies.AddRange(b.Latencies);
        result.AverageLatency = result.Latencies.Count > 0
            ? TimeSpan.FromMilliseconds(result.TotalTime.TotalMilliseconds / result.Latencies.Count)
            : TimeSpan.Zero;
        return result;
    }
}
