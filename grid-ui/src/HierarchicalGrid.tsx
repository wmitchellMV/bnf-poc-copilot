import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  AccountTreeNode,
  AccountSummary,
  CellData,
  PeriodDef,
  ColumnDef,
  ResolvedColumn,
  CellChange,
} from './types';
import {
  evaluateFormula,
  evaluateFormulaWithError,
  getAutocompleteContext,
  isFormula,
  formatNumber,
  parseSpread,
  parseCapAmount,
  buildLineTotalVariables,
  extractUnresolvedVariables,
} from './formulaEngine';
import type { ResolveContext } from './formulaEngine';
import { resolveApiVariable, batchSave } from './api';
import './HierarchicalGrid.css';

interface HierarchicalGridProps {
  /** The parent account and its children to display */
  parentRow: AccountTreeNode;
  childRows: AccountTreeNode[];
  /** Period definitions */
  periods: PeriodDef[];
  /** Column definitions (repeated for each period + totals) */
  columnDefs: ColumnDef[];
  /** Number of frozen columns to the left (includes Account # and Name) */
  frozenColumnCount?: number;
  /** All accounts for formula resolution */
  allAccounts: AccountSummary[];
  /** Callback when user navigates into a child account */
  onDrillDown: (accountNumber: string) => void;
  /** Callback when user navigates up to the parent */
  onDrillUp: (parentAccountNumber: string) => void;
  /** Callback when a cell is updated */
  onCellUpdate: (
    accountNumber: string,
    column: string,
    value: string
  ) => void;
  /** All rows for cell value lookup across the entire dataset */
  allRows: AccountTreeNode[];
  /** User-defined variables for formula resolution */
  variables?: Map<string, number>;
}

interface EditingCell {
  accountNumber: string;
  column: string; // dataKey
  value: string;
  cursorPosition: number;
}

interface AutocompleteState {
  type: 'account' | 'column';
  partial: string;
  items: { label: string; value: string }[];
  selectedIndex: number;
  position: { top: number; left: number };
}

/** Column group for the two-tier header */
interface ColumnGroup {
  groupName: string;
  periodId: string | null;
  isTotal: boolean;
  columns: ResolvedColumn[];
}

const CELL_WIDTH = 140;
const ACCT_NUM_WIDTH = 130;
const ACCT_NAME_WIDTH = 220;
const MIN_CELL_WIDTH = 60;

