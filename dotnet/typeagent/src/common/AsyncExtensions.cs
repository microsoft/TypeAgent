// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class AsyncExtensions
{
    // GetAwaiter().GetResult() ensures that the originating exception is 
    // propagated directly instead of being wrapped in an aggregate exception
    public static void WaitForResult(this Task task)
    {
        task.ConfigureAwait(false).GetAwaiter().GetResult();
    }

    public static T WaitForResult<T>(this Task<T> task)
    {
        return task.ConfigureAwait(false).GetAwaiter().GetResult();
    }
}
