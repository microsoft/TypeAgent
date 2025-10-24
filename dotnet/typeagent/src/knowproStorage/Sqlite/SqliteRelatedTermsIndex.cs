// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteRelatedTermsIndex : ITermToRelatedTermIndex
{
    public SqliteRelatedTermsIndex(SqliteDatabase db, RelatedTermIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        FuzzyIndex = new SqliteRelatedTermsFuzzy(db, settings.EmbeddingIndexSetting);
    }

    public RelatedTermIndexSettings Settings { get; }

    public ITermsToRelatedTerms Aliases => throw new NotImplementedException();

    public ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
