// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public class RetrySettings
{
    internal static readonly RetrySettings Default = new();

    public RetrySettings()
    {
        MaxRetries = 3;
        RetryPauseMs = 1000;
        MaxRetryPauseMs = -1;
        JitterRange = 0.5;
    }

    public int MaxRetries { get; set; }

    public int RetryPauseMs { get; set; }

    public int MaxRetryPauseMs { get; set; }

    public double JitterRange { get; set; }

    /// <summary>
    /// Adjusts the retry pause duration by applying a jitter factor and ensuring it does not exceed the maximum allowed
    /// pause.
    /// </summary>
    public int AdjustRetryPauseMs(int retryPauseMs)
    {
        if (JitterRange > 0 && JitterRange <= 1)
        {
            double jitterOffset = JitterRange / 2;
            double jitter = 1.0 - jitterOffset + (Random.Shared.NextDouble() * JitterRange);

            retryPauseMs = (int)(retryPauseMs * jitter);

        }
        if (MaxRetryPauseMs > 0)
        {
            retryPauseMs = Math.Min(retryPauseMs, MaxRetryPauseMs);
        }
        return retryPauseMs;
    }
}
