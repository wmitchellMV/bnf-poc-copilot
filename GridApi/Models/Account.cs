namespace GridApi.Models;

public class Account
{
    public string AccountNumber { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string? ParentAccountNumber { get; set; }
    public int Level { get; set; }
    public List<string> ChildAccountNumbers { get; set; } = new();
    public Dictionary<string, CellData> Data { get; set; } = new();
}

public class CellData
{
    public double? NumericValue { get; set; }
    public string? Formula { get; set; }
    public string DisplayValue => Formula ?? NumericValue?.ToString("N2") ?? "";
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
    public List<string> Columns { get; set; } = new();
}

public class CellUpdateRequest
{
    public string AccountNumber { get; set; } = string.Empty;
    public string Column { get; set; } = string.Empty;
    public string? Formula { get; set; }
    public double? NumericValue { get; set; }
}
