// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal interface IQueryOpExpr<T>
{
    bool IsAsync { get; }
}

internal class QueryOpExprAsync<T> : IQueryOpExpr<T>
{
    public bool IsAsync => true;

    public virtual ValueTask<T> EvalAsync(QueryEvalContext context)
    {
        throw new NotImplementedException();
    }
}

internal class QueryOpExpr<T> : IQueryOpExpr<T>
{
    public bool IsAsync => false;

    public virtual T Eval(QueryEvalContext context)
    {
        throw new NotImplementedException();
    }
}
