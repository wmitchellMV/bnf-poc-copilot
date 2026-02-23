import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { AccountTreeNode, AccountSummary, CellData } from './types';
import {
  evaluateFormula,
  getAutocompleteContext,
  isFormula,
  formatNumber,
} from './formulaEngine';
import './HierarchicalGrid.css';

export interface GridColumn {
  key: string;
  label: string;
  width?: number;
  frozen?: boolean;
}

interface HierarchicalGridProps {
  /** The parent account and its children to display */
  parentRow: AccountTreeNode;
  childRows: AccountTreeNode[];
  /** Column definitions for data columns */
  dataColumns: string[];
  /** Number of columns frozen to the left (includes Account # and Name) */
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
}

interface EditingCell {
  accountNumber: string;
  column: string;
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

export const HierarchicalGrid: React.FC<HierarchicalGridProps> = ({
  parentRow,
  childRows,
  dataColumns,
  frozenColumnCount = 2,
  allAccounts,
  onDrillDown,
  onDrillUp,
  onCellUpdate,
  allRows,
}) => {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [localData, setLocalData] = useState<Map<string, Map<string, CellData>>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const gridBodyRef = useRef<HTMLDivElement>(null);

  // Build all columns list: Account #, Account Name, then data columns
  const allColumns: GridColumn[] = [
    { key: '__accountNumber', label: 'Account #', width: 130, frozen: true },
    { key: '__accountName', label: 'Account Name', width: 220, frozen: true },
    ...dataColumns.map((col, idx) => ({
      key: col,
      label: col,
      width: 150,
      frozen: idx + 2 < frozenColumnCount,
    })),
  ];

  const frozenCols = allColumns.filter((c) => c.frozen);
  const scrollableCols = allColumns.filter((c) => !c.frozen);

  // Initialize local data from props
  useEffect(() => {
    const map = new Map<string, Map<string, CellData>>();
    const allVisibleRows = [parentRow, ...childRows];
    for (const row of allVisibleRows) {
      const colMap = new Map<string, CellData>();
      for (const [col, cell] of Object.entries(row.data)) {
        colMap.set(col, { ...cell });
      }
      map.set(row.accountNumber, colMap);
    }
    setLocalData(map);
  }, [parentRow, childRows]);

  // Get cell value, considering local edits
  const getCellValue = useCallback(
    (accountNumber: string, column: string): number | null => {
      // First check local data
      const localRow = localData.get(accountNumber);
      if (localRow) {
        const cell = localRow.get(column);
        if (cell) return cell.numericValue;
      }
      // Then check all rows currently displayed
      const row = allRows.find((r) => r.accountNumber === accountNumber);
      if (row && row.data[column]) {
        return row.data[column].numericValue;
      }
      // Finally check the full account dataset (for cross-view references)
      const account = allAccounts.find((a) => a.accountNumber === accountNumber);
      if (account && account.data[column]) {
        return account.data[column].numericValue;
      }
      return null;
    },
    [localData, allRows, allAccounts]
  );

  const getDisplayValue = useCallback(
    (row: AccountTreeNode, column: string): string => {
      const localRow = localData.get(row.accountNumber);
      if (localRow) {
        const cell = localRow.get(column);
        if (cell) {
          if (cell.formula) return cell.formula;
          if (cell.numericValue !== null) return formatNumber(cell.numericValue);
          return '';
        }
      }
      const cell = row.data[column];
      if (!cell) return '';
      if (cell.formula) return cell.formula;
      if (cell.numericValue !== null) return formatNumber(cell.numericValue);
      return '';
    },
    [localData]
  );

  const getNumericDisplay = useCallback(
    (row: AccountTreeNode, column: string): string => {
      const localRow = localData.get(row.accountNumber);
      if (localRow) {
        const cell = localRow.get(column);
        if (cell) {
          if (cell.formula) {
            // Evaluate the formula for display
            const result = evaluateFormula(
              cell.formula.startsWith('=') ? cell.formula.substring(1) : cell.formula,
              {
                allAccounts,
                currentAccountNumber: row.accountNumber,
                currentColumn: column,
                getCellValue,
              }
            );
            return result !== null ? formatNumber(result) : '#ERR';
          }
          if (cell.numericValue !== null) return formatNumber(cell.numericValue);
          return '';
        }
      }
      const cell = row.data[column];
      if (!cell) return '';
      if (cell.numericValue !== null) return formatNumber(cell.numericValue);
      return '';
    },
    [localData, allAccounts, getCellValue]
  );

  // Handle starting edit
  const startEditing = (accountNumber: string, column: string) => {
    // Don't allow editing fixed columns
    if (column === '__accountNumber' || column === '__accountName') return;

    const row = [parentRow, ...childRows].find(
      (r) => r.accountNumber === accountNumber
    );
    if (!row) return;

    const localRow = localData.get(accountNumber);
    const cell = localRow?.get(column) ?? row.data[column];
    const rawValue = cell?.formula
      ? cell.formula
      : cell?.numericValue !== null
      ? String(cell.numericValue)
      : '';

    setEditingCell({
      accountNumber,
      column,
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
          : dataColumns
              .filter((c) =>
                c.toLowerCase().includes(acContext.partial.toLowerCase())
              )
              .map((c) => ({ label: c, value: c }));

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

    // Find the opening bracket position
    const textBefore = value.substring(0, cursorPosition);
    const bracketPos = textBefore.lastIndexOf(bracket);

    if (bracketPos === -1) return;

    // Replace the partial text with the selected value
    const insertValue = autocomplete.type === 'account' ? item.value : item.value;
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

    // Re-focus input and set cursor
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
      // Move to next data column
      if (editingCell) {
        const currentIdx = dataColumns.indexOf(editingCell.column);
        const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
        if (nextIdx >= 0 && nextIdx < dataColumns.length) {
          startEditing(editingCell.accountNumber, dataColumns[nextIdx]);
        }
      }
    }
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { accountNumber, column, value } = editingCell;

    if (isFormula(value)) {
      // Store as formula
      const newCell: CellData = {
        formula: value,
        numericValue: null,
        displayValue: value,
      };
      // Try to evaluate the formula to get a numeric value
      const formulaText = value.startsWith('=') ? value.substring(1) : value;
      const evaluated = evaluateFormula(formulaText, {
        allAccounts,
        currentAccountNumber: accountNumber,
        currentColumn: column,
        getCellValue,
      });
      if (evaluated !== null) {
        newCell.numericValue = evaluated;
      }
      updateLocalCell(accountNumber, column, newCell);
      onCellUpdate(accountNumber, column, value);
    } else {
      // Try to parse as a number
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
      const row = next.get(accountNumber) ?? new Map();
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

  // Render cell content
  const renderCell = (
    row: AccountTreeNode,
    colKey: string,
    isEditing: boolean
  ) => {
    if (colKey === '__accountNumber') {
      return (
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
      );
    }
    if (colKey === '__accountName') {
      return <span className="account-name" title={row.accountName}>{row.accountName}</span>;
    }

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          className="cell-input"
          value={editingCell?.value ?? ''}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay to allow autocomplete click
            setTimeout(() => {
              if (!autocomplete) commitEdit();
            }, 200);
          }}
        />
      );
    }

    const display = getNumericDisplay(row, colKey);
    const localRow = localData.get(row.accountNumber);
    const cell = localRow?.get(colKey) ?? row.data[colKey];
    const hasFormula = cell?.formula != null;

    return (
      <span
        className={`cell-value ${hasFormula ? 'has-formula' : ''} ${
          display === '#ERR' ? 'cell-error' : ''
        }`}
        title={hasFormula ? cell.formula! : undefined}
      >
        {display}
      </span>
    );
  };

