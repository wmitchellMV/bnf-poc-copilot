using GridApi.Models;

namespace GridApi.Services;

public class MockDataService
{
    private static readonly string[] Columns = 
    { 
        "2024 Budget", "2024 Actual", "2025 Budget", "2025 Actual", "2026 Budget", "2026 Projected" 
    };

    private static readonly Random Rng = new(42);

    private readonly Dictionary<string, Account> _accounts = new();
    private readonly List<Account> _rootAccounts = new();

    private static MockDataService? _instance;
    private static readonly object Lock = new();

    public static MockDataService Instance
    {
        get
        {
            if (_instance == null)
            {
                lock (Lock)
                {
                    _instance ??= new MockDataService();
                }
            }
            return _instance;
        }
    }

    private MockDataService()
    {
        GenerateMockData();
    }

    public IReadOnlyList<string> GetColumns() => Columns;

    public IReadOnlyDictionary<string, Account> GetAllAccounts() => _accounts;

    public GridViewResponse? GetAccountView(string accountNumber)
    {
        if (!_accounts.TryGetValue(accountNumber, out var account))
            return null;

        var children = account.ChildAccountNumbers
            .Where(cn => _accounts.ContainsKey(cn))
            .Select(cn => ToTreeNode(_accounts[cn]))
            .ToList();

        return new GridViewResponse
        {
            Parent = ToTreeNode(account),
            Children = children,
            Columns = Columns.ToList()
        };
    }

    public List<AccountTreeNode> GetRootAccounts()
    {
        return _rootAccounts.Select(ToTreeNode).ToList();
    }

    public List<AccountTreeNode> SearchAccounts(string query)
    {
        var lower = query.ToLowerInvariant();
        return _accounts.Values
            .Where(a => a.AccountNumber.ToLowerInvariant().Contains(lower) ||
                        a.AccountName.ToLowerInvariant().Contains(lower))
            .Take(50)
            .Select(ToTreeNode)
            .ToList();
    }

    public bool UpdateCell(CellUpdateRequest request)
    {
        if (!_accounts.TryGetValue(request.AccountNumber, out var account))
            return false;

        account.Data[request.Column] = new CellData
        {
            NumericValue = request.NumericValue,
            Formula = request.Formula
        };
        return true;
    }

    public double? ResolveCellValue(string accountNumber, string column)
    {
        if (!_accounts.TryGetValue(accountNumber, out var account))
            return null;

        if (!account.Data.TryGetValue(column, out var cell))
            return null;

        return cell.NumericValue;
    }

    private AccountTreeNode ToTreeNode(Account account)
    {
        return new AccountTreeNode
        {
            AccountNumber = account.AccountNumber,
            AccountName = account.AccountName,
            ParentAccountNumber = account.ParentAccountNumber,
            Level = account.Level,
            HasChildren = account.ChildAccountNumbers.Count > 0,
            Data = account.Data
        };
    }

