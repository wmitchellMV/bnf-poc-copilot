import type {
  GridViewResponse,
  AccountTreeNode,
  AccountSummary,
  CellUpdateRequest,
} from './types';

const BASE_URL = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function getColumns(): Promise<string[]> {
  return fetchJson<string[]>('/columns');
}

export async function getRootAccounts(): Promise<AccountTreeNode[]> {
  return fetchJson<AccountTreeNode[]>('/accounts/roots');
}

export async function getAccountView(
  accountNumber: string
): Promise<GridViewResponse> {
  return fetchJson<GridViewResponse>(
    `/accounts/${encodeURIComponent(accountNumber)}/view`
  );
}

export async function searchAccounts(
  query: string
): Promise<AccountTreeNode[]> {
  return fetchJson<AccountTreeNode[]>(
    `/accounts/search?q=${encodeURIComponent(query)}`
  );
}

export async function getAllAccounts(): Promise<AccountSummary[]> {
  return fetchJson<AccountSummary[]>('/accounts/all');
}

export async function updateCell(request: CellUpdateRequest): Promise<void> {
  const res = await fetch(`${BASE_URL}/accounts/cell`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}

export async function resolveCellValue(
  accountNumber: string,
  column: string
): Promise<number | null> {
  try {
    const data = await fetchJson<{ value: number }>(
      `/accounts/${encodeURIComponent(accountNumber)}/cell/${encodeURIComponent(column)}`
    );
    return data.value;
  } catch {
    return null;
  }
}
