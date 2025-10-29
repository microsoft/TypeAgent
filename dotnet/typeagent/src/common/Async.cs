// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;

namespace TypeAgent.Common;

public static class Async
{
    /// <summary>
    /// Asynchronously maps an array with concurrency support.
    /// </summary>
    /// <typeparam name="T">Type of input items.</typeparam>
    /// <typeparam name="TResult">Type of result items.</typeparam>
    /// <param name="list">Items to process.</param>
    /// <param name="concurrency">How many to run in parallel.</param>
    /// <param name="processor">Function to process each item.</param>
    /// <param name="progress">Optional progress callback.</param>
    /// <param name="shouldStop">Optional function to determine early stop.</param>
    /// <returns>List of results.</returns>
    public static async Task<List<TResult>> MapAsync<T, TResult>(
        this IList<T> list,
        int concurrency,
        Func<T, Task<TResult>> processor,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(list, nameof(list));
        ArgumentVerify.ThrowIfLessThanEqualZero(concurrency, nameof(concurrency));
        ArgumentVerify.ThrowIfNull(processor, nameof(processor));

        return concurrency <= 1
            ? await MapSequentialAsync(list, processor, progress, cancellationToken)
            : await MapConcurrentAsync(list, concurrency, processor, progress, cancellationToken);
    }

    private static async Task<List<TResult>> MapSequentialAsync<T, TResult>(
        IList<T> list,
        Func<T, Task<TResult>> processor,
        Action<BatchProgress>? progress,
        CancellationToken cancellationToken
    )
    {
        var results = new List<TResult>();
        for (int i = 0; i < list.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var result = await processor(list[i]);
            results.Add(result);
            if (progress is not null)
            {
                progress(new BatchProgress(results.Count, list.Count));
            }
        }
        return results;
    }

    private static async Task<List<TResult>> MapConcurrentAsync<T, TResult>(
        IList<T> list,
        int concurrency,
        Func<T, Task<TResult>> processor,
        Action<BatchProgress>? progress,
        CancellationToken cancellationToken
    )
    {
        var results = new List<TResult>();
        int totalCount = list.Count;
        for (int startAt = 0; startAt < totalCount; startAt += concurrency)
        {
            cancellationToken.ThrowIfCancellationRequested();

            int batchSize = Math.Min(concurrency, totalCount - startAt);
            var batch = list.Slice(startAt, batchSize);
            var tasks = batch.Map<T, Task<TResult>>(processor);

            var batchResults = await Task.WhenAll(tasks);

            results.AddRange(batchResults);
            if (progress is not null)
            {
                progress(new BatchProgress(results.Count, totalCount));
            }
        }
        return results;
    }

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
        Func<CancellationToken, Task<T>> asyncFn,
        RetrySettings? settings = null,
        Func<Exception, bool>? shouldAbort = null,
        CancellationToken cancellationToken = default
    )
    {
        settings ??= RetrySettings.Default;
        int retryCount = 0;
        while (true)
        {
            try
            {
                return await asyncFn(cancellationToken).ConfigureAwait(false);
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

    public static Task<T> CallWithRetryAsync<T>(
        Func<CancellationToken, Task<T>> asyncFn,
        CancellationToken cancellationToken = default
    )
    {
        return CallWithRetryAsync<T>(asyncFn, null, null, cancellationToken);
    }
}
