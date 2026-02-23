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

// Get all column definitions
app.MapGet("/api/columns", () => dataService.GetColumns());

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

app.Run();
