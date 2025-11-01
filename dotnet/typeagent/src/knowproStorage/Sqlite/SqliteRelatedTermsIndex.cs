// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteRelatedTermsIndex : ITermToRelatedTermIndex
{
    public SqliteRelatedTermsIndex(SqliteDatabase db, TermToRelatedTermIndexSettings settings)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Aliases = new SqliteTermToRelatedTerms(db);
        FuzzyIndex = settings.EmbeddingIndexSetting is null
            ? new NullTermToRelatedTermsFuzzy()
            : new SqliteTermToRelatedTermsFuzzy(db, settings.EmbeddingIndexSetting);
    }

    public TermToRelatedTermIndexSettings Settings { get; }

    public ITermToRelatedTermsIndex Aliases { get; }

    public ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
