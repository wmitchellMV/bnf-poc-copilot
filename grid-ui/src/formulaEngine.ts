import type { AccountTreeNode, AccountSummary, PeriodDef, ResolvedColumn, ColumnDef } from './types';

/**
 * Formula Engine
 *
 * Supports formulas like:
 *   = 100 + 200
 *   = [1_159].{2024 Budget} + [1_483].{2024 Budget}
 *   = ([Sales Revenue].{2024 Budget} + [Fees Revenue].{2024 Budget}) * 1.05
 *   = [1_159] + 500       (same column implied)
 *   = {2024 Budget} * 1.1  (same row implied)
 *   = SPREAD(12000)        (spread evenly across periods, only in Totals column)
 *   = SUM({2101:col1},{2102:col1},{2103:col1})  (sum explicit cell references)
 *   = ROUND(expression, decimals)  (round result to N decimal places)
 *   = CapAmount(amountPerPeriod, capTotal)  (fill periods forward until cap is reached)
 *
 * Cell references:
 *   [accountNumberOrName]  - references a row
 *   {columnName}           - references a column (uses the resolved column's dataKey)
 *   [row].{col}            - references a specific cell
 *
 * Data keys:
 *   "periodId:columnId" for period columns (e.g. "2101:col1")
 *   "total:columnId" for total columns (e.g. "total:col1")
 *
 * Internal variables (auto-generated per row):
 *   LineTotal1 .. LineTotalN — total column value for each column definition
 */

export interface ResolveContext {
  /** All known accounts for looking up by number or name */
  allAccounts: AccountSummary[];
  /** Current row's account number */
  currentAccountNumber: string;
  /** Current column's data key (e.g. "2101:col1" or "total:col1") */
  currentColumn: string;
  /** Function to get a cell's numeric value given account number and column data key */
  getCellValue: (accountNumber: string, column: string) => number | null;
  /** All resolved columns for looking up by label → dataKey */
  resolvedColumns: ResolvedColumn[];
  /** Period definitions for SPREAD calculations */
  periods: PeriodDef[];
  /** User-defined variables: label → numeric value */
  variables?: Map<string, number>;
}

/**
 * Evaluate a formula string and return a numeric result.
 * Returns null if the formula can't be resolved.
 */
export function evaluateFormula(
  formula: string,
  context: ResolveContext
): number | null {
  const result = evaluateFormulaWithError(formula, context);
  return result.value;
}

/**
 * Evaluate a formula and return both the result and any error message.
 */
