# Overview

I want to build an editable, formula-supporting, hierarchical grid component for ReactJS using TypeScript. The control needs to support a number of features as detailed below.

## Primary Requirements

* The grid component should allow specifying as many columns as they desire, with the ability to "freeze" a number of columns to the left so that they stay in view while the user scrolls left to right.
* We need to be able to display "hierarchical" data in a "tree structure", but only display one level with it's children at a time. For example, given the hierarchical data below, when viewing account 1_123, I only wish to see 1_123, child 1_456 and child 1_789. When viewing child account 1_456, I only wish to see 1_456, 1_159 and 1_483, etc...
```
- 1_123: Total Revenue
  - 1_456: Operating Revenue
    - 1_159: Sales Revenue
    - 1_483: Fees Revenue
  - 1_789: Investment Revenue
    -  1_987: Property Investments
    - 1_654: Financial Investments
```

* The developer should be able to include multiple columns for each line in the grid. 
* The first column of the grid should reference an account number, the second column should reference the account name. Remaining columns are considered data columns and should only contain numeric values or formulas.
* The grid should support basic arithmetic in formulas to add, subtract, multiply or divide numbers with the values for other cells, or with numbers being input into the cells.

## Formula Requirements

* When entering formulas, users should be able to reference a different line by using square brackets and specifying the account number OR account name for the line. For example: `[1_159]` OR `[Sales Revenue]`
* When referencing other cells, users should be able to reference a different column by using curly brackets and specifying the column heading. For example: `{2024 Budget}` or `{2025 Actuals}`
* Users should be able to reference different lines, or different columns, or BOTH in a single formula. For example: `[1_159].{2024 Budget}`
* Users should also be able to construct complex formulas and the rules of mathematics should be used to resolve the values for the given formulas. EG: `([1_159].{2024 Budget} + [1_483].{2024 Budget}) * 1.05`
* When the user starts editing a cell and they open a curly or square bracket, a dropdown should be shown allowing them to select a matching option instead of having to type the whole value. EG: If they type `[`, show the list of accounts. If they type `{`, show the list of columns.

## Configuration Requirements

* The developer should be able to configure Periods for the grid. Each column that is defined will be repeated for each Period, and the columns will be grouped by the said period.
* The user should also see a "Totals" group that contains the same columns that were defined for the Periods. For example:
```
Periods: [{ "id": "2101", "name": "January 2021" }, { "id": "2102", "name": "February 2021" }, { "id": "2103", "name": "Marc 2021" }]
Columns: [{ "id": "col1", "name": "2024 Budget" }, { "id": "col2", "name": "2024 Actual" }, { "id": "col3", "name": "2025 Budget" }]
```
These two arrays will produce 12 columns: Each of the Column objects for each of the Period objects, with a "Total" at the end. Note that I do NOT want to define 12 columns myself, I only want to define data columns and periods.

* The Totals columns should default to having a SUM formula for each of the respective columns across the grid, but a user should be able to override this SUM formula with a static value or a formula of their own.
* The user should be able to use a "Spread" formula in the Totals column: The Spread formula should take the amount entered and divide it evenly across the respective period columns. For example: If the user enters `=SPREAD(12000)` in the Total column for column `2026 Budget`, I expect to see each period (January through December) have a value of 1000: `12000 (amount entered) divided by 12 (number of configured periods)`

## Additional Input Requirements

* In the demo app, add a small area above the hierarchical grid to allow users to enter "key value pairs": A "label" and a "value". The users should be able to add values here for reference in the grid.
* With the above done, allow users to reference these variables by using them in formulas, for example: If the user added a label and value pair: `Budget.GLActuals1YearAgo` with a value of `10000`, they should be able to enter a cell and enter `=Budget.GLActuals1YearAgo` and the value of `10000` will be rendered for that cell.
* Finally: Only allow edits to lowest-level accounts that do not have children. All other accounts should show the SUM of the respective columns of their children as read-only values. To make this clear to users, fill the background of the "summed" lines in a different colour and make the text bold.

## Demo App

To demonstrate this grid control, create a WebAPI project using .NET 9 to serve the grid. The grid example project should therefore use a "real" API, however the API should use mock data for now. Let's start with 1000 accounts in various hierarchies, with six columns: 2024 Budget, 2024 Actual, 2025 Budget, 2025 Actual, 2026 Budget, 2026 Projected.