  const rows = [parentRow, ...childRows];

  const frozenWidth = frozenCols.reduce((sum, c) => sum + (c.width ?? 150), 0);

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
      </div>

      {/* Grid Container */}
      <div className="grid-container">
        {/* Frozen Columns */}
        <div className="grid-frozen" style={{ width: frozenWidth }}>
          {/* Header */}
          <div className="grid-header-row">
            {frozenCols.map((col) => (
              <div
                key={col.key}
                className="grid-header-cell frozen-cell"
                style={{ width: col.width }}
              >
                {col.label}
              </div>
            ))}
          </div>
          {/* Body */}
          <div className="grid-body-frozen">
            {rows.map((row) => (
              <div
                key={row.accountNumber}
                className={`grid-row ${
                  row.accountNumber === parentRow.accountNumber
                    ? 'parent-row'
                    : 'child-row'
                }`}
              >
                {frozenCols.map((col) => (
                  <div
                    key={col.key}
                    className="grid-cell frozen-cell"
                    style={{ width: col.width }}
                    onDoubleClick={() =>
                      startEditing(row.accountNumber, col.key)
                    }
                  >
                    {renderCell(
                      row,
                      col.key,
                      editingCell?.accountNumber === row.accountNumber &&
                        editingCell?.column === col.key
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable Columns */}
        <div className="grid-scrollable" ref={gridBodyRef}>
          {/* Header */}
          <div className="grid-header-row">
            {scrollableCols.map((col) => (
              <div
                key={col.key}
                className="grid-header-cell"
                style={{ width: col.width }}
              >
                {col.label}
              </div>
            ))}
          </div>
          {/* Body */}
          <div className="grid-body-scrollable">
            {rows.map((row) => (
              <div
                key={row.accountNumber}
                className={`grid-row ${
                  row.accountNumber === parentRow.accountNumber
                    ? 'parent-row'
                    : 'child-row'
                }`}
              >
                {scrollableCols.map((col) => (
                  <div
                    key={col.key}
                    className="grid-cell"
                    style={{ width: col.width }}
                    onDoubleClick={() =>
                      startEditing(row.accountNumber, col.key)
                    }
                  >
                    {renderCell(
                      row,
                      col.key,
                      editingCell?.accountNumber === row.accountNumber &&
                        editingCell?.column === col.key
                    )}
                  </div>
                ))}
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
              className={`autocomplete-item ${
                idx === autocomplete.selectedIndex ? 'selected' : ''
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
    </div>
  );
};