export function evaluateFormulaWithError(
  formula: string,
  context: ResolveContext
): { value: number | null; error: string | null } {
  try {
    // If it's just a plain number, return it
    const trimmed = formula.trim();
    const plain = parseFloat(trimmed);
    if (!isNaN(plain) && trimmed === String(plain)) {
      return { value: plain, error: null };
    }

    // Check for ROUND(expression, decimals)
    const roundMatch = trimmed.match(/^ROUND\((.+),\s*(\d+)\)$/i);
    if (roundMatch) {
      const innerResult = evaluateFormulaWithError(roundMatch[1].trim(), context);
      if (innerResult.value === null) {
        return { value: null, error: innerResult.error ?? `Cannot evaluate inner expression: ${roundMatch[1]}` };
      }
      const decimals = parseInt(roundMatch[2], 10);
      const factor = Math.pow(10, decimals);
      return { value: Math.round(innerResult.value * factor) / factor, error: null };
    }

    // Check for SPREAD(amount) — only valid in total columns
    const spreadMatch = trimmed.match(/^SPREAD\((.+)\)$/i);
    if (spreadMatch) {
      const result = evaluateSpread(spreadMatch[1], context);
      if (result === null) {
        return { value: null, error: `SPREAD: cannot evaluate amount expression "${spreadMatch[1]}"` };
      }
      return { value: result, error: null };
    }

    // Check for CapAmount(amountPerPeriod, capTotal) — returns total capped amount
    const capMatch = trimmed.match(/^CapAmount\((.+),\s*(.+)\)$/i);
    if (capMatch) {
      return evaluateCapAmountTotal(capMatch[1].trim(), capMatch[2].trim(), context);
    }

    // Check for SUM({ref},{ref},...) — sum explicit cell references
    const sumMatch = trimmed.match(/^SUM\((.+)\)$/i);
    if (sumMatch) {
      const result = evaluateSum(sumMatch[1], context);
      if (result === null) {
        return { value: null, error: `SUM: no valid cell references found in "${sumMatch[1]}"` };
      }
      return { value: result, error: null };
    }

    // Replace cell references with their numeric values
    let resolved = resolveReferences(formula, context);
    if (resolved === null) {
      return { value: null, error: `Cannot resolve cell reference(s) in "${formula}"` };
    }

    // Replace user-defined variable references (e.g. Budget.GLActuals1YearAgo)
    resolved = resolveVariables(resolved, context);

    // Evaluate the arithmetic expression safely
    const evalResult = safeEval(resolved);
    if (evalResult === null) {
      return { value: null, error: `Cannot evaluate expression "${resolved}"` };
    }
    return { value: evalResult, error: null };
  } catch (e) {
    return { value: null, error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Evaluate SPREAD: returns the total amount (the individual period values
 * are set separately by the grid when committing the edit).
 * We return amount here since the Totals cell should display the full amount.
 */
function evaluateSpread(amountExpr: string, context: ResolveContext): number | null {
  // The amount expression could itself be a formula
  let resolved = resolveReferences(amountExpr, context);
  if (resolved === null) return null;

  // Resolve user-defined variables (e.g. SPREAD(William.Test))
  resolved = resolveVariables(resolved, context);

  const amount = safeEval(resolved);
  return amount;
}

/**
 * Evaluate SUM({ref},{ref},...): sum the explicit cell references for the current row.
 * Each ref inside the parentheses is a {dataKey} like {2101:col1}.
 */
function evaluateSum(argsStr: string, context: ResolveContext): number | null {
  // Extract all {dataKey} references from the arguments
  const refPattern = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  let sum = 0;
  let foundAny = false;

  while ((match = refPattern.exec(argsStr)) !== null) {
    foundAny = true;
    const dataKey = match[1];
    const val = context.getCellValue(context.currentAccountNumber, dataKey);
    if (val !== null) {
      sum += val;
    }
  }

  if (!foundAny) return null;
  return Math.round(sum * 1e8) / 1e8;
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
    const dataKey = resolveColumnRef(colRef.trim(), context);
    if (!dataKey) return 'NaN';
    const value = context.getCellValue(accountNumber, dataKey);
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
    const dataKey = resolveColumnRef(colRef.trim(), context);
    if (!dataKey) return 'NaN';
    const value = context.getCellValue(context.currentAccountNumber, dataKey);
    return value !== null ? String(value) : 'NaN';
  });

  if (result.includes('NaN')) return null;
  return result;
}

/**
 * Replace user-defined variable references in a formula string.
 * Variables are alphanumeric identifiers with dots (e.g. Budget.GLActuals1YearAgo).
 * They are replaced with their numeric values from the context.
 */
function resolveVariables(
  formula: string,
  context: ResolveContext
): string {
  if (!context.variables || context.variables.size === 0) return formula;

  // Sort variable names longest-first to avoid partial matches
  const sortedNames = [...context.variables.keys()].sort(
    (a, b) => b.length - a.length
  );

  let result = formula;
  for (const name of sortedNames) {
    const value = context.variables.get(name)!;
    // Use word-boundary-aware replacement: replace the variable name
    // only when it is NOT inside brackets/braces (those are already resolved)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'g');
    result = result.replace(pattern, String(value));
  }
  return result;
}

/**
 * After resolving all bracket references and known variables, extract any remaining
 * identifier-like tokens from a formula. These are potential API-based variable names.
 * Returns an array of unresolved variable-like tokens (e.g. ["GLActuals.1YearAgo"]).
 */
export function extractUnresolvedVariables(
  formula: string,
  context: ResolveContext
): string[] {
  const trimmed = formula.trim();

  // Strip known function prefixes so their inner args get checked
  let inner = trimmed;
  const funcPrefixes = [/^SPREAD\(/i, /^SUM\(/i, /^ROUND\(/i, /^CapAmount\(/i];
  for (const fp of funcPrefixes) {
    if (fp.test(inner)) {
      inner = inner.replace(fp, '').replace(/\)$/, '');
      break;
    }
  }

  // Resolve bracket/brace references first (replace with "0" placeholders)
  let resolved = inner.replace(/\[([^\]]+)\]\.\{([^}]+)\}/g, '0');
  resolved = resolved.replace(/\[([^\]]+)\]/g, '0');
  resolved = resolved.replace(/\{([^}]+)\}/g, '0');

  // Resolve known variables (replace with "0" so they don't appear as unresolved)
  if (context.variables && context.variables.size > 0) {
    const sortedNames = [...context.variables.keys()].sort(
      (a, b) => b.length - a.length
    );
    for (const name of sortedNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resolved = resolved.replace(new RegExp(escaped, 'g'), '0');
    }
  }

  // Now find remaining identifier-like tokens: word chars and dots, must contain a letter
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_.]*(?:\.[A-Za-z0-9_]+)*/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(resolved)) !== null) {
    const token = match[0];
    // Skip pure numbers or known math tokens
    if (/^\d+$/.test(token)) continue;
    if (!tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Resolve an account reference (could be account number or name) to account number.
 */
function resolveAccountRef(
  ref: string,
  context: ResolveContext
): string | null {
  const byNumber = context.allAccounts.find(
    (a) => a.accountNumber === ref
  );
  if (byNumber) return byNumber.accountNumber;

  const byName = context.allAccounts.find(
    (a) => a.accountName.toLowerCase() === ref.toLowerCase()
  );
  if (byName) return byName.accountNumber;

  return null;
}

/**
 * Resolve a column reference (display label) to its data key.
 * Matches against resolved column labels (e.g. "2024 Budget" could match
 * the current period's "2024 Budget" column, or a fully qualified label).
 */
function resolveColumnRef(
  ref: string,
  context: ResolveContext
): string | null {
  const lower = ref.toLowerCase();

  // First try exact match on label
  const exact = context.resolvedColumns.find(
    (c) => c.label.toLowerCase() === lower
  );
  if (exact) return exact.dataKey;

  // Try match on dataKey directly
  const byKey = context.resolvedColumns.find(
    (c) => c.dataKey.toLowerCase() === lower
  );
  if (byKey) return byKey.dataKey;

  // Try matching just the column name within the same period group
  const currentCol = context.resolvedColumns.find(
    (c) => c.dataKey === context.currentColumn
  );
  if (currentCol && currentCol.periodId) {
    // Same period, different column name
    const samePeriod = context.resolvedColumns.find(
      (c) =>
        c.periodId === currentCol.periodId &&
        c.label.toLowerCase() === lower
    );
    if (samePeriod) return samePeriod.dataKey;
  }

  return null;
}

/**
 * Safely evaluate a simple arithmetic expression string.
 * Only supports: numbers, +, -, *, /, parentheses, whitespace.
 * Results are rounded to 8 decimal places to avoid floating-point noise.
 */
export function safeEval(expression: string): number | null {
  const sanitized = expression.replace(/\s/g, '');
  if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
    return null;
  }
  if (/\(\)/.test(sanitized)) return null;

  try {
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return Math.round(result * 1e8) / 1e8;
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
  const textBeforeCursor = formula.substring(0, cursorPosition);

  const lastOpenBracket = textBeforeCursor.lastIndexOf('[');
  const lastCloseBracket = textBeforeCursor.lastIndexOf(']');
  if (lastOpenBracket > lastCloseBracket) {
    const partial = textBeforeCursor.substring(lastOpenBracket + 1);
    return { type: 'account', partial };
  }

  const lastOpenBrace = textBeforeCursor.lastIndexOf('{');
  const lastCloseBrace = textBeforeCursor.lastIndexOf('}');
  if (lastOpenBrace > lastCloseBrace) {
    const partial = textBeforeCursor.substring(lastOpenBrace + 1);
    return { type: 'column', partial };
  }

  return null;
}

/**
 * Check if a value looks like a formula.
 */
export function isFormula(value: string): boolean {
  if (value.startsWith('=')) return true;
  if (/\[.*\]/.test(value)) return true;
  if (/\{.*\}/.test(value)) return true;
  return false;
}

/**
 * Format a number for display.
 * Shows up to 8 decimal places, but at minimum 2.
 */
export function formatNumber(value: number): string {
  // If the value has more than 2 significant decimal digits, show them (up to 8)
  const maxDecimals = 8;
  const minDecimals = 2;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
}

/**
 * Parse a SPREAD formula and return the amount and period count.
 * Returns null if the formula is not a SPREAD formula.
 */
export function parseSpread(
  formula: string,
  periodCount: number,
  context: ResolveContext
): { totalAmount: number; perPeriod: number } | null {
  const trimmed = formula.trim();
  const match = trimmed.match(/^SPREAD\((.+)\)$/i);
  if (!match) return null;

  let amountExpr = match[1];

  // Resolve user-defined variables in the expression
  if (context.variables && context.variables.size > 0) {
    const sortedNames = [...context.variables.keys()].sort(
      (a, b) => b.length - a.length
    );
    for (const name of sortedNames) {
      const value = context.variables.get(name)!;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      amountExpr = amountExpr.replace(new RegExp(escaped, 'g'), String(value));
    }
  }

  const resolved = safeEval(amountExpr);
  if (resolved === null) return null;

  return {
    totalAmount: resolved,
    perPeriod: Math.round((resolved / periodCount) * 1e8) / 1e8,
  };
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

/**
 * Evaluate CapAmount for the total cell: returns the sum of all capped period values.
 * This is used when displaying a CapAmount formula in evaluation context.
 */
function evaluateCapAmountTotal(
  amountExpr: string,
  capExpr: string,
  context: ResolveContext
): { value: number | null; error: string | null } {
  // Resolve variable references and evaluate both arguments
  let resolvedAmount = resolveReferences(amountExpr, context);
  if (resolvedAmount === null) return { value: null, error: `CapAmount: cannot resolve amount expression "${amountExpr}"` };
  resolvedAmount = resolveVariables(resolvedAmount, context);
  const amountPerPeriod = safeEval(resolvedAmount);
  if (amountPerPeriod === null) return { value: null, error: `CapAmount: cannot evaluate amount "${amountExpr}"` };

  let resolvedCap = resolveReferences(capExpr, context);
  if (resolvedCap === null) return { value: null, error: `CapAmount: cannot resolve cap expression "${capExpr}"` };
  resolvedCap = resolveVariables(resolvedCap, context);
  const capTotal = safeEval(resolvedCap);
  if (capTotal === null) return { value: null, error: `CapAmount: cannot evaluate cap "${capExpr}"` };

  // Compute total: periods × amountPerPeriod capped at capTotal
  const periodCount = context.periods.length;
  let remaining = capTotal;
  let sum = 0;
  for (let i = 0; i < periodCount; i++) {
    const add = Math.min(amountPerPeriod, remaining);
    sum += Math.max(add, 0);
    remaining -= amountPerPeriod;
    if (remaining <= 0) break;
  }
  return { value: Math.round(sum * 1e8) / 1e8, error: null };
}

/**
 * Parse a CapAmount formula and return per-period amounts.
 * "from here forward" semantics: starting from startPeriodIndex, fill each period
 * with amountPerPeriod until the cumulative total reaches capTotal.
 */
export function parseCapAmount(
  formula: string,
  periods: PeriodDef[],
  startPeriodIndex: number,
  context: ResolveContext
): { perPeriodAmounts: Map<string, number>; totalAmount: number } | null {
  const trimmed = formula.trim();
  const match = trimmed.match(/^CapAmount\((.+),\s*(.+)\)$/i);
  if (!match) return null;

  let amountExpr = match[1].trim();
  let capExpr = match[2].trim();

  // Resolve variables
  let resolvedAmount = resolveReferences(amountExpr, context);
  if (resolvedAmount === null) return null;
  resolvedAmount = resolveVariables(resolvedAmount, context);
  const amountPerPeriod = safeEval(resolvedAmount);
  if (amountPerPeriod === null) return null;

  let resolvedCap = resolveReferences(capExpr, context);
  if (resolvedCap === null) return null;
  resolvedCap = resolveVariables(resolvedCap, context);
  const capTotal = safeEval(resolvedCap);
  if (capTotal === null) return null;

  const perPeriodAmounts = new Map<string, number>();
  let remaining = capTotal;
  let totalAmount = 0;

  for (let i = startPeriodIndex; i < periods.length; i++) {
    const add = Math.min(amountPerPeriod, Math.max(remaining, 0));
    const val = Math.max(add, 0);
    perPeriodAmounts.set(periods[i].id, Math.round(val * 1e8) / 1e8);
    totalAmount += val;
    remaining -= amountPerPeriod;
  }

  return {
    perPeriodAmounts,
    totalAmount: Math.round(totalAmount * 1e8) / 1e8,
  };
}

/** A raw cell dependency: account number + data key */
export interface CellDependency {
  accountNumber: string;
  dataKey: string;
}

/**
 * Extract all cell dependencies from a formula string.
 * Returns an array of {accountNumber, dataKey} pairs that the formula references.
 * This walks the same reference patterns as resolveReferences but collects targets
 * instead of evaluating them.
 */
export function extractCellDependencies(
  formula: string,
  context: ResolveContext
): CellDependency[] {
  const deps: CellDependency[] = [];
  const seen = new Set<string>();

  const addDep = (accountNumber: string, dataKey: string) => {
    const key = `${accountNumber}|${dataKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      deps.push({ accountNumber, dataKey });
    }
  };

  const trimmed = formula.trim();

  // Unwrap common function wrappers to get to inner references
  let inner = trimmed;
  const roundMatch = inner.match(/^ROUND\((.+),\s*\d+\)$/i);
  if (roundMatch) inner = roundMatch[1].trim();

  // SUM({ref},{ref},...) — each {dataKey} is a same-row reference
  const sumMatch = inner.match(/^SUM\((.+)\)$/i);
  if (sumMatch) {
    const argsStr = sumMatch[1];
    const refPattern = /\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = refPattern.exec(argsStr)) !== null) {
      addDep(context.currentAccountNumber, m[1]);
    }
    return deps;
  }

  // SPREAD(expr) — the expression itself may contain refs
  const spreadMatch = inner.match(/^SPREAD\((.+)\)$/i);
  if (spreadMatch) {
    inner = spreadMatch[1].trim();
  }

  // CapAmount(amountExpr, capExpr)
  const capMatch = inner.match(/^CapAmount\((.+),\s*(.+)\)$/i);
  if (capMatch) {
    // Recurse into both arguments
    const sub1 = extractCellDependencies(capMatch[1].trim(), context);
    const sub2 = extractCellDependencies(capMatch[2].trim(), context);
    for (const d of [...sub1, ...sub2]) addDep(d.accountNumber, d.dataKey);
    return deps;
  }

  // Fully qualified [rowRef].{colRef}
  const fullRefPattern = /\[([^\]]+)\]\.\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  // Clone inner to avoid mutating during iteration
  let workStr = inner;
  while ((match = fullRefPattern.exec(workStr)) !== null) {
    const acct = resolveAccountRefPublic(match[1].trim(), context);
    const dk = resolveColumnRefPublic(match[2].trim(), context);
    if (acct && dk) addDep(acct, dk);
  }
  // Remove fully-qualified refs so partial patterns don't re-match
  workStr = workStr.replace(/\[([^\]]+)\]\.\{([^}]+)\}/g, '0');

  // [rowRef] alone — same column
  const rowRefPattern = /\[([^\]]+)\]/g;
  while ((match = rowRefPattern.exec(workStr)) !== null) {
    const acct = resolveAccountRefPublic(match[1].trim(), context);
    if (acct) addDep(acct, context.currentColumn);
  }
  workStr = workStr.replace(/\[([^\]]+)\]/g, '0');

  // {colRef} alone — same row
  const colRefPattern = /\{([^}]+)\}/g;
  while ((match = colRefPattern.exec(workStr)) !== null) {
    const dk = resolveColumnRefPublic(match[1].trim(), context);
    if (dk) addDep(context.currentAccountNumber, dk);
  }

  return deps;
}

/** Public wrapper for resolveAccountRef */
function resolveAccountRefPublic(
  ref: string,
  context: ResolveContext
): string | null {
  return resolveAccountRef(ref, context);
}

/** Public wrapper for resolveColumnRef */
function resolveColumnRefPublic(
  ref: string,
  context: ResolveContext
): string | null {
  return resolveColumnRef(ref, context);
}

/**
 * Build LineTotalN variables for a given row.
 * LineTotal1 corresponds to the first columnDef's total, LineTotal2 to the second, etc.
 */
export function buildLineTotalVariables(
  accountNumber: string,
  columnDefs: ColumnDef[],
  getCellValue: (accountNumber: string, column: string) => number | null
): Map<string, number> {
  const vars = new Map<string, number>();
  columnDefs.forEach((col, idx) => {
    const totalKey = `total:${col.id}`;
    const val = getCellValue(accountNumber, totalKey);
    vars.set(`LineTotal${idx + 1}`, val ?? 0);
  });
  return vars;
}
