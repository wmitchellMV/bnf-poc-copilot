// Types matching the backend API models

export interface CellData {
  numericValue: number | null;
  formula: string | null;
  displayValue: string;
}

export interface PeriodDef {
  id: string;
  name: string;
}

export interface ColumnDef {
  id: string;
  name: string;
}

export interface AccountTreeNode {
  accountNumber: string;
  accountName: string;
  parentAccountNumber: string | null;
  level: number;
  hasChildren: boolean;
  /** Data keyed by "periodId:columnId" or "total:columnId" */
  data: Record<string, CellData>;
}

export interface GridViewResponse {
  parent: AccountTreeNode;
  children: AccountTreeNode[];
  periods: PeriodDef[];
  columns: ColumnDef[];
  frozenColumnCount: number;
}

export interface GridConfigResponse {
  periods: PeriodDef[];
  columns: ColumnDef[];
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

export interface BatchCellUpdate {
  accountNumber: string;
  column: string;
  formula: string | null;
  numericValue: number | null;
}

export interface BatchSaveRequest {
  changes: BatchCellUpdate[];
}

export interface BatchSaveResponse {
  savedCount: number;
  success: boolean;
}

/** A node in a dependency tree */
export interface DependencyTreeNode {
  accountNumber: string;
  accountName: string;
  dataKey: string;
  columnLabel: string;
  formula: string | null;
  numericValue: number | null;
  /** Whether this is a leaf (static value / no further deps) */
  isLeaf: boolean;
  children: DependencyTreeNode[];
}

/** Represents a single cell change for the change log */
export interface CellChange {
  accountNumber: string;
  accountName: string;
  dataKey: string;
  columnLabel: string;
  oldFormula: string | null;
  oldValue: number | null;
  newFormula: string | null;
  newValue: number | null;
}

/**
 * A resolved column in the grid. The grid generates these from periods × columns + totals.
 * dataKey is the composite key used for data lookup (e.g. "2101:col1" or "total:col1").
 */
export interface ResolvedColumn {
  dataKey: string;
  label: string;
  periodId: string | null; // null for totals
  columnId: string;
  isTotal: boolean;
  groupName: string; // period name or "Totals"
}
