// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryOpExpr
{
}

internal class QueryOpExpr<T> : QueryOpExpr
{
    public bool IsAsync => true;

    public virtual T Eval(QueryEvalContext context)
    {
        return EvalAsync(context).WaitForResult();
    }

    public virtual ValueTask<T> EvalAsync(QueryEvalContext context)
    {
        throw new NotImplementedException();
    }
}
