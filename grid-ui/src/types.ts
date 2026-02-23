// Types matching the backend API models

export interface CellData {
  numericValue: number | null;
  formula: string | null;
  displayValue: string;
}

export interface AccountTreeNode {
  accountNumber: string;
  accountName: string;
  parentAccountNumber: string | null;
  level: number;
  hasChildren: boolean;
  data: Record<string, CellData>;
}

export interface GridViewResponse {
  parent: AccountTreeNode;
  children: AccountTreeNode[];
  columns: string[];
}

export interface AccountSummary {
  accountNumber: string;
  accountName: string;
  parentAccountNumber: string | null;
  level: number;
  hasChildren: boolean;
  data: Record<string, CellData>;
}

export interface CellUpdateRequest {
  accountNumber: string;
  column: string;
  formula: string | null;
  numericValue: number | null;
}

export interface CellAddress {
  accountNumber: string;
  column: string;
}
