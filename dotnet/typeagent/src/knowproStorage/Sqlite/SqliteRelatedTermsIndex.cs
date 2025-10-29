// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteRelatedTermsIndex : ITermToRelatedTermIndex
{
    public SqliteRelatedTermsIndex(SqliteDatabase db, RelatedTermIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Aliases = new SqliteTermToRelatedTerms(db);
        FuzzyIndex = new SqliteTermToRelatedTermsFuzzy(db, settings.EmbeddingIndexSetting);
    }

    public RelatedTermIndexSettings Settings { get; }

    public ITermsToRelatedTermsIndex Aliases { get; }

    public ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
