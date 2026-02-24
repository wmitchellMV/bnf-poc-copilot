using GridApi.Models;
using GridApi.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();

var dataService = MockDataService.Instance;

// Get grid configuration (periods + column definitions)
app.MapGet("/api/config", () => dataService.GetConfig());

// Get root-level accounts
app.MapGet("/api/accounts/roots", () => dataService.GetRootAccounts());

// Get a specific account view (parent + its direct children)
app.MapGet("/api/accounts/{accountNumber}/view", (string accountNumber) =>
{
    var view = dataService.GetAccountView(accountNumber);
    return view is not null ? Results.Ok(view) : Results.NotFound();
});

// Search accounts by number or name
app.MapGet("/api/accounts/search", (string q) => dataService.SearchAccounts(q));

// Get all accounts (flat list for formula reference lookup)
app.MapGet("/api/accounts/all", () =>
{
    return dataService.GetAllAccounts().Values.Select(a => new
    {
        a.AccountNumber,
        a.AccountName,
        a.ParentAccountNumber,
        a.Level,
        HasChildren = a.ChildAccountNumbers.Count > 0,
        a.Data
    });
});

// Update a cell value
app.MapPut("/api/accounts/cell", (CellUpdateRequest request) =>
{
    var success = dataService.UpdateCell(request);
    return success ? Results.Ok() : Results.NotFound();
});

// Resolve a cell value (for formula evaluation)
app.MapGet("/api/accounts/{accountNumber}/cell/{column}", (string accountNumber, string column) =>
{
    var value = dataService.ResolveCellValue(accountNumber, column);
    return value.HasValue ? Results.Ok(new { value = value.Value }) : Results.NotFound();
});

// Resolve an API-calculated variable
app.MapPost("/api/variables/resolve", async (VariableResolveRequest request) =>
{
    // Check if this variable is known
    var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "GLActuals.1YearAgo" };
    if (!known.Contains(request.VariableName))
    {
        return Results.NotFound(new { error = $"Unknown variable: {request.VariableName}" });
    }

    // Simulate a slow calculation
    await Task.Delay(2000);

    // Return a deterministic-ish demo value between 10000-15000
    var hash = HashCode.Combine(request.VariableName, request.AccountNumber, request.PeriodId, request.ColumnId);
    var rng = new Random(hash);
    var value = Math.Round(10000 + rng.NextDouble() * 5000, 2);

    return Results.Ok(new { value });
});

// Batch save cell changes
app.MapPost("/api/accounts/batch-save", (BatchSaveRequest request) =>
{
    var saved = 0;
    foreach (var change in request.Changes)
    {
        var cellRequest = new CellUpdateRequest
        {
            AccountNumber = change.AccountNumber,
            Column = change.Column,
            Formula = change.Formula,
            NumericValue = change.NumericValue
        };
        if (dataService.UpdateCell(cellRequest))
            saved++;
    }
    return Results.Ok(new BatchSaveResponse { SavedCount = saved, Success = true });
});

app.Run();
