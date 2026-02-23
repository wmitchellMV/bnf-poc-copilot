import type { AccountTreeNode, AccountSummary } from './types';

/**
 * Formula Engine
 *
 * Supports formulas like:
 *   = 100 + 200
 *   = [1_159].{2024 Budget} + [1_483].{2024 Budget}
 *   = ([Sales Revenue].{2024 Budget} + [Fees Revenue].{2024 Budget}) * 1.05
 *   = [1_159] + 500       (same column implied)
 *   = {2024 Budget} * 1.1  (same row implied)
 *
 * Cell references:
 *   [accountNumberOrName]  - references a row
 *   {columnName}           - references a column
 *   [row].{col}            - references a specific cell
 */

export interface ResolveContext {
  /** All known accounts for looking up by number or name */
  allAccounts: AccountSummary[];
  /** Current row's account number */
  currentAccountNumber: string;
  /** Current column name */
  currentColumn: string;
  /** Function to get a cell's numeric value given account number and column */
  getCellValue: (accountNumber: string, column: string) => number | null;
}

/**
 * Evaluate a formula string and return a numeric result.
 * Returns null if the formula can't be resolved.
 */
export function evaluateFormula(
  formula: string,
  context: ResolveContext
): number | null {
  try {
    // If it's just a plain number, return it
    const plain = parseFloat(formula);
    if (!isNaN(plain) && formula.trim() === String(plain)) {
      return plain;
    }

    // Replace cell references with their numeric values
    const resolved = resolveReferences(formula, context);
    if (resolved === null) return null;

    // Evaluate the arithmetic expression safely
    return safeEval(resolved);
  } catch {
    return null;
  }
}

/**
 * Resolve all [row].{col}, [row], and {col} references in the formula
 * to their numeric values.
 */
function resolveReferences(
  formula: string,
  context: ResolveContext
): string | null {
  let result = formula;

  // Pattern: [rowRef].{colRef} — a fully qualified cell reference
  const fullRefPattern = /\[([^\]]+)\]\.\{([^}]+)\}/g;
  result = result.replace(fullRefPattern, (_match, rowRef: string, colRef: string) => {
    const accountNumber = resolveAccountRef(rowRef.trim(), context);
    if (!accountNumber) return 'NaN';
    const value = context.getCellValue(accountNumber, colRef.trim());
    return value !== null ? String(value) : 'NaN';
  });

  // Pattern: [rowRef] alone (same column)
  const rowRefPattern = /\[([^\]]+)\]/g;
  result = result.replace(rowRefPattern, (_match, rowRef: string) => {
    const accountNumber = resolveAccountRef(rowRef.trim(), context);
    if (!accountNumber) return 'NaN';
    const value = context.getCellValue(accountNumber, context.currentColumn);
    return value !== null ? String(value) : 'NaN';
  });

  // Pattern: {colRef} alone (same row)
  const colRefPattern = /\{([^}]+)\}/g;
  result = result.replace(colRefPattern, (_match, colRef: string) => {
    const value = context.getCellValue(
      context.currentAccountNumber,
      colRef.trim()
    );
    return value !== null ? String(value) : 'NaN';
  });

  if (result.includes('NaN')) return null;
  return result;
}

/**
 * Resolve an account reference (could be account number or name) to account number.
 */
function resolveAccountRef(
  ref: string,
  context: ResolveContext
): string | null {
  // Try direct account number match
  const byNumber = context.allAccounts.find(
    (a) => a.accountNumber === ref
  );
  if (byNumber) return byNumber.accountNumber;

  // Try account name match (case-insensitive)
  const byName = context.allAccounts.find(
    (a) => a.accountName.toLowerCase() === ref.toLowerCase()
  );
  if (byName) return byName.accountNumber;

  return null;
}

/**
 * Safely evaluate a simple arithmetic expression string.
 * Only supports: numbers, +, -, *, /, parentheses, whitespace.
 */
export function safeEval(expression: string): number | null {
  // Validate that expression only contains safe characters
  const sanitized = expression.replace(/\s/g, '');
  if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
    return null;
  }
  // Check for empty parentheses or invalid sequences
  if (/\(\)/.test(sanitized)) return null;

  try {
    // Use Function constructor for safe arithmetic evaluation
    // We've already validated only arithmetic chars are present
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return Math.round(result * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Extract bracket/brace tokens from formula text for autocomplete.
 * Returns the type of bracket being typed and the partial text inside.
 */
export function getAutocompleteContext(
  formula: string,
  cursorPosition: number
): { type: 'account' | 'column'; partial: string } | null {
  // Look backwards from cursor for an opening bracket or brace without a closing one
  const textBeforeCursor = formula.substring(0, cursorPosition);

  // Check for open square bracket (account ref)
  const lastOpenBracket = textBeforeCursor.lastIndexOf('[');
  const lastCloseBracket = textBeforeCursor.lastIndexOf(']');
  if (lastOpenBracket > lastCloseBracket) {
    const partial = textBeforeCursor.substring(lastOpenBracket + 1);
    return { type: 'account', partial };
  }

  // Check for open curly brace (column ref)
  const lastOpenBrace = textBeforeCursor.lastIndexOf('{');
  const lastCloseBrace = textBeforeCursor.lastIndexOf('}');
  if (lastOpenBrace > lastCloseBrace) {
    const partial = textBeforeCursor.substring(lastOpenBrace + 1);
    return { type: 'column', partial };
  }

  return null;
}

/**
 * Check if a value looks like a formula (starts with = or contains cell refs).
 */
export function isFormula(value: string): boolean {
  if (value.startsWith('=')) return true;
  if (/\[.*\]/.test(value)) return true;
  if (/\{.*\}/.test(value)) return true;
  return false;
}

/**
 * Format a number for display.
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Build a lookup map of all visible rows for fast cell value resolution.
 */
export function buildCellValueLookup(
  rows: AccountTreeNode[]
): Map<string, Map<string, number | null>> {
  const map = new Map<string, Map<string, number | null>>();
  for (const row of rows) {
    const colMap = new Map<string, number | null>();
    for (const [col, cell] of Object.entries(row.data)) {
      colMap.set(col, cell.numericValue);
    }
    map.set(row.accountNumber, colMap);
  }
  return map;
}
