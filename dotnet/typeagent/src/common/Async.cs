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
        Func<T, int, TResult, bool>? progress,
        Func<object?, bool>? shouldStop = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(list, nameof(list));
        ArgumentVerify.ThrowIfLessThanEqualZero(concurrency, nameof(concurrency));
        ArgumentVerify.ThrowIfNull(processor, nameof(processor));

        return concurrency <= 1
            ? await MapSequentialAsync(list, processor, progress, shouldStop, cancellationToken)
            : await MapConcurrentAsync(list, concurrency, processor, progress, shouldStop, cancellationToken);
    }

    public static Task<List<TResult>> MapAsync<T, TResult>(
        this IList<T> list,
        int concurrency,
        Func<T, Task<TResult>> processor,
        CancellationToken cancellationToken = default
    )
    {
        return list.MapAsync(concurrency, processor, null, null, cancellationToken);
    }

    private static async Task<List<TResult>> MapSequentialAsync<T, TResult>(
        IList<T> list,
        Func<T, Task<TResult>> processor,
        Func<T, int, TResult, bool>? progress,
        Func<object?, bool>? shouldStop,
        CancellationToken cancellationToken
    )
    {
        var results = new List<TResult>();
        for (int i = 0; i < list.Count; i++)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                break;
            }

            var result = await processor(list[i]);
            results.Add(result);
            if (progress is not null)
            {
                var stop = progress(list[i], i, result);
                if (shouldStop is not null && shouldStop(stop))
                {
                    break;
                }
            }
        }
        return results;
    }

    private static async Task<List<TResult>> MapConcurrentAsync<T, TResult>(
        IList<T> list,
        int concurrency,
        Func<T, Task<TResult>> processor,
        Func<T, int, TResult, bool>? progress,
        Func<object?, bool>? shouldStop,
        CancellationToken cancellationToken
    )
    {
        var results = new List<TResult>();
        int count = list.Count;
        for (int startAt = 0; startAt < count; startAt += concurrency)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                break;
            }

            int batchSize = Math.Min(concurrency, count - startAt);
            var batch = list.Slice(startAt, batchSize);
            var tasks = batch.Map<T, Task<TResult>>(processor);

            var batchResults = await Task.WhenAll(tasks);

            results.AddRange(batchResults);
            if (progress is not null)
            {
                bool stop = false;
                for (int i = 0; i < batchSize; ++i)
                {
                    int idx = startAt + i;
                    var r = progress(list[idx], idx, results[idx]);
                    if (shouldStop is not null && shouldStop(r))
                    {
                        stop = true;
                    }
                }
                if (stop)
                {
                    return results;
                }
            }
        }
        return results;
    }
}