export const HierarchicalGrid: React.FC<HierarchicalGridProps> = ({
  parentRow,
  childRows,
  periods,
  columnDefs,
  frozenColumnCount = 2,
  allAccounts,
  onDrillDown,
  onDrillUp,
  onCellUpdate,
  allRows,
  variables,
}) => {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [localData, setLocalData] = useState<Map<string, Map<string, CellData>>>(new Map());
  const [periodViewMode, setPeriodViewMode] = useState<'show' | 'hide' | 'page'>('show');
  const [currentPeriodPage, setCurrentPeriodPage] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Map<string, number>>(new Map());
  const [apiVarCache, setApiVarCache] = useState<Map<string, number>>(new Map());
  const [loadingCells, setLoadingCells] = useState<Set<string>>(new Set());
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const initialDataRef = useRef<Map<string, Map<string, CellData>>>(new Map());
  const resizingRef = useRef<{ dataKey: string; startX: number; startWidth: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const frozenBodyRef = useRef<HTMLDivElement>(null);
  const scrollableBodyRef = useRef<HTMLDivElement>(null);

  // Build resolved columns: for each period × column + total × column
  const resolvedColumns: ResolvedColumn[] = useMemo(() => {
    const cols: ResolvedColumn[] = [];
    for (const period of periods) {
      for (const col of columnDefs) {
        cols.push({
          dataKey: `${period.id}:${col.id}`,
          label: col.name,
          periodId: period.id,
          columnId: col.id,
          isTotal: false,
          groupName: period.name,
        });
      }
    }
    // Totals group
    for (const col of columnDefs) {
      cols.push({
        dataKey: `total:${col.id}`,
        label: col.name,
        periodId: null,
        columnId: col.id,
        isTotal: true,
        groupName: 'Totals',
      });
    }
    return cols;
  }, [periods, columnDefs]);

  // Group columns for the two-tier header
  const columnGroups: ColumnGroup[] = useMemo(() => {
    const groups: ColumnGroup[] = [];
    for (const period of periods) {
      groups.push({
        groupName: period.name,
        periodId: period.id,
        isTotal: false,
        columns: resolvedColumns.filter(
          (c) => c.periodId === period.id && !c.isTotal
        ),
      });
    }
    groups.push({
      groupName: 'Totals',
      periodId: null,
      isTotal: true,
      columns: resolvedColumns.filter((c) => c.isTotal),
    });
    return groups;
  }, [periods, resolvedColumns]);

  // Filter column groups based on periodViewMode
  const visibleColumnGroups: ColumnGroup[] = useMemo(() => {
    if (periodViewMode === 'hide') {
      return columnGroups.filter((g) => g.isTotal);
    }
    if (periodViewMode === 'page') {
      const periodGroups = columnGroups.filter((g) => !g.isTotal);
      const totalsGroup = columnGroups.find((g) => g.isTotal);
      const pageGroup = periodGroups[currentPeriodPage] ?? periodGroups[0];
      const result: ColumnGroup[] = [];
      if (pageGroup) result.push(pageGroup);
      if (totalsGroup) result.push(totalsGroup);
      return result;
    }
    // 'show' — all groups
    return columnGroups;
  }, [columnGroups, periodViewMode, currentPeriodPage]);

  // Total number of period groups (for paging)
  const periodGroupCount = useMemo(
    () => columnGroups.filter((g) => !g.isTotal).length,
    [columnGroups]
  );

  // All data column keys for Tab navigation
  const allDataKeys = useMemo(
    () => resolvedColumns.map((c) => c.dataKey),
    [resolvedColumns]
  );

  // Initialize local data from props
  useEffect(() => {
    const map = new Map<string, Map<string, CellData>>();
    const snapshot = new Map<string, Map<string, CellData>>();
    const allVisibleRows = [parentRow, ...childRows];
    for (const row of allVisibleRows) {
      const colMap = new Map<string, CellData>();
      const snapColMap = new Map<string, CellData>();
      for (const [col, cell] of Object.entries(row.data)) {
        colMap.set(col, { ...cell });
        snapColMap.set(col, { ...cell });
      }
      map.set(row.accountNumber, colMap);
      snapshot.set(row.accountNumber, snapColMap);
    }
    setLocalData(map);
    initialDataRef.current = snapshot;
  }, [parentRow, childRows]);

  // Get cell value, considering local edits
  const getCellValue = useCallback(
    (accountNumber: string, column: string): number | null => {
      const localRow = localData.get(accountNumber);
      if (localRow) {
        const cell = localRow.get(column);
        if (cell) return cell.numericValue;
      }
      const row = allRows.find((r) => r.accountNumber === accountNumber);
      if (row && row.data[column]) {
        return row.data[column].numericValue;
      }
      const account = allAccounts.find((a) => a.accountNumber === accountNumber);
      if (account && account.data[column]) {
        return account.data[column].numericValue;
      }
      return null;
    },
    [localData, allRows, allAccounts]
  );

  // Build a resolve context for the formula engine
  const makeResolveContext = useCallback(
    (accountNumber: string, dataKey: string): ResolveContext => {
      // Merge user-defined variables with auto-generated LineTotalN variables
      const lineTotals = buildLineTotalVariables(accountNumber, columnDefs, getCellValue);
      const mergedVars = new Map<string, number>(lineTotals);
      if (variables) {
        for (const [k, v] of variables) {
          mergedVars.set(k, v);
        }
      }
      // Inject cached API-resolved variables for this cell context
      for (const [cacheKey, val] of apiVarCache) {
        // Cache key format: "varName|accountNumber|periodId|columnId"
        // We inject all cached entries whose account matches, keyed by variable name
        const parts = cacheKey.split('|');
        if (parts.length === 4 && parts[1] === accountNumber) {
          // Match on period/column from the dataKey
          const [periodOrTotal, colId] = dataKey.split(':');
          if (parts[2] === periodOrTotal && parts[3] === colId) {
            mergedVars.set(parts[0], val);
          }
        }
      }
      return {
        allAccounts,
        currentAccountNumber: accountNumber,
        currentColumn: dataKey,
        getCellValue,
        resolvedColumns,
        periods,
        variables: mergedVars,
      };
    },
    [allAccounts, getCellValue, resolvedColumns, periods, variables, columnDefs, apiVarCache]
  );

  const getNumericDisplay = useCallback(
    (row: AccountTreeNode, dataKey: string): { display: string; error: string | null } => {
      const localRow = localData.get(row.accountNumber);
      const cell = localRow?.get(dataKey) ?? row.data[dataKey];
      if (!cell) return { display: '', error: null };

      if (cell.formula) {
        const formulaText = cell.formula.startsWith('=')
          ? cell.formula.substring(1)
          : cell.formula;

        // CapAmount and SPREAD formulas store the computed numericValue at commit time.
        // Display the stored value instead of re-evaluating (which would return the total).
        if (/^(CapAmount|SPREAD)\(/i.test(formulaText) && cell.numericValue !== null) {
          return { display: formatNumber(cell.numericValue), error: null };
        }

        const result = evaluateFormulaWithError(
          formulaText,
          makeResolveContext(row.accountNumber, dataKey)
        );
        if (result.value !== null) {
          return { display: formatNumber(result.value), error: null };
        }
        return { display: '#ERR', error: result.error ?? 'Unknown formula error' };
      }
      if (cell.numericValue !== null) return { display: formatNumber(cell.numericValue), error: null };
      return { display: '', error: null };
    },
    [localData, makeResolveContext]
  );

  // Derive list of changes by comparing localData to initial snapshot
  const changes: CellChange[] = useMemo(() => {
    const result: CellChange[] = [];
    const rows = [parentRow, ...childRows];
    for (const [acctNum, colMap] of localData) {
      const initColMap = initialDataRef.current.get(acctNum);
      const row = rows.find((r) => r.accountNumber === acctNum);
      const acctName = row?.accountName ?? acctNum;
      for (const [dataKey, cell] of colMap) {
        const initCell = initColMap?.get(dataKey);
        const oldFormula = initCell?.formula ?? null;
        const oldValue = initCell?.numericValue ?? null;
        const newFormula = cell.formula ?? null;
        const newValue = cell.numericValue ?? null;
        // Detect change: formula changed, or numeric value changed
        const formulaChanged = oldFormula !== newFormula;
        const valueChanged = oldValue !== newValue;
        if (formulaChanged || valueChanged) {
          // Find a human-readable column label
          const resolvedCol = resolvedColumns.find((c) => c.dataKey === dataKey);
          const colLabel = resolvedCol
            ? `${resolvedCol.groupName} › ${resolvedCol.label}`
            : dataKey;
          result.push({
            accountNumber: acctNum,
            accountName: acctName,
            dataKey,
            columnLabel: colLabel,
            oldFormula,
            oldValue,
            newFormula,
            newValue,
          });
        }
      }
    }
    return result;
  }, [localData, parentRow, childRows, resolvedColumns]);

  // Save handler: batch-save all changes via API
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const batchChanges = changes.map((c) => ({
        accountNumber: c.accountNumber,
        column: c.dataKey,
        formula: c.newFormula,
        numericValue: c.newValue,
      }));
      await batchSave({ changes: batchChanges });
      // After successful save, update the snapshot to current state
      const snapshot = new Map<string, Map<string, CellData>>();
      for (const [acctNum, colMap] of localData) {
        const snapColMap = new Map<string, CellData>();
        for (const [col, cell] of colMap) {
          snapColMap.set(col, { ...cell });
        }
        snapshot.set(acctNum, snapColMap);
      }
      initialDataRef.current = snapshot;
    } catch (err) {
      console.error('Failed to save changes:', err);
    } finally {
      setSaving(false);
      setShowSaveModal(false);
    }
  }, [changes, localData]);

  // Reset handler: restore localData to initial snapshot
  const handleReset = useCallback(() => {
    const restored = new Map<string, Map<string, CellData>>();
    for (const [acctNum, colMap] of initialDataRef.current) {
      const restoredColMap = new Map<string, CellData>();
      for (const [col, cell] of colMap) {
        restoredColMap.set(col, { ...cell });
      }
      restored.set(acctNum, restoredColMap);
    }
    setLocalData(restored);
    setApiVarCache(new Map());
    setLoadingCells(new Set());
    setShowResetModal(false);
  }, []);

  // Handle starting edit — only allow on leaf accounts (no children)
  const startEditing = (accountNumber: string, dataKey: string) => {
    const row = [parentRow, ...childRows].find(
      (r) => r.accountNumber === accountNumber
    );
    if (!row) return;
    // Prevent editing on accounts that have children (summary rows)
    if (row.hasChildren) return;

    const localRow = localData.get(accountNumber);
    const cell = localRow?.get(dataKey) ?? row.data[dataKey];
    const rawValue = cell?.formula
      ? cell.formula
      : cell?.numericValue !== null
        ? String(cell.numericValue)
        : '';

    setEditingCell({
      accountNumber,
      column: dataKey,
      value: rawValue,
      cursorPosition: rawValue.length,
    });
    setAutocomplete(null);
  };

  // Focus on the input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        editingCell.value.length,
        editingCell.value.length
      );
    }
  }, [editingCell?.accountNumber, editingCell?.column]);

  // Handle input change during edit
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingCell) return;
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart ?? newValue.length;

    setEditingCell({ ...editingCell, value: newValue, cursorPosition: cursorPos });

    // Check for autocomplete
    const acContext = getAutocompleteContext(newValue, cursorPos);
    if (acContext) {
      const items =
        acContext.type === 'account'
          ? allAccounts
            .filter(
              (a) =>
                a.accountNumber
                  .toLowerCase()
                  .includes(acContext.partial.toLowerCase()) ||
                a.accountName
                  .toLowerCase()
                  .includes(acContext.partial.toLowerCase())
            )
            .slice(0, 20)
            .map((a) => ({
              label: `${a.accountNumber}: ${a.accountName}`,
              value: a.accountNumber,
            }))
          : resolvedColumns
            .filter((c) =>
              c.label.toLowerCase().includes(acContext.partial.toLowerCase()) ||
              c.dataKey.toLowerCase().includes(acContext.partial.toLowerCase()) ||
              c.groupName.toLowerCase().includes(acContext.partial.toLowerCase())
            )
            .slice(0, 20)
            .map((c) => ({
              label: `${c.groupName} › ${c.label}`,
              value: c.dataKey,
            }));

      if (items.length > 0) {
        const inputEl = inputRef.current;
        const rect = inputEl?.getBoundingClientRect();
        setAutocomplete({
          type: acContext.type,
          partial: acContext.partial,
          items,
          selectedIndex: 0,
          position: {
            top: (rect?.bottom ?? 0) + 2,
            left: rect?.left ?? 0,
          },
        });
      } else {
        setAutocomplete(null);
      }
    } else {
      setAutocomplete(null);
    }
  };

  // Handle autocomplete selection
  const selectAutocompleteItem = (item: { label: string; value: string }) => {
    if (!editingCell || !autocomplete) return;

    const { value, cursorPosition } = editingCell;
    const bracket = autocomplete.type === 'account' ? '[' : '{';
    const closeBracket = autocomplete.type === 'account' ? ']' : '}';

    const textBefore = value.substring(0, cursorPosition);
    const bracketPos = textBefore.lastIndexOf(bracket);
    if (bracketPos === -1) return;

    const insertValue = item.value;
    const newValue =
      value.substring(0, bracketPos + 1) +
      insertValue +
      closeBracket +
      value.substring(cursorPosition);

    const newCursorPos = bracketPos + 1 + insertValue.length + 1;

    setEditingCell({
      ...editingCell,
      value: newValue,
      cursorPosition: newCursorPos,
    });
    setAutocomplete(null);

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // Handle keyboard events during editing
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete({
          ...autocomplete,
          selectedIndex: Math.min(
            autocomplete.selectedIndex + 1,
            autocomplete.items.length - 1
          ),
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete({
          ...autocomplete,
          selectedIndex: Math.max(autocomplete.selectedIndex - 1, 0),
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectAutocompleteItem(autocomplete.items[autocomplete.selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(null);
        return;
      }
    }

    if (e.key === 'Enter') {
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      if (editingCell) {
        const currentIdx = allDataKeys.indexOf(editingCell.column);
        const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
        if (nextIdx >= 0 && nextIdx < allDataKeys.length) {
          startEditing(editingCell.accountNumber, allDataKeys[nextIdx]);
        }
      }
    }
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { accountNumber, column, value } = editingCell;

    // Find the resolved column to check if this is a totals column
    const resolvedCol = resolvedColumns.find((c) => c.dataKey === column);
    const isTotalCol = resolvedCol?.isTotal ?? false;

    if (isFormula(value)) {
      const formulaText = value.startsWith('=') ? value.substring(1) : value;

      // Check for SPREAD formula in total columns
      if (isTotalCol && resolvedCol) {
        const context = makeResolveContext(accountNumber, column);
        const spread = parseSpread(formulaText, periods.length, context);
        if (spread) {
          // Set each period column to perPeriod value
          const colId = resolvedCol.columnId;
          for (const period of periods) {
            const periodKey = `${period.id}:${colId}`;
            const periodCell: CellData = {
              formula: null,
              numericValue: spread.perPeriod,
              displayValue: formatNumber(spread.perPeriod),
            };
            updateLocalCell(accountNumber, periodKey, periodCell);
            onCellUpdate(accountNumber, periodKey, String(spread.perPeriod));
          }
          // Keep the original SPREAD formula in the total cell
          const totalCell: CellData = {
            formula: value,
            numericValue: spread.totalAmount,
            displayValue: value,
          };
          updateLocalCell(accountNumber, column, totalCell);
          onCellUpdate(accountNumber, column, value);
          setEditingCell(null);
          setAutocomplete(null);
          return;
        }
      }

      // Check for CapAmount formula in a period cell
      if (!isTotalCol && resolvedCol) {
        const capMatch = formulaText.match(/^CapAmount\((.+),\s*(.+)\)$/i);
        if (capMatch) {
          // Determine which period this cell belongs to and its index
          const currentPeriodId = resolvedCol.periodId;
          const startIdx = periods.findIndex((p) => p.id === currentPeriodId);
          if (startIdx >= 0) {
            const context = makeResolveContext(accountNumber, column);
            const capResult = parseCapAmount(formulaText, periods, startIdx, context);
            if (capResult) {
              const colId = resolvedCol.columnId;
              // Set each period from startIdx onward with capped amounts
              for (let i = startIdx; i < periods.length; i++) {
                const periodKey = `${periods[i].id}:${colId}`;
                const amount = capResult.perPeriodAmounts.get(periods[i].id) ?? 0;
                const periodCell: CellData = {
                  formula: i === startIdx ? value : null,
                  numericValue: amount,
                  displayValue: i === startIdx ? value : formatNumber(amount),
                };
                updateLocalCell(accountNumber, periodKey, periodCell);
                onCellUpdate(accountNumber, periodKey, i === startIdx ? value : String(amount));
              }
              // Update the total cell with the capped total
              const totalKey = `total:${colId}`;
              const totalCell: CellData = {
                formula: null,
                numericValue: capResult.totalAmount,
                displayValue: formatNumber(capResult.totalAmount),
              };
              updateLocalCell(accountNumber, totalKey, totalCell);
              onCellUpdate(accountNumber, totalKey, String(capResult.totalAmount));
              setEditingCell(null);
              setAutocomplete(null);
              return;
            }
          }
        }
      }

      // Regular formula
      const context = makeResolveContext(accountNumber, column);
      const newCell: CellData = {
        formula: value,
        numericValue: null,
        displayValue: value,
      };
      const evaluated = evaluateFormula(formulaText, context);
      if (evaluated !== null) {
        newCell.numericValue = evaluated;
        updateLocalCell(accountNumber, column, newCell);
        onCellUpdate(accountNumber, column, value);
      } else {
        // Check if there are unresolved variable-like tokens that could be API variables
        const unresolved = extractUnresolvedVariables(formulaText, context);
        if (unresolved.length > 0) {
          // Store the formula immediately, show loading
          updateLocalCell(accountNumber, column, newCell);
          onCellUpdate(accountNumber, column, value);
          const cellKey = `${accountNumber}|${column}`;
          setLoadingCells((prev) => new Set(prev).add(cellKey));

          // Parse periodId and columnId from the dataKey
          const [periodOrTotal, colId] = column.split(':');

          // Fire async API calls for each unresolved variable
          const apiCalls = unresolved.map((varName) =>
            resolveApiVariable(varName, accountNumber, periodOrTotal, colId).then(
              (val) => ({ varName, val })
            )
          );

          Promise.all(apiCalls).then((results) => {
            // Build a temporary variables map with the API results
            const apiVars = new Map<string, number>();
            for (const { varName, val } of results) {
              if (val !== null) {
                apiVars.set(varName, val);
              }
            }

            setApiVarCache((prev) => {
              const next = new Map(prev);
              for (const { varName, val } of results) {
                if (val !== null) {
                  const cacheKey = `${varName}|${accountNumber}|${periodOrTotal}|${colId}`;
                  next.set(cacheKey, val);
                }
              }
              return next;
            });

            // Re-evaluate the formula with the API variables injected
            // and update the cell's numericValue so parent summaries pick it up
            const enrichedContext: ResolveContext = {
              ...context,
              variables: new Map([
                ...(context.variables ?? []),
                ...apiVars,
              ]),
            };
            const resolvedValue = evaluateFormula(formulaText, enrichedContext);
            if (resolvedValue !== null) {
              updateLocalCell(accountNumber, column, {
                formula: value,
                numericValue: resolvedValue,
                displayValue: formatNumber(resolvedValue),
              });
            }

            // Remove loading state — the cell will re-render with the cached value
            setLoadingCells((prev) => {
              const next = new Set(prev);
              next.delete(cellKey);
              return next;
            });
          });
        } else {
          updateLocalCell(accountNumber, column, newCell);
          onCellUpdate(accountNumber, column, value);
        }
      }
    } else {
      const num = parseFloat(value);
      const newCell: CellData = {
        formula: null,
        numericValue: isNaN(num) ? null : num,
        displayValue: isNaN(num) ? value : formatNumber(num),
      };
      updateLocalCell(accountNumber, column, newCell);
      onCellUpdate(accountNumber, column, value);
    }

    setEditingCell(null);
    setAutocomplete(null);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setAutocomplete(null);
  };

  const updateLocalCell = (
    accountNumber: string,
    column: string,
    cell: CellData
  ) => {
    setLocalData((prev) => {
      const next = new Map(prev);
      const row = new Map(next.get(accountNumber) ?? new Map());
      row.set(column, cell);
      next.set(accountNumber, row);
      return next;
    });
  };

  // Close autocomplete on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setAutocomplete(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Sync vertical scroll between frozen and scrollable bodies
  useEffect(() => {
    const scrollable = scrollableBodyRef.current;
    const frozen = frozenBodyRef.current;
    if (!scrollable || !frozen) return;

    const onScroll = () => {
      if (frozen) frozen.scrollTop = scrollable.scrollTop;
    };
    scrollable.addEventListener('scroll', onScroll);
    return () => scrollable.removeEventListener('scroll', onScroll);
  }, []);

  // Column resize: get width for a column (use custom width or default)
  const getColWidth = useCallback(
    (dataKey: string) => columnWidths.get(dataKey) ?? CELL_WIDTH,
    [columnWidths]
  );

  // Column resize: compute group header width (sum of its column widths)
  const getGroupWidth = useCallback(
    (columns: ResolvedColumn[]) =>
      columns.reduce((sum, c) => sum + getColWidth(c.dataKey), 0),
    [getColWidth]
  );

  // Column resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, dataKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidth = columnWidths.get(dataKey) ?? CELL_WIDTH;
      resizingRef.current = { dataKey, startX: e.clientX, startWidth };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const diff = ev.clientX - resizingRef.current.startX;
        const newWidth = Math.max(MIN_CELL_WIDTH, resizingRef.current.startWidth + diff);
        setColumnWidths((prev) => {
          const next = new Map(prev);
          next.set(resizingRef.current!.dataKey, newWidth);
          return next;
        });
      };

      const onMouseUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [columnWidths]
  );

  // For a summary row (hasChildren), compute the SUM of direct children for a column
  const getSummaryDisplay = useCallback(
    (
      row: AccountTreeNode,
      dataKey: string
    ): { value: string; formula: string } => {
      // Find direct children of this account
      const children =
        row.accountNumber === parentRow.accountNumber
          ? childRows
          : allAccounts.filter(
              (a) => a.parentAccountNumber === row.accountNumber
            );

      let sum = 0;
      const refs: string[] = [];
      for (const child of children) {
        refs.push(`[${child.accountNumber}]`);
        const val = getCellValue(child.accountNumber, dataKey);
        if (val !== null) sum += val;
      }
      const formula = `SUM(${refs.join(',')})`;
      return {
        value: formatNumber(Math.round(sum * 100) / 100),
        formula,
      };
    },
    [parentRow, childRows, allAccounts, getCellValue]
  );

  // Render cell content
  const renderCell = (
    row: AccountTreeNode,
    dataKey: string,
    isEditing: boolean
  ) => {
    if (isEditing) {
      return (
        <input
          ref={inputRef}
          className="cell-input"
          value={editingCell?.value ?? ''}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setTimeout(() => {
              if (!autocomplete) commitEdit();
            }, 200);
          }}
        />
      );
    }

    // Show loading spinner while API variable is being resolved
    const cellKey = `${row.accountNumber}|${dataKey}`;
    if (loadingCells.has(cellKey)) {
      return (
        <span className="cell-loading" title="Calculating...">
          <span className="cell-spinner" />
        </span>
      );
    }

    // Summary rows: show SUM of children with tooltip formula
    if (row.hasChildren) {
      const summary = getSummaryDisplay(row, dataKey);
      return (
        <span
          className="cell-value has-formula"
          title={`=${summary.formula}`}
        >
          {summary.value}
        </span>
      );
    }

    const { display, error } = getNumericDisplay(row, dataKey);
    const localRow = localData.get(row.accountNumber);
    const cell = localRow?.get(dataKey) ?? row.data[dataKey];
    const hasFormula = cell?.formula != null;

    // Build tooltip: show formula or error details
    let tooltip: string | undefined;
    if (error) {
      tooltip = `Error: ${error}${hasFormula ? `\nFormula: ${cell.formula}` : ''}`;
    } else if (hasFormula) {
      tooltip = cell.formula!;
    }

    return (
      <span
        className={`cell-value ${hasFormula ? 'has-formula' : ''} ${display === '#ERR' ? 'cell-error' : ''
          }`}
        title={tooltip}
      >
        {display}
      </span>
    );
  };

  const rows = [parentRow, ...childRows];
  const frozenWidth = ACCT_NUM_WIDTH + ACCT_NAME_WIDTH;

  return (
    <div className="hierarchical-grid">
      {/* Breadcrumb / Navigation */}
      <div className="grid-toolbar">
        {parentRow.parentAccountNumber && (
          <button
            className="nav-btn"
            onClick={() => onDrillUp(parentRow.parentAccountNumber!)}
          >
            ← Back to Parent
          </button>
        )}
        <span className="current-path">
          Viewing: <strong>{parentRow.accountNumber}</strong> —{' '}
          {parentRow.accountName}
          {parentRow.level > 0 && (
            <span className="level-badge">Level {parentRow.level}</span>
          )}
        </span>
        <div className="toolbar-actions">
          <button
            className="nav-btn save-btn"
            disabled={changes.length === 0 || saving}
            onClick={() => setShowSaveModal(true)}
            title={changes.length === 0 ? 'No changes to save' : `Save ${changes.length} change(s)`}
          >
            {saving ? '⏳ Saving...' : `💾 Save (${changes.length})`}
          </button>
          <button
            className="nav-btn reset-btn"
            disabled={changes.length === 0}
            onClick={() => setShowResetModal(true)}
            title={changes.length === 0 ? 'No changes to discard' : `Discard ${changes.length} change(s)`}
          >
            🔄 Reset ({changes.length})
          </button>
        </div>
        <div className="period-controls">
          <select
            className="nav-btn period-mode-select"
            value={periodViewMode}
            onChange={(e) => {
              const mode = e.target.value as 'show' | 'hide' | 'page';
              setPeriodViewMode(mode);
              if (mode === 'page') setCurrentPeriodPage(0);
            }}
          >
            <option value="show">Show Periods</option>
            <option value="hide">Hide Periods</option>
            <option value="page">Page Periods</option>
          </select>
          {periodViewMode === 'page' && (
            <span className="period-pager">
              <button
                className="nav-btn page-btn"
                disabled={currentPeriodPage <= 0}
                onClick={() => setCurrentPeriodPage((p) => p - 1)}
              >
                ◀
              </button>
              <span className="page-indicator">
                {columnGroups.filter((g) => !g.isTotal)[currentPeriodPage]?.groupName ?? ''}
                {' '}({currentPeriodPage + 1}/{periodGroupCount})
              </span>
              <button
                className="nav-btn page-btn"
                disabled={currentPeriodPage >= periodGroupCount - 1}
                onClick={() => setCurrentPeriodPage((p) => p + 1)}
              >
                ▶
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Grid Container */}
      <div className="grid-container">
        {/* Frozen Columns (Account # + Account Name) */}
        <div className="grid-frozen" style={{ width: frozenWidth }}>
          {/* Two-tier header: group row + column row */}
          <div className="grid-header-group-row frozen-header-group">
            <div
              className="grid-header-group-cell frozen-group-cell"
              style={{ width: frozenWidth }}
            >
              &nbsp;
            </div>
          </div>
          <div className="grid-header-row">
            <div
              className="grid-header-cell frozen-cell"
              style={{ width: ACCT_NUM_WIDTH }}
            >
              Account #
            </div>
            <div
              className="grid-header-cell frozen-cell"
              style={{ width: ACCT_NAME_WIDTH }}
            >
              Account Name
            </div>
          </div>

          {/* Frozen body */}
          <div className="grid-body-frozen" ref={frozenBodyRef}>
            {rows.map((row) => (
              <div
                key={row.accountNumber}
                className={`grid-row ${row.accountNumber === parentRow.accountNumber
                  ? 'parent-row'
                  : 'child-row'
                  } ${row.hasChildren ? 'summary-row' : ''}`}
              >
                <div
                  className="grid-cell frozen-cell"
                  style={{ width: ACCT_NUM_WIDTH }}
                >
                  <span className="account-number">
                    {row.hasChildren ? (
                      <button
                        className="drill-btn"
                        onClick={() => onDrillDown(row.accountNumber)}
                        title="View children"
                      >
                        ▶
                      </button>
                    ) : (
                      <span className="drill-spacer" />
                    )}
                    {row.accountNumber}
                  </span>
                </div>
                <div
                  className="grid-cell frozen-cell"
                  style={{ width: ACCT_NAME_WIDTH }}
                >
                  <span className="account-name" title={row.accountName}>
                    {row.accountName}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable Columns */}
        <div className="grid-scrollable">
          {/* Group header row (period names) */}
          <div className="grid-header-group-row">
            {visibleColumnGroups.map((group) => (
              <div
                key={group.groupName}
                className={`grid-header-group-cell ${group.isTotal ? 'totals-group' : ''
                  }`}
                style={{ width: getGroupWidth(group.columns) }}
              >
                {group.groupName}
              </div>
            ))}
          </div>

          {/* Column header row (column names within each group) */}
          <div className="grid-header-row">
            {visibleColumnGroups.flatMap((group) =>
              group.columns.map((col) => (
                <div
                  key={col.dataKey}
                  className={`grid-header-cell ${col.isTotal ? 'totals-header' : ''
                    }`}
                  style={{ width: getColWidth(col.dataKey), position: 'relative' }}
                  title={`${col.groupName} › ${col.label}`}
                >
                  {col.label}
                  <div
                    className="col-resize-handle"
                    onMouseDown={(e) => handleResizeStart(e, col.dataKey)}
                  />
                </div>
              ))
            )}
          </div>

          {/* Data body */}
          <div className="grid-body-scrollable" ref={scrollableBodyRef}>
            {rows.map((row) => (
              <div
                key={row.accountNumber}
                className={`grid-row ${row.accountNumber === parentRow.accountNumber
                  ? 'parent-row'
                  : 'child-row'
                  } ${row.hasChildren ? 'summary-row' : ''}`}
              >
                {visibleColumnGroups.flatMap((group) =>
                  group.columns.map((col) => (
                    <div
                      key={col.dataKey}
                      className={`grid-cell ${col.isTotal ? 'totals-cell' : ''}`}
                      style={{ width: getColWidth(col.dataKey) }}
                      onDoubleClick={() =>
                        startEditing(row.accountNumber, col.dataKey)
                      }
                    >
                      {renderCell(
                        row,
                        col.dataKey,
                        editingCell?.accountNumber === row.accountNumber &&
                        editingCell?.column === col.dataKey
                      )}
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {autocomplete && autocomplete.items.length > 0 && (
        <div
          ref={autocompleteRef}
          className="autocomplete-dropdown"
          style={{
            position: 'fixed',
            top: autocomplete.position.top,
            left: autocomplete.position.left,
          }}
        >
          <div className="autocomplete-header">
            {autocomplete.type === 'account'
              ? 'Select Account'
              : 'Select Column'}
          </div>
          {autocomplete.items.map((item, idx) => (
            <div
              key={item.value}
              className={`autocomplete-item ${idx === autocomplete.selectedIndex ? 'selected' : ''
                }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectAutocompleteItem(item);
              }}
              onMouseEnter={() =>
                setAutocomplete({ ...autocomplete, selectedIndex: idx })
              }
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* Changes Panel */}
      {changes.length > 0 && (
        <div className="changes-panel">
          <div className="changes-header" onClick={() => setChangesCollapsed(!changesCollapsed)}>
            <span className="changes-toggle">{changesCollapsed ? '▶' : '▼'}</span>
            <h3 className="changes-title">
              Pending Changes ({changes.length})
            </h3>
          </div>
          {!changesCollapsed && (
            <div className="changes-table-wrap">
              <table className="changes-table">
                <thead>
                  <tr>
                    <th>Account #</th>
                    <th>Account Name</th>
                    <th>Column</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c, idx) => (
                    <tr key={`${c.accountNumber}-${c.dataKey}-${idx}`}>
                      <td className="change-acct">{c.accountNumber}</td>
                      <td className="change-name" title={c.accountName}>{c.accountName}</td>
                      <td className="change-col">{c.columnLabel}</td>
                      <td className="change-old">
                        {c.oldFormula
                          ? c.oldFormula
                          : c.oldValue !== null
                            ? formatNumber(c.oldValue)
                            : '—'}
                      </td>
                      <td className="change-new">
                        {c.newFormula
                          ? c.newFormula
                          : c.newValue !== null
                            ? formatNumber(c.newValue)
                            : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Save Confirmation Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Confirm Save</h3>
            <p className="modal-body">
              Are you sure you want to save <strong>{changes.length}</strong> change{changes.length !== 1 ? 's' : ''}?
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setShowSaveModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-confirm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Confirm Reset</h3>
            <p className="modal-body">
              Are you sure you want to discard <strong>{changes.length}</strong> change{changes.length !== 1 ? 's' : ''}?
              This will reload the grid to its original state.
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setShowResetModal(false)}
              >
                Cancel
              </button>
              <button
                className="modal-btn modal-btn-danger"
                onClick={handleReset}
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
