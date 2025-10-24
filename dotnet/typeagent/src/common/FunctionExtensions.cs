// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Threading;
using System.Threading.Tasks;

namespace TypeAgent.Common;

public static class FunctionExtensions
{
    /// <summary>
    /// Calls an async function with automatic retry in the case of exceptions.
    /// </summary>
    /// <typeparam name="T">Return type of the async function.</typeparam>
    /// <param name="asyncFn">Async function to execute. Use closures to pass parameters.</param>
    /// <param name="settings">Retry settings. If null, uses defaults.</param>
    /// <param name="shouldAbort">Optional function to inspect the exception and abort retries.</param>
    /// <param name="cancellationToken">Optional cancellation token.</param>
    /// <returns>Result of type T.</returns>
    public static async Task<T> CallWithRetryAsync<T>(
        this Func<Task<T>> asyncFn,
        RetrySettings? settings = null,
        Func<Exception, bool>? shouldAbort = null,
        CancellationToken cancellationToken = default)
    {
        settings ??= RetrySettings.Default;
        int retryCount = 0;
        while (true)
        {
            try
            {
                return await asyncFn();
            }
            catch (Exception e)
            {
                if (retryCount >= settings.MaxRetries || (shouldAbort != null && shouldAbort(e)))
                {
                    throw;
                }
            }

            retryCount++;
            int pauseMs = settings.RetryPauseMs > 0
                ? settings.RetryPauseMs * (1 << retryCount) // Exponential backoff
                : 0;

            if (pauseMs > 0)
            {
                pauseMs = settings.AdjustRetryPauseMs(pauseMs);
                await Task.Delay(pauseMs, cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
