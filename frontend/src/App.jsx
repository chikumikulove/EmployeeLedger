import React, { useState, useEffect, useMemo } from 'react';

const API_BASE = 'http://localhost:8000/api';
const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque'];
const TX_TYPES = [
  { id: 'payment', label: 'Salary Paid' },
  { id: 'advance', label: 'Advance Given' },
  { id: 'credit', label: 'Credit / Bonus' },
  { id: 'deduction', label: 'Advance Repaid' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString().slice(0, 10);
const CURRENT_YEAR = TODAY.getFullYear();
const CURRENT_MONTH = TODAY.getMonth() + 1;

function fmt(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name) {
  return (name || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function App() {
  const [employees, setEmployees] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [route, setRoute] = useState('dashboard');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: '' });

  const [modal, setModal] = useState(null); // { type: 'employee' | 'transaction', data: null, presetEmployee: null }
  const [confirmModal, setConfirmModal] = useState(null); // { txId: '' }
  const [txFilters, setTxFilters] = useState({ employee: 'all', type: 'all', mode: 'all' });

  const showToast = (message) => {
    setToast({ show: true, message });
    setTimeout(() => setToast({ show: false, message: '' }), 2400);
  };

  const fetchData = async () => {
    try {
      const [empRes, txRes] = await Promise.all([
        fetch(`${API_BASE}/employees`),
        fetch(`${API_BASE}/transactions`)
      ]);
      const empData = await empRes.json();
      const txData = await txRes.json();
      setEmployees(empData);
      setTransactions(txData);
    } catch (err) {
      showToast('Error connecting to backend API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

 const employeeStats = (empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) {
      return {
        paid: 0,
        outstandingAdvance: 0,
        credit: 0,
        totalCredit: 0,
        expectedSalary: 0,
        excessAsCredit: 0,
        txCount: 0
      };
    }

    const txs = transactions.filter(t => t.employeeId === empId);
    const paid = txs.filter(t => t.type === 'payment').reduce((s, t) => s + Number(t.amount || 0), 0);
    const advGiven = txs.filter(t => t.type === 'advance').reduce((s, t) => s + Number(t.amount || 0), 0);
    const advRepaid = txs.filter(t => t.type === 'deduction').reduce((s, t) => s + Number(t.amount || 0), 0);
    const explicitCredit = txs.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount || 0), 0);

    const baseSalary = Number(emp.baseSalary || 0);
    const joiningMonth = Number(emp.joiningMonth) || 1;
    const joiningYear = Number(emp.joiningYear) || CURRENT_YEAR;

    // Filter payments from joining period onwards
    const salaryPayments = txs.filter(t => {
      if (t.type !== 'payment' || !t.salaryMonth || !t.salaryYear) return false;
      return (
        t.salaryYear > joiningYear ||
        (t.salaryYear === joiningYear && t.salaryMonth >= joiningMonth)
      );
    });

    // Salary base expected for the logged payment periods
    const expectedBaseTotal = salaryPayments.length * baseSalary;

    // Net Ledger Balance Calculation
    // Total Credits/Earnings due vs Total Debits/Payouts made
    const totalEarnedDue = expectedBaseTotal + advRepaid + explicitCredit;
    const totalPaidOut = paid + advGiven;
    const netBalance = totalEarnedDue - totalPaidOut;

    // Mutually exclusive: either Advance Owed OR Pending Credit, never both
    const outstandingAdvance = netBalance < 0 ? Math.abs(netBalance) : 0;
    const pendingCredit = netBalance > 0 ? netBalance : 0;

    // Expected salary calculation for the upcoming payout cycle
    const currentCycleBase = baseSalary;
    const availableToPay = currentCycleBase + pendingCredit;
    const overrun = outstandingAdvance - availableToPay;
    const expectedSalary = overrun > 0 ? 0 : availableToPay - outstandingAdvance;
    const excessAsCredit = overrun > 0 ? overrun : 0;

    return {
      paid,
      outstandingAdvance,
      credit: explicitCredit,
      totalCredit: pendingCredit,
      expectedSalary,
      excessAsCredit,
      txCount: txs.length
    };
  };

  const expectedSalaryInfo = (e) => {
    return employeeStats(e.id);
  };

  const globalStats = useMemo(() => {
    const now = new Date();
    const thisMonth = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === 'payment';
    });
    const paidThisMonth = thisMonth.reduce((s, t) => s + Number(t.amount), 0);
    const outstandingAdvance = employees.reduce((s, e) => s + employeeStats(e.id).outstandingAdvance, 0);
    const modeTotals = {};
    PAYMENT_MODES.forEach(m => { modeTotals[m] = 0; });
    transactions.filter(t => t.type === 'payment').forEach(t => {
      modeTotals[t.mode] = (modeTotals[t.mode] || 0) + Number(t.amount);
    });
    return { paidThisMonth, outstandingAdvance, modeTotals, activeEmployees: employees.length };
  }, [employees, transactions]);

  const handleSaveEmployee = async (formData) => {
    const isEdit = !!formData.id;
    const url = isEdit ? `${API_BASE}/employees/${formData.id}` : `${API_BASE}/employees`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!res.ok) throw new Error('Failed to save employee');
      await fetchData();
      setModal(null);
      showToast(isEdit ? 'Employee updated' : 'Employee added');
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDeleteEmployee = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/employees/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete employee');
      await fetchData();
      setModal(null);
      setRoute('employees');
      showToast('Employee removed');
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleSaveTransaction = async (formData) => {
    try {
      const res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to save transaction');
      }
      await fetchData();
      setModal(null);
      showToast('Entry logged');
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDeleteTransaction = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete entry');
      await fetchData();
      setConfirmModal(null);
      showToast('Entry removed');
    } catch (err) {
      showToast(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--ink-soft)', fontFamily: 'Fraunces, serif', fontSize: '15px' }}>
        Opening the ledger…
      </div>
    );
  }

  const selectedEmp = employees.find(e => e.id === selectedEmployeeId);

  return (
    <div className="shell">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-text">Ledger</div>
            <div className="brand-sub">Payroll Book</div>
          </div>
        </div>
        <div className="nav">
          <button className={`nav-item ${route === 'dashboard' ? 'active' : ''}`} onClick={() => setRoute('dashboard')}>
            Dashboard
          </button>
          <button className={`nav-item ${route === 'employees' || route === 'employeeDetail' ? 'active' : ''}`} onClick={() => setRoute('employees')}>
            Employees
          </button>
          <button className={`nav-item ${route === 'transactions' ? 'active' : ''}`} onClick={() => setRoute('transactions')}>
            Transactions
          </button>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-footer-note">
            {employees.length} employee{employees.length !== 1 ? 's' : ''} on record<br />
            {transactions.length} entries logged
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main">
        {route === 'dashboard' && (
          <DashboardPage
            stats={globalStats}
            transactions={transactions}
            employees={employees}
            onNewTx={() => setModal({ type: 'transaction' })}
            onViewAll={() => setRoute('transactions')}
          />
        )}

        {route === 'employees' && (
          <EmployeesPage
            employees={employees}
            expectedSalaryInfo={expectedSalaryInfo}
            onSelect={(id) => { setSelectedEmployeeId(id); setRoute('employeeDetail'); }}
            onAdd={() => setModal({ type: 'employee' })}
          />
        )}

        {route === 'employeeDetail' && selectedEmp && (
          <EmployeeDetailPage
            employee={selectedEmp}
            salaryInfo={expectedSalaryInfo(selectedEmp)}
            transactions={transactions.filter(t => t.employeeId === selectedEmp.id)}
            onBack={() => setRoute('employees')}
            onEdit={() => setModal({ type: 'employee', data: selectedEmp })}
            onNewTx={() => setModal({ type: 'transaction', presetEmployee: selectedEmp.id })}
            onDeleteTx={(id) => setConfirmModal({ txId: id })}
          />
        )}

        {route === 'transactions' && (
          <TransactionsPage
            transactions={transactions}
            employees={employees}
            filters={txFilters}
            onFilterChange={setTxFilters}
            onNewTx={() => setModal({ type: 'transaction' })}
            onDeleteTx={(id) => setConfirmModal({ txId: id })}
          />
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'employee' && (
        <EmployeeModal
          initialData={modal.data}
          onSave={handleSaveEmployee}
          onDelete={handleDeleteEmployee}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'transaction' && (
        <TransactionModal
          employees={employees}
          transactions={transactions}
          presetEmployee={modal.presetEmployee}
          onSave={handleSaveTransaction}
          onClose={() => setModal(null)}
          expectedSalaryInfo={expectedSalaryInfo}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          tx={transactions.find(t => t.id === confirmModal.txId)}
          emp={employees.find(e => e.id === transactions.find(t => t.id === confirmModal.txId)?.employeeId)}
          onConfirm={() => handleDeleteTransaction(confirmModal.txId)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Toast Notification */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.message}</div>
    </div>
  );
}

// ---------- Subcomponents ----------
function DashboardPage({ stats, transactions, employees, onNewTx, onViewAll }) {
  const maxMode = Math.max(1, ...Object.values(stats.modeTotals));
  const recent = transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Overview</div>
          <h1 className="page-title">This month's book</h1>
          <div className="page-desc">A running summary of what's gone out, what's owed, and how it moved.</div>
        </div>
        <button className="btn" onClick={onNewTx}>+ New entry</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Paid this month</div>
          <div className="stat-value mono">{fmt(stats.paidThisMonth)}</div>
          <div className="stat-note">Salary payouts only</div>
        </div>
        <div className="stat-card rust">
          <div className="stat-label">Advances outstanding</div>
          <div className="stat-value mono">{fmt(stats.outstandingAdvance)}</div>
          <div className="stat-note">Owed back by employees</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active employees</div>
          <div className="stat-value mono">{stats.activeEmployees}</div>
          <div className="stat-note">On the payroll book</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total entries</div>
          <div className="stat-value mono">{transactions.length}</div>
          <div className="stat-note">Across all employees</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>Recent entries</h3>
            <button className="btn secondary small" onClick={onViewAll}>View all</button>
          </div>
          {recent.length ? (
            <table>
              <tbody>
                {recent.map(t => {
                  const emp = employees.find(e => e.id === t.employeeId);
                  return (
                    <tr key={t.id}>
                      <td style={{ width: '40%' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{emp ? emp.name : 'Unknown'}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--ink-soft)', marginTop: '1px' }}>{fmtDate(t.date)}</div>
                      </td>
                      <td>
                        <span className={`stamp ${t.type}`}>{TX_TYPES.find(x => x.id === t.type)?.label || t.type}</span>
                        {t.type === 'payment' && t.salaryMonth && t.salaryYear && (
                          <div style={{ fontSize: '10px', color: 'var(--ink-soft)', marginTop: '3px' }}>
                            {MONTH_NAMES[t.salaryMonth - 1]} {t.salaryYear}
                          </div>
                        )}
                      </td>
                      <td><span className="mode-pill"><span className="mode-dot"></span>{t.mode}</span></td>
                      <td className="amt mono" style={{ fontWeight: 600 }}>{fmt(t.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <div className="em-title">No entries yet</div>
              <div className="em-sub">Log your first payment, advance, or credit to start the book.</div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head"><h3>Paid by mode</h3></div>
          <div style={{ padding: '14px 0 18px' }}>
            {PAYMENT_MODES.map(m => (
              <div className="mode-row" key={m}>
                <div className="mode-label">{m}</div>
                <div className="mode-track">
                  <div className="mode-fill" style={{ width: `${Math.round(((stats.modeTotals[m] || 0) / maxMode) * 100)}%` }} />
                </div>
                <div className="mode-amt mono">{fmt(stats.modeTotals[m] || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function EmployeesPage({ employees, expectedSalaryInfo, onSelect, onAdd }) {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Roster</div>
          <h1 className="page-title">Employees</h1>
          <div className="page-desc">Everyone on the book, with balances at a glance.</div>
        </div>
        <button className="btn" onClick={onAdd}>+ Add employee</button>
      </div>
      {employees.length ? (
        <div className="emp-grid">
          {employees.map(e => {
            const s = expectedSalaryInfo(e);
            return (
              <div className="emp-card" key={e.id} onClick={() => onSelect(e.id)}>
                <div className="emp-top">
                  <div className="avatar">{initials(e.name)}</div>
                  <div>
                    <div className="emp-name">{e.name}</div>
                    <div className="emp-role">{e.role || 'No role set'}</div>
                  </div>
                </div>
                <div className="emp-stats">
                  <div>
                    <div className="emp-stat-label">Total paid</div>
                    <div className="emp-stat-val mono balance-pos">{fmt(s.paid)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="emp-stat-label">{s.excessAsCredit > 0 ? 'Credit owed by them' : 'Advance owed'}</div>
                    <div className={`emp-stat-val mono ${s.outstandingAdvance > 0 || s.excessAsCredit > 0 ? 'balance-neg' : ''}`}>
                      {fmt(s.excessAsCredit > 0 ? s.excessAsCredit : s.outstandingAdvance)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state">
            <div className="em-title">No employees yet</div>
            <div className="em-sub">Add your first employee to start tracking their payments.</div>
          </div>
        </div>
      )}
    </>
  );
}

function EmployeeDetailPage({ employee, salaryInfo, transactions, onBack, onEdit, onNewTx, onDeleteTx }) {
  return (
    <>
      <button className="drawer-back" onClick={onBack}>← Back to employees</button>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="avatar" style={{ width: '52px', height: '52px', fontSize: '19px' }}>{initials(employee.name)}</div>
          <div>
            <h1 className="page-title" style={{ fontSize: '23px' }}>{employee.name}</h1>
            <div className="page-desc" style={{ marginTop: '2px' }}>
              {employee.role || 'No role set'} · {employee.phone || 'No phone on file'} · Prefers {employee.defaultMode}
              {employee.joiningMonth && employee.joiningYear && (
                <> · Joined {MONTH_NAMES[employee.joiningMonth - 1]} {employee.joiningYear}</>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn secondary" onClick={onEdit}>Edit</button>
          <button className="btn" onClick={onNewTx}>+ New entry</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Total paid</div><div className="stat-value mono">{fmt(salaryInfo.paid)}</div></div>
        <div className="stat-card rust"><div className="stat-label">Advance outstanding</div><div className="stat-value mono">{fmt(salaryInfo.outstandingAdvance)}</div></div>
        <div className="stat-card"><div className="stat-label">Credits / bonus</div><div className="stat-value mono">{fmt(salaryInfo.totalCredit)}</div></div>
        <div className="stat-card"><div className="stat-label">Expected salary due</div><div className="stat-value mono">{fmt(salaryInfo.expectedSalary)}</div></div>
      </div>

      {salaryInfo.excessAsCredit > 0 && (
        <div className="panel" style={{ padding: '12px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', background: 'var(--rust-soft)', borderColor: 'var(--rust-soft)' }}>
          <div style={{ fontSize: '12.5px', color: 'var(--rust)' }}>
            Advance given exceeds base salary and credits — the excess is carried forward as credit against {employee.name.split(' ')[0]}, to be recovered from future pay.
          </div>
          <div className="mono" style={{ fontSize: '15px', fontWeight: 700, color: 'var(--rust)', whiteSpace: 'nowrap' }}>
            {fmt(salaryInfo.excessAsCredit)}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h3>Payment history</h3></div>
        {transactions.length ? (
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Mode</th><th>Note</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id}>
                  <td className="mono">{fmtDate(t.date)}</td>
                  <td>
                    <span className={`stamp ${t.type}`}>{TX_TYPES.find(x => x.id === t.type)?.label || t.type}</span>
                    {t.type === 'payment' && t.salaryMonth && t.salaryYear && (
                      <div style={{ fontSize: '10px', color: 'var(--ink-soft)', marginTop: '3px' }}>
                        {MONTH_NAMES[t.salaryMonth - 1]} {t.salaryYear}
                      </div>
                    )}
                  </td>
                  <td><span className="mode-pill"><span className="mode-dot"></span>{t.mode}</span></td>
                  <td style={{ color: 'var(--ink-soft)' }}>{t.note || '—'}</td>
                  <td className="amt mono" style={{ fontWeight: 600 }}>{fmt(t.amount)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn danger small" onClick={() => onDeleteTx(t.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <div className="em-title">No entries for this employee</div>
            <div className="em-sub">Log a payment, advance, or credit to build their history.</div>
          </div>
        )}
      </div>
    </>
  );
}

function TransactionsPage({ transactions, employees, filters, onFilterChange, onNewTx, onDeleteTx }) {
  const filtered = transactions.filter(t => {
    if (filters.employee !== 'all' && t.employeeId !== filters.employee) return false;
    if (filters.type !== 'all' && t.type !== filters.type) return false;
    if (filters.mode !== 'all' && t.mode !== filters.mode) return false;
    return true;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Full record</div>
          <h1 className="page-title">Transactions</h1>
          <div className="page-desc">Every payment, advance, and credit in one ledger.</div>
        </div>
        <button className="btn" onClick={onNewTx}>+ New entry</button>
      </div>

      <div className="filter-bar">
        <select value={filters.employee} onChange={e => onFilterChange({ ...filters, employee: e.target.value })}>
          <option value="all">All employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={filters.type} onChange={e => onFilterChange({ ...filters, type: e.target.value })}>
          <option value="all">All types</option>
          {TX_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={filters.mode} onChange={e => onFilterChange({ ...filters, mode: e.target.value })}>
          <option value="all">All modes</option>
          {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="panel">
        {filtered.length ? (
          <table>
            <thead>
              <tr><th>Date</th><th>Employee</th><th>Type</th><th>Mode</th><th>Note</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const emp = employees.find(e => e.id === t.employeeId);
                return (
                  <tr key={t.id}>
                    <td className="mono">{fmtDate(t.date)}</td>
                    <td style={{ fontWeight: 600 }}>{emp ? emp.name : 'Unknown'}</td>
                    <td>
                      <span className={`stamp ${t.type}`}>{TX_TYPES.find(x => x.id === t.type)?.label || t.type}</span>
                      {t.type === 'payment' && t.salaryMonth && t.salaryYear && (
                        <div style={{ fontSize: '10px', color: 'var(--ink-soft)', marginTop: '3px' }}>
                          {MONTH_NAMES[t.salaryMonth - 1]} {t.salaryYear}
                        </div>
                      )}
                    </td>
                    <td><span className="mode-pill"><span className="mode-dot"></span>{t.mode}</span></td>
                    <td style={{ color: 'var(--ink-soft)' }}>{t.note || '—'}</td>
                    <td className="amt mono" style={{ fontWeight: 600 }}>{fmt(t.amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn danger small" onClick={() => onDeleteTx(t.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <div className="em-title">No matching entries</div>
            <div className="em-sub">Try clearing filters or log a new entry.</div>
          </div>
        )}
      </div>
    </>
  );
}

function EmployeeModal({ initialData, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    id: initialData?.id || undefined,
    name: initialData?.name || '',
    role: initialData?.role || '',
    phone: initialData?.phone || '',
    baseSalary: initialData?.baseSalary || '',
    defaultMode: initialData?.defaultMode || PAYMENT_MODES[0],
    joiningMonth: initialData?.joiningMonth || CURRENT_MONTH,
    joiningYear: initialData?.joiningYear || CURRENT_YEAR,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({
      ...form,
      name: form.name.trim(),
      role: form.role.trim(),
      phone: form.phone.trim(),
      baseSalary: Number(form.baseSalary) || 0,
      joiningMonth: Number(form.joiningMonth),
      joiningYear: Number(form.joiningYear)
    });
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{initialData?.id ? 'Edit employee' : 'Add employee'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="field">
            <label>Name</label>
            <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ramesh Kumar" />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Role</label>
              <input type="text" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="e.g. Site Supervisor" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Joining month</label>
              <select value={form.joiningMonth} onChange={e => setForm({ ...form, joiningMonth: Number(e.target.value) })}>
                {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Joining year</label>
              <select value={form.joiningYear} onChange={e => setForm({ ...form, joiningYear: Number(e.target.value) })}>
                {Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Base salary</label>
              <input type="number" value={form.baseSalary} onChange={e => setForm({ ...form, baseSalary: e.target.value })} placeholder="0" />
            </div>
            <div className="field">
              <label>Preferred mode</label>
              <select value={form.defaultMode} onChange={e => setForm({ ...form, defaultMode: e.target.value })}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            {initialData?.id && (
              <button type="button" className="btn danger" onClick={() => onDelete(initialData.id)}>Remove employee</button>
            )}
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn">{initialData?.id ? 'Save changes' : 'Add employee'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TransactionModal({ employees, transactions, presetEmployee, onSave, onClose, expectedSalaryInfo }) {
  const selectedEmpId = presetEmployee || employees[0]?.id || '';
  const selectedEmp = employees.find(e => e.id === selectedEmpId);
  
  const [employeeId, setEmployeeId] = useState(selectedEmpId);
  const [type, setType] = useState('payment');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(TODAY_ISO);
  const [mode, setMode] = useState(selectedEmp?.defaultMode || PAYMENT_MODES[0] || '');
  const [note, setNote] = useState('');
  const [salaryMonth, setSalaryMonth] = useState(CURRENT_MONTH);
  const [salaryYear, setSalaryYear] = useState(CURRENT_YEAR);

  // Update mode when selected employee changes
  useEffect(() => {
    const emp = employees.find(e => e.id === employeeId);
    if (emp) {
      setMode(emp.defaultMode || PAYMENT_MODES[0]);
    }
  }, [employeeId, employees]);

  const currentSelectedEmp = employees.find(e => e.id === employeeId);
  const s = currentSelectedEmp ? expectedSalaryInfo(currentSelectedEmp) : null;

  const duplicateTx = useMemo(() => {
    if (type !== 'payment') return null;
    return transactions.find(t =>
      t.employeeId === employeeId &&
      t.type === 'payment' &&
      Number(t.salaryYear) === Number(salaryYear) &&
      Number(t.salaryMonth) === Number(salaryMonth)
    );
  }, [transactions, employeeId, type, salaryYear, salaryMonth]);

  const salaryStatusMessage = useMemo(() => {
    if (type !== 'payment' || !currentSelectedEmp) return null;
    if (duplicateTx) {
      return {
        className: 'blocked',
        message: `Salary for ${MONTH_NAMES[salaryMonth - 1]} ${salaryYear} was already recorded on ${fmtDate(duplicateTx.date)} (${fmt(duplicateTx.amount)}). Duplicate entries aren't allowed — delete that entry first if you need to correct it.`
      };
    }
    const base = Number(currentSelectedEmp.baseSalary || 0);
    const amt = Number(amount) || 0;
    if (!amt) {
      return {
        className: 'neutral',
        message: `Base salary for ${MONTH_NAMES[salaryMonth - 1]} ${salaryYear} is ${fmt(base)}.`
      };
    }
    const diff = amt - base;
    if (diff === 0) {
      return {
        className: 'ok',
        message: `Matches the base salary for ${MONTH_NAMES[salaryMonth - 1]} ${salaryYear} exactly.`
      };
    }
    if (diff > 0) {
      return {
        className: 'over',
        message: `${fmt(diff)} more than base salary — this will be recorded as overpaid for ${MONTH_NAMES[salaryMonth - 1]} ${salaryYear}.`
      };
    }
    return {
      className: 'pending',
      message: `${fmt(-diff)} will remain pending for ${MONTH_NAMES[salaryMonth - 1]} ${salaryYear} after this payment.`
    };
  }, [type, currentSelectedEmp, salaryMonth, salaryYear, amount, duplicateTx]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const numAmt = Number(amount);
    if (!numAmt || numAmt <= 0) return;
    if (type === 'payment' && duplicateTx) return;

    onSave({
      employeeId,
      type,
      amount: numAmt,
      date,
      mode,
      note: note.trim(),
      salaryMonth: type === 'payment' ? Number(salaryMonth) : null,
      salaryYear: type === 'payment' ? Number(salaryYear) : null
    });
  };

  const years = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);
  const joiningMonth = Number(currentSelectedEmp?.joiningMonth || CURRENT_MONTH);
  const joiningYear = Number(currentSelectedEmp?.joiningYear || CURRENT_YEAR);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>New entry</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          {employees.length ? (
            <>
              <div className="field">
                <label>Employee</label>
                <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              {currentSelectedEmp && s && (
                <div style={{ background: 'var(--paper)', border: '1px solid var(--paper-line)', borderRadius: '7px', padding: '14px 15px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ledger-green-dark)' }}>{currentSelectedEmp.role || 'No role set'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>Base {fmt(currentSelectedEmp.baseSalary)}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                    <div>
                      <div style={{ color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '10px' }}>Advance owed</div>
                      <div className={`mono ${s.outstandingAdvance > 0 ? 'balance-neg' : ''}`} style={{ fontWeight: 600, marginTop: '2px' }}>{fmt(s.outstandingAdvance)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '10px' }}>Pending credit</div>
                      <div className="mono balance-pos" style={{ fontWeight: 600, marginTop: '2px' }}>{fmt(s.totalCredit)}</div>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px dashed var(--paper-line)', marginTop: '10px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>Expected salary due</div>
                    <div className="mono" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ledger-green-dark)' }}>{fmt(s.expectedSalary)}</div>
                  </div>
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>Type</label>
                  <select value={type} onChange={e => setType(e.target.value)}>
                    {TX_TYPES.map(ty => <option key={ty.id} value={ty.id}>{ty.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input required type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
                </div>
              </div>

              {type === 'payment' && (
                <div>
                  <div className="field-row">
                    <div className="field">
                      <label>Salary month</label>
                      <select value={salaryMonth} onChange={e => setSalaryMonth(Number(e.target.value))}>
                        {MONTH_NAMES.map((name, i) => {
                          const monthNum = i + 1;
                          const isBeforeJoining = salaryYear === joiningYear ? monthNum < joiningMonth : salaryYear < joiningYear;
                          return (
                            <option key={name} value={monthNum} disabled={isBeforeJoining}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="field">
                      <label>Salary year</label>
                      <select value={salaryYear} onChange={e => setSalaryYear(Number(e.target.value))}>
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>

                  {salaryStatusMessage && (
                    <div className={`salary-status ${salaryStatusMessage.className}`}>
                      {salaryStatusMessage.message}
                    </div>
                  )}
                </div>
              )}

              <div className="field-row">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={date} max={TODAY_ISO} onChange={e => setDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Payment mode</label>
                  <select value={mode} onChange={e => setMode(e.target.value)}>
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Note</label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional — e.g. Oct salary" />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn" disabled={type === 'payment' && !!duplicateTx}>Save entry</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="em-title">Add an employee first</div>
              <div className="em-sub">You need at least one employee before logging a payment.</div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({ tx, emp, onConfirm, onCancel }) {
  const trashIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
    </svg>
  );

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ width: '360px' }}>
        <div className="modal-body" style={{ paddingTop: '24px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '6px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--rust-soft)', color: 'var(--rust)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {trashIcon}
            </div>
            <div>
              <h3 style={{ fontSize: '16px' }}>Delete this entry?</h3>
              <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '4px', lineHeight: 1.5 }}>
                {tx ? (
                  <>
                    <span className={`stamp ${tx.type}`}>{TX_TYPES.find(x => x.id === tx.type)?.label || tx.type}</span> of <strong className="mono">{fmt(tx.amount)}</strong> for <strong>{emp?.name || 'Unknown'}</strong> on {fmtDate(tx.date)} will be permanently removed from the ledger.
                  </>
                ) : (
                  <>This entry will be permanently removed from the ledger.</>
                )}
              </div>
            </div>
          </div>
          <div className="modal-actions" style={{ marginTop: '18px' }}>
            <button className="btn secondary" onClick={onCancel}>No, keep it</button>
            <button className="btn danger" style={{ background: 'var(--rust)', color: '#fff' }} onClick={onConfirm}>Yes, delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}