// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal interface IQueryOpExpr<T>
{
    bool IsAsync { get; }

    T Eval(QueryEvalContext context);
    Task<T> EvalAsync(QueryEvalContext context);
}

internal class QueryOpExprAsync<T> : IQueryOpExpr<T>
{
    public bool IsAsync => true;

    public virtual T Eval(QueryEvalContext context)
    {
        return EvalAsync(context).WaitForResult();
    }

    public virtual Task<T> EvalAsync(QueryEvalContext context)
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

    public virtual Task<T> EvalAsync(QueryEvalContext context)
    {
        return Task.FromResult(Eval(context));
    }
}
