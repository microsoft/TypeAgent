// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteSemanticRefCollection : ISemanticRefCollection
{
    SqliteDatabase _db;
    int _count = -1;

    public SqliteSemanticRefCollection(SqliteDatabase db)
    {
        ArgumentVerify.ThrowIfNull(db, nameof(db));
        _db = db;
    }


    public bool IsPersistent => true;

    public int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.SemanticRefTable);
        }
        return _count;
    }

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(GetCount());
    }

    public void Append(SemanticRef semanticRef)
    {
        KnowProVerify.ThrowIfInvalid(semanticRef);

        SemanticRefRow row = ToSemanticRefRow(semanticRef);

        using var cmd = _db.CreateCommand(
           @"INSERT INTO SemanticRefs (semref_id, range_json, knowledge_type, knowledge_json)
          VALUES (@semref_id, @range_json, @knowledge_type, @knowledge_json);"
        );
        WriteSemanticRefRow(cmd, row);
        int rowCount = cmd.ExecuteNonQuery();
        if (rowCount > 0)
        {
            _count += rowCount;
        }
    }

    public ValueTask AppendAsync(SemanticRef semanticRef, CancellationToken cancellationToken = default)
    {
        Append(semanticRef);
        return ValueTask.CompletedTask;
    }

    public ValueTask AppendAsync(IEnumerable<SemanticRef> items, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNull(items, nameof(items));

        // TODO: Bulk operations
        foreach (var sr in items)
        {
            Append(sr);
        }
        return ValueTask.CompletedTask;
    }

    public SemanticRef Get(int semanticRefId)
    {
        ArgumentVerify.ThrowIfLessThan(semanticRefId, 0, nameof(semanticRefId));

        using var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs WHERE semref_id = @semref_id");
        cmd.AddParameter("semref_id", semanticRefId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            throw new ArgumentException($"No semanticRef at ordinal {semanticRefId}");
        }

        SemanticRefRow row = ReadSemanticRefRow(reader);
        SemanticRef semanticRef = FromSemanticRefRow(row);
        return semanticRef;
    }


    public ValueTask<SemanticRef> GetAsync(int ordinal, CancellationToken cancellationToken = default)
    {
        return ValueTask.FromResult(Get(ordinal));
    }

    public ValueTask<IList<SemanticRef>> GetAsync(IList<int> ids, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(ids, nameof(ids));

        List<SemanticRef> semanticRefs = new(ids.Count);
        foreach (var batch in ids.Batch(SqliteDatabase.MaxBatchSize))
        {
            var placeholderIds = SqliteDatabase.MakeInPlaceholderIds(batch.Count);
            var sql = $@"
                SELECT semref_id, range_json, knowledge_type, knowledge_json
                FROM SemanticRefs WHERE semref_id IN ({string.Join(", ", placeholderIds)})
                ORDER BY semref_id";
            var rows = _db.Enumerate(
                sql,
                cmd => cmd.AddIdParameters(placeholderIds, batch),
                ReadSemanticRefRow);
            foreach (var row in rows)
            {
                semanticRefs.Add(FromSemanticRefRow(row));
            }
        }
        return ValueTask.FromResult((IList<SemanticRef>)semanticRefs);
    }

    public async IAsyncEnumerator<SemanticRef> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        using var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs
ORDER BY semref_id
");
        using var reader = cmd.ExecuteReader();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            SemanticRef semanticRef = ReadSemanticRef(reader);
            yield return semanticRef;
        }

    }

    public ValueTask<IList<SemanticRef>> GetSliceAsync(int startOrdinal, int endOrdinal, CancellationToken cancellationToken = default)
    {
        ArgumentVerify.ThrowIfGreaterThan(startOrdinal, endOrdinal, nameof(startOrdinal));

        using var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs WHERE semref_id >= @start_id AND semref_id < @end_id
ORDER BY semref_id");
        cmd.AddParameter("@start_id", startOrdinal);
        cmd.AddParameter("@end_id", endOrdinal);

        using var reader = cmd.ExecuteReader();
        var semanticRefList = reader.GetList(ReadSemanticRef);
        return ValueTask.FromResult(semanticRefList);
    }

    int GetNextSemanicRefId()
    {
        return GetCount();
    }

    SemanticRef ReadSemanticRef(SqliteDataReader reader)
    {
        var row = ReadSemanticRefRow(reader);
        return FromSemanticRefRow(row);
    }

    SemanticRefRow ToSemanticRefRow(SemanticRef semanticRef)
    {
        SemanticRefRow row = new();
        row.SemanticRefId = (semanticRef.SemanticRefOrdinal < 0) ? GetNextSemanicRefId() : semanticRef.SemanticRefOrdinal;
        row.RangeJson = StorageSerializer.ToJson(semanticRef.Range);
        row.KnowledgeType = semanticRef.KnowledgeType;
        row.KnowledgeJson = StorageSerializer.ToJson(semanticRef.Knowledge);
        return row;
    }

    SemanticRef FromSemanticRefRow(SemanticRefRow semanticRefRow)
    {
        SemanticRef semanticRef = new()
        {
            SemanticRefOrdinal = semanticRefRow.SemanticRefId,
            Range = StorageSerializer.FromJson<TextRange>(semanticRefRow.RangeJson),
            KnowledgeType = semanticRefRow.KnowledgeType,
            Knowledge = SemanticRef.Deserialize(semanticRefRow.KnowledgeJson, semanticRefRow.KnowledgeType)
        };

        return semanticRef;
    }

    SemanticRefRow ReadSemanticRefRow(SqliteDataReader reader)
    {
        SemanticRefRow row = new SemanticRefRow();

        int iCol = 0;
        row.SemanticRefId = reader.GetInt32(iCol++);
        row.RangeJson = reader.GetStringOrNull(iCol++);
        row.KnowledgeType = reader.GetStringOrNull(iCol++);
        row.KnowledgeJson = reader.GetStringOrNull(iCol++);

        return row;
    }

    void WriteSemanticRefRow(SqliteCommand cmd, SemanticRefRow semanticRefRow)
    {
        cmd.AddParameter("@semref_id", semanticRefRow.SemanticRefId);
        cmd.AddParameter("@range_json", semanticRefRow.RangeJson);
        cmd.AddParameter("@knowledge_type", semanticRefRow.KnowledgeType);
        cmd.AddParameter("@knowledge_json", semanticRefRow.KnowledgeJson);
    }
}

internal class SemanticRefRow
{
    public int SemanticRefId { get; set; }
    public string? RangeJson { get; set; }
    public string? KnowledgeType { get; set; }
    public string? KnowledgeJson { get; set; }
}
