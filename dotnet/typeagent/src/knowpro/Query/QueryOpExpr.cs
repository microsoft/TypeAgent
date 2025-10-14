// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryOpExpr
{
    public virtual ValueTask<object> GetResultAsync(QueryEvalContext context)
    {
        return ValueTask.FromResult<object>(null);
    }
}

internal class QueryOpExpr<T> : QueryOpExpr
{
    public bool IsAsync => true;

    public override async ValueTask<object> GetResultAsync(QueryEvalContext context)
    {
        return await EvalAsync(context).ConfigureAwait(false);
    }

    public virtual ValueTask<T> EvalAsync(QueryEvalContext context)
    {
        throw new NotImplementedException();
    }
}
