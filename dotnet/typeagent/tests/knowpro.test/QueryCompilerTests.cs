// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Query;
using TypeAgent.KnowPro.Storage.Sqlite;

namespace TypeAgent.Tests.KnowPro;
public class QueryCompilerTests : TestWithData
{
    public QueryCompilerTests() : base(true, true) { }

    [Fact]
    public void QueryCompilerConstructorTests()
    {
        QueryEvalContext context = new QueryEvalContext(this._podcast, CancellationToken.None);
        QueryCompiler qc = new QueryCompiler(this._podcast, context.Cache, CancellationToken.None);

        Assert.Throws<ArgumentNullException>(() => new QueryCompiler(null!, context.Cache, CancellationToken.None));
        Assert.Throws<ArgumentNullException>(() => new QueryCompiler(this._podcast, null!, CancellationToken.None));
    }

    [Fact]
    public async Task OrQueryTestAsync()
    {
        QueryEvalContext context = new QueryEvalContext(this._podcast, CancellationToken.None);
        QueryCompiler qc = new QueryCompiler(this._podcast, context.Cache, CancellationToken.None);

        qc.Settings.EntityTermMatchWeight = 101;
        qc.Settings.DefaultTermMatchWeight = 9;
        qc.Settings.RelatedIsExactThreshold = 0.94;

        var query = await qc.CompileMessageSimilarityQueryAsync("book", null, null);
        var results = await query.EvalAsync(context);

        Assert.True(results.Count > 0);

        //    const string TargetEntity = "Children of Memory";

        //    QueryEvalContext context = new QueryEvalContext(this._podcast, CancellationToken.None);
        //    QueryCompiler qc = new QueryCompiler(this._podcast, context.Cache, CancellationToken.None);

        //    qc.

        //    const expr = new q.MatchMessagesOrExpr([
        //new q.MatchPropertySearchTermExpr(createPropertySearchTerm(PropertyNames.Object, targetEntityName)),
        //    new q.MatchPropertySearchTermExpr(createPropertySearchTerm(PropertyNames.EntityName, targetEntityName)),
        //]);
    }

    //test("messages.terms.or", () => {
    //    const targetEntityName = "Children of Memory";
    //    const query = compileActionTarget(targetEntityName);
    //    const messageOrdinals = query.eval(createContext());
    //    expect(messageOrdinals.size).toBeGreaterThan(0);
    //}, testTimeout);
}
