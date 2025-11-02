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

internal class QueryOpExpr<TRetVal> : QueryOpExpr
{
    public bool IsAsync => true;

    public override async ValueTask<object> GetResultAsync(QueryEvalContext context)
    {
        return await EvalAsync(context).ConfigureAwait(false);
    }

    public virtual ValueTask<TRetVal> EvalAsync(QueryEvalContext context)
    {
        throw new NotImplementedException();
    }

    public ValueTask<TRetVal> RunAsync(
        IConversation conversation,
        QueryEvalContext context
    )
    {
        return EvalAsync(context);
    }
}

internal class NoOpExpr<T> : QueryOpExpr<T>
{
    public NoOpExpr(QueryOpExpr<T> srcExpr)
    {
        SrcExpr = srcExpr;
    }

    public QueryOpExpr<T> SrcExpr { get; }

    public override ValueTask<T> EvalAsync(QueryEvalContext context)
    {
        return SrcExpr.EvalAsync(context);
    }
}
