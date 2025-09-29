// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;


internal class QueryOpExpr<T>
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
