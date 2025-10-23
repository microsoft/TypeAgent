// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqlitePropertyToSemanticRefIndex : IPropertyToSemanticRefIndex
{
    SqliteDatabase _db;

    public SqlitePropertyToSemanticRefIndex(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));

        _db = db;
    }

    public int GetCount()
    {
        return _db.GetCount(SqliteStorageProviderSchema.PropertyIndexTable);
    }

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public void AddProperty(string propertyName, string value, ScoredSemanticRefOrdinal scoredOrdinal)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(propertyName, nameof(propertyName));
        ArgumentVerify.ThrowIfNullOrEmpty(value, nameof(value));
        KnowProVerify.ThrowIfInvalidSemanticRefOrdinal(scoredOrdinal.SemanticRefOrdinal);

        propertyName = PreparePropertyName(propertyName);
        value = PreparePropertyValue(value);

        using var cmd = _db.CreateCommand(@"
INSERT INTO PropertyIndex (prop_name, value_str, score, semref_id)
VALUES (@propertyName, @value, @score, @semrefId)
");
        cmd.AddParameter("@propertyName", propertyName);
        cmd.AddParameter("@value", value);
        cmd.AddParameter("@score", scoredOrdinal.Score);
        cmd.AddParameter("@semrefId", scoredOrdinal.SemanticRefOrdinal);

        cmd.ExecuteNonQuery();
    }

    public ValueTask AddPropertyAync(
        string propertyName,
        string value,
        ScoredSemanticRefOrdinal scoredOrdinal,
        CancellationToken cancellationToken = default)
    {
        AddProperty(propertyName, value, scoredOrdinal);
        return ValueTask.CompletedTask;
    }

    public void Clear() => _db.ClearTable(SqliteStorageProviderSchema.PropertyIndexTable);

    public ValueTask ClearAsync(CancellationToken cancellationToken = default)
    {
        Clear();
        return ValueTask.CompletedTask;
    }

    public IList<string> GetValues()
    {
        return _db.GetList("SELECT DISTINCT value_str FROM PropertyIndex ORDER BY value_str", (reader) =>
        {
            return reader.GetString(0);
        });
    }

    public ValueTask<IList<string>> GetValuesAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetValues());
    }

    public IList<ScoredSemanticRefOrdinal> LookupProperty(string propertyName, string value)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(propertyName, nameof(propertyName));
        ArgumentVerify.ThrowIfNullOrEmpty(value, nameof(value));

        propertyName = PreparePropertyName(propertyName);
        value = PreparePropertyValue(value);

        using var cmd = _db.CreateCommand(@"
SELECT semref_id, score FROM PropertyIndex WHERE prop_name = @propertyName AND value_str = @value"
);
        cmd.AddParameter("@propertyName", propertyName);
        cmd.AddParameter("@value", value);

        using var reader = cmd.ExecuteReader();
        return reader.GetList((reader) =>
        {
            int iCol = 0;
            return new ScoredSemanticRefOrdinal
            {
                SemanticRefOrdinal = reader.GetInt32(iCol++),
                Score = reader.GetFloat(iCol)
            };

        });
    }

    public ValueTask<IList<ScoredSemanticRefOrdinal>> LookupPropertyAsync(string propertyName, string value, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(LookupProperty(propertyName, value));
    }

    private string PreparePropertyName(string propertyName)
    {
        propertyName = propertyName.Trim().ToLower();
        ArgumentVerify.ThrowIfNullOrEmpty(propertyName, nameof(propertyName));
        return propertyName;
    }

    private string PreparePropertyValue(string value)
    {
        return value.Trim().ToLower();
    }

    private ScoredSemanticRefOrdinal ReadScoredOrdinal(SqliteDataReader reader)
    {
        int iCol = 0;
        return new()
        {
            SemanticRefOrdinal = reader.GetInt32(iCol++),
            Score = reader.GetFloat(iCol)
        };
    }

}
