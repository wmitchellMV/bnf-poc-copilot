namespace GridApi.Models;

public class Account
{
    public string AccountNumber { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string? ParentAccountNumber { get; set; }
    public int Level { get; set; }
    public List<string> ChildAccountNumbers { get; set; } = new();
    /// <summary>
    /// Data keyed by composite key "periodId:columnId" (e.g. "2101:col1").
    /// Totals are keyed as "total:columnId".
    /// </summary>
    public Dictionary<string, CellData> Data { get; set; } = new();
}

public class CellData
{
    public double? NumericValue { get; set; }
    public string? Formula { get; set; }
    public string DisplayValue => Formula ?? NumericValue?.ToString("N2") ?? "";
}

public class PeriodDef
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public class ColumnDef
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public class AccountTreeNode
{
    public string AccountNumber { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string? ParentAccountNumber { get; set; }
    public int Level { get; set; }
    public bool HasChildren { get; set; }
    public Dictionary<string, CellData> Data { get; set; } = new();
}

public class GridViewResponse
{
    public AccountTreeNode Parent { get; set; } = null!;
    public List<AccountTreeNode> Children { get; set; } = new();
    public List<PeriodDef> Periods { get; set; } = new();
    public List<ColumnDef> Columns { get; set; } = new();
    public int FrozenColumnCount { get; set; } = 2;
}

public class GridConfigResponse
{
    public List<PeriodDef> Periods { get; set; } = new();
    public List<ColumnDef> Columns { get; set; } = new();
}

public class CellUpdateRequest
{
    public string AccountNumber { get; set; } = string.Empty;
    public string Column { get; set; } = string.Empty;
    public string? Formula { get; set; }
    public double? NumericValue { get; set; }
}

public class VariableResolveRequest
{
    public string VariableName { get; set; } = string.Empty;
    public string AccountNumber { get; set; } = string.Empty;
    public string PeriodId { get; set; } = string.Empty;
    public string ColumnId { get; set; } = string.Empty;
}

public class BatchCellUpdate
{
    public string AccountNumber { get; set; } = string.Empty;
    public string Column { get; set; } = string.Empty;
    public string? Formula { get; set; }
    public double? NumericValue { get; set; }
}

public class BatchSaveRequest
{
    public List<BatchCellUpdate> Changes { get; set; } = new();
}

public class BatchSaveResponse
{
    public int SavedCount { get; set; }
    public bool Success { get; set; }
}
