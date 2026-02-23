import { useState, useEffect, useCallback } from 'react';
import { HierarchicalGrid } from './HierarchicalGrid';
import {
  getAccountView,
  getRootAccounts,
  getAllAccounts,
  updateCell,
} from './api';
import type {
  AccountTreeNode,
  AccountSummary,
  GridViewResponse,
} from './types';
import { isFormula } from './formulaEngine';
import './App.css';

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gridView, setGridView] = useState<GridViewResponse | null>(null);
  const [allAccounts, setAllAccounts] = useState<AccountSummary[]>([]);
  const [allRows, setAllRows] = useState<AccountTreeNode[]>([]);
  const [navigationStack, setNavigationStack] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AccountSummary[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  // Load initial data
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [roots, accounts] = await Promise.all([
          getRootAccounts(),
          getAllAccounts(),
        ]);
        setAllAccounts(accounts);
        setAllRows(roots);

        if (roots.length > 0) {
          const view = await getAccountView(roots[0].accountNumber);
          setGridView(view);
          setNavigationStack([roots[0].accountNumber]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load data'
        );
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const navigateTo = useCallback(
    async (accountNumber: string, pushToStack = true) => {
      try {
        setLoading(true);
        const view = await getAccountView(accountNumber);
        setGridView(view);
        if (pushToStack) {
          setNavigationStack((prev) => [...prev, accountNumber]);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to navigate'
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleDrillDown = useCallback(
    async (accountNumber: string) => {
      await navigateTo(accountNumber);
    },
    [navigateTo]
  );

  const handleDrillUp = useCallback(
    async (parentAccountNumber: string) => {
      setNavigationStack((prev) => {
        const newStack = [...prev];
        newStack.pop();
        return newStack;
      });
      await navigateTo(parentAccountNumber, false);
    },
    [navigateTo]
  );

  const handleCellUpdate = useCallback(
    async (accountNumber: string, column: string, value: string) => {
      try {
        const isFormulaValue = isFormula(value);
        await updateCell({
          accountNumber,
          column,
          formula: isFormulaValue ? value : null,
          numericValue: isFormulaValue ? null : parseFloat(value) || null,
        });
      } catch (err) {
        console.error('Failed to update cell:', err);
      }
    },
    []
  );

  // Search handling
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const lower = searchQuery.toLowerCase();
    const results = allAccounts
      .filter(
        (a) =>
          a.accountNumber.toLowerCase().includes(lower) ||
          a.accountName.toLowerCase().includes(lower)
      )
      .slice(0, 20);
    setSearchResults(results);
  }, [searchQuery, allAccounts]);

  if (error) {
    return (
      <div className="app-container">
        <div className="error-banner">
          <span>⚠ {error}</span>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Hierarchical Grid</h1>
        <div className="header-actions">
          <div className="search-container">
            <input
              className="search-input"
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
            />
            {showSearch && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map((a) => (
                  <div
                    key={a.accountNumber}
                    className="search-item"
                    onMouseDown={() => {
                      navigateTo(a.accountNumber);
                      setSearchQuery('');
                      setShowSearch(false);
                    }}
                  >
                    <span className="search-item-number">
                      {a.accountNumber}
                    </span>
                    <span className="search-item-name">{a.accountName}</span>
                    {a.hasChildren && (
                      <span className="search-item-badge">▶</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="account-count">
            {allAccounts.length} accounts loaded
          </span>
        </div>
      </header>

      {/* Navigation breadcrumb */}
      {navigationStack.length > 1 && (
        <div className="breadcrumbs">
          {navigationStack.map((accNum, idx) => {
            const account = allAccounts.find(
              (a) => a.accountNumber === accNum
            );
            return (
              <span key={accNum}>
                {idx > 0 && <span className="breadcrumb-sep">›</span>}
                <button
                  className={`breadcrumb-item ${
                    idx === navigationStack.length - 1 ? 'active' : ''
                  }`}
                  onClick={() => {
                    if (idx < navigationStack.length - 1) {
                      setNavigationStack((prev) => prev.slice(0, idx + 1));
                      navigateTo(accNum, false);
                    }
                  }}
                >
                  {account?.accountName ?? accNum}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {loading && !gridView ? (
        <div className="loading">
          <div className="spinner"></div>
          <span>Loading grid data...</span>
        </div>
      ) : gridView ? (
        <HierarchicalGrid
          parentRow={gridView.parent}
          childRows={gridView.children}
          dataColumns={gridView.columns}
          frozenColumnCount={2}
          allAccounts={allAccounts}
          onDrillDown={handleDrillDown}
          onDrillUp={handleDrillUp}
          onCellUpdate={handleCellUpdate}
          allRows={allRows}
        />
      ) : (
        <div className="empty-state">No data available</div>
      )}

      {/* Help info */}
      <footer className="app-footer">
        <div className="help-section">
          <h3>Formula Reference</h3>
          <div className="help-grid">
            <div className="help-item">
              <code>[A1001]</code>
              <span>Reference row by account number (same column)</span>
            </div>
            <div className="help-item">
              <code>[Sales Revenue]</code>
              <span>Reference row by account name (same column)</span>
            </div>
            <div className="help-item">
              <code>{'{2024 Budget}'}</code>
              <span>Reference column by name (same row)</span>
            </div>
            <div className="help-item">
              <code>[A1001].{'{2024 Budget}'}</code>
              <span>Reference specific cell</span>
            </div>
            <div className="help-item">
              <code>= [A1001] + [A1002]</code>
              <span>Add values from two rows</span>
            </div>
            <div className="help-item">
              <code>= ([A1001].{'{2024 Budget}'} + 500) * 1.05</code>
              <span>Complex formula with math</span>
            </div>
          </div>
          <p className="help-tip">
            Double-click any data cell to edit. Type <strong>[</strong> for
            account autocomplete or <strong>{'{'}</strong> for column
            autocomplete. Press Enter to confirm, Escape to cancel, Tab to move
            to next column.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
