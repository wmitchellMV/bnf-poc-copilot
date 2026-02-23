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

## Demo App

To demonstrate this grid control, create a WebAPI project using .NET 9 to serve the grid. The grid example project should therefore use a "real" API, however the API should use mock data for now. Let's start with 1000 accounts in various hierarchies, with six columns: 2024 Budget, 2024 Actual, 2025 Budget, 2025 Actual, 2026 Budget, 2026 Projected.