    private void GenerateMockData()
    {
        // Category templates for generating realistic account names
        var topLevelCategories = new[]
        {
            ("Total Revenue", new[] { "Operating Revenue", "Non-Operating Revenue", "Investment Revenue", "Service Revenue" }),
            ("Total Expenses", new[] { "Operating Expenses", "Administrative Expenses", "Marketing Expenses", "Research & Development" }),
            ("Cost of Goods Sold", new[] { "Direct Materials", "Direct Labor", "Manufacturing Overhead", "Freight & Shipping" }),
            ("Assets", new[] { "Current Assets", "Fixed Assets", "Intangible Assets", "Investment Assets" }),
            ("Liabilities", new[] { "Current Liabilities", "Long-term Debt", "Deferred Revenue", "Contingent Liabilities" }),
            ("Equity", new[] { "Common Stock", "Retained Earnings", "Treasury Stock", "Additional Paid-in Capital" }),
            ("Cash Flow Operations", new[] { "Collections", "Payments to Suppliers", "Payroll Expenses", "Tax Payments" }),
            ("Cash Flow Investing", new[] { "Capital Expenditures", "Acquisitions", "Investment Purchases", "Asset Sales" }),
            ("Cash Flow Financing", new[] { "Debt Issuance", "Debt Repayment", "Dividend Payments", "Stock Repurchases" }),
            ("Other Income", new[] { "Interest Income", "Rental Income", "Royalty Income", "Gain on Sales" })
        };

        var leafAccountNames = new[]
        {
            "Product Sales", "Service Fees", "Licensing Revenue", "Subscription Revenue",
            "Consulting Fees", "Maintenance Revenue", "Support Revenue", "Training Revenue",
            "Hardware Sales", "Software Sales", "Cloud Services", "Data Analytics",
            "Salaries & Wages", "Employee Benefits", "Office Supplies", "Utilities",
            "Rent Expense", "Insurance", "Depreciation", "Amortization",
            "Travel & Entertainment", "Professional Fees", "Advertising", "Promotions",
            "Raw Materials", "Components", "Assembly Labor", "Quality Control",
            "Shipping Costs", "Warehouse Costs", "Packaging", "Returns & Allowances",
            "Cash & Equivalents", "Accounts Receivable", "Inventory", "Prepaid Expenses",
            "Property & Equipment", "Vehicles", "Furniture & Fixtures", "Computer Equipment",
            "Accounts Payable", "Accrued Expenses", "Short-term Notes", "Current Portion LTD",
            "Bonds Payable", "Mortgage Payable", "Lease Obligations", "Pension Liability",
            "Patent Revenue", "Trademark Revenue", "Copyright Revenue", "Trade Secrets",
            "Dividend Income", "Capital Gains", "Foreign Exchange Gains", "Misc Income"
        };

        int accountCounter = 1000;
        int leafNameIndex = 0;

        // Generate ~100 top-level accounts, each with ~3-4 mid-level children, 
        // each mid-level with ~2-3 leaf children → ~1000 total accounts
        int topLevelCount = 0;
        while (_accounts.Count < 1000)
        {
            var catIndex = topLevelCount % topLevelCategories.Length;
            var (topName, midNames) = topLevelCategories[catIndex];
            var suffix = topLevelCount >= topLevelCategories.Length 
                ? $" {(topLevelCount / topLevelCategories.Length) + 1}" 
                : "";
            
            var topAccountNumber = $"A{accountCounter++}";
            var topAccount = new Account
            {
                AccountNumber = topAccountNumber,
                AccountName = $"{topName}{suffix}",
                ParentAccountNumber = null,
                Level = 0,
                Data = GenerateRowData()
            };
            _accounts[topAccountNumber] = topAccount;
            _rootAccounts.Add(topAccount);

            // Mid-level children (3-4 per top)
            int midCount = Rng.Next(3, 5);
            for (int m = 0; m < midCount && _accounts.Count < 1000; m++)
            {
                var midName = midNames[m % midNames.Length];
                if (m >= midNames.Length)
                    midName += $" {m + 1}";
                
                var midSuffix = topLevelCount >= topLevelCategories.Length
                    ? $" {(topLevelCount / topLevelCategories.Length) + 1}"
                    : "";

                var midAccountNumber = $"A{accountCounter++}";
                var midAccount = new Account
                {
                    AccountNumber = midAccountNumber,
                    AccountName = $"{midName}{midSuffix}",
                    ParentAccountNumber = topAccountNumber,
                    Level = 1,
                    Data = GenerateRowData()
                };
                _accounts[midAccountNumber] = midAccount;
                topAccount.ChildAccountNumbers.Add(midAccountNumber);

                // Leaf children (2-3 per mid)
                int leafCount = Rng.Next(2, 4);
                for (int l = 0; l < leafCount && _accounts.Count < 1000; l++)
                {
                    var leafName = leafAccountNames[leafNameIndex % leafAccountNames.Length];
                    leafNameIndex++;
                    
                    var leafSuffix = "";
                    // Ensure unique names
                    var candidateName = leafName + leafSuffix;
                    var attempt = 2;
                    while (_accounts.Values.Any(a => a.AccountName == candidateName))
                    {
                        leafSuffix = $" {attempt++}";
                        candidateName = leafName + leafSuffix;
                    }

                    var leafAccountNumber = $"A{accountCounter++}";
                    var leafAccount = new Account
                    {
                        AccountNumber = leafAccountNumber,
                        AccountName = candidateName,
                        ParentAccountNumber = midAccountNumber,
                        Level = 2,
                        Data = GenerateRowData()
                    };
                    _accounts[leafAccountNumber] = leafAccount;
                    midAccount.ChildAccountNumbers.Add(leafAccountNumber);
                }
            }

            topLevelCount++;
        }
    }

    private Dictionary<string, CellData> GenerateRowData()
    {
        var data = new Dictionary<string, CellData>();
        foreach (var col in Columns)
        {
            var baseValue = Rng.Next(10000, 5000000) / 100.0;
            data[col] = new CellData
            {
                NumericValue = Math.Round(baseValue, 2)
            };
        }
        return data;
    }
}
