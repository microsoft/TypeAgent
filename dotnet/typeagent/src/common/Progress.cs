// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public static class Progress
{
    public static void Notify(Action<BatchItem<string>> handler, int totalCount, BatchItem<List<string>> batch)
    {
        if (handler is null)
        {
            return;
        }

        int count = batch.Item.Count;
        for (int i = 0; i < count; ++i)
        {
            handler.SafeInvoke(new BatchItem<string>(batch.Item[i], batch.Pos + i, totalCount));
        }
    }
}
