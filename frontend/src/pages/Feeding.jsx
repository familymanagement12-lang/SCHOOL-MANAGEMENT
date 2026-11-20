import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getClasses } from '../api/classes';
import {
  createFeedingCalendarException,
  createFeedingRate,
  createFeedingTerm,
  exportFeedingReport,
  getFeedingAccount,
  getFeedingAccounts,
  getFeedingRates,
  getFeedingRegister,
  getFeedingReport,
  getFeedingTerms,
  recordSchoolPayment,
  setFeedingFrequency,
  updateFeedingCoverage,
} from '../api/feeding';

const today = () => new Date().toISOString().slice(0, 10);
const makeRequestKey = () => window.crypto?.randomUUID?.()
  || `feeding-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const currencyCode = localStorage.getItem('sms_currency') || 'GHS';
const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, {
  style: 'currency',
  currency: currencyCode,
});
const frequencyNames = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  termly: 'Termly',
};
const reportNames = {
  daily: 'Daily feeding',
  weekly: 'Weekly feeding',
  monthly: 'Monthly feeding',
  termly: 'Termly feeding',
  class_collections: 'Class collections',
  outstanding: 'Outstanding balances',
  advance_credit: 'Advance credits',
  payment_history: 'Payment history',
};

function Feeding() {
  const [searchParams] = useSearchParams();
  const [user] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [tab, setTab] = useState(searchParams.get('student_id') ? 'accounts' : 'register');
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [termsLoaded, setTermsLoaded] = useState(false);
  const [rates, setRates] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(searchParams.get('student_id') || '');
  const [account, setAccount] = useState(null);
  const [register, setRegister] = useState(null);
  const [registerDate, setRegisterDate] = useState(today());
  const [registerTermId, setRegisterTermId] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [reportType, setReportType] = useState('daily');
  const [report, setReport] = useState(null);
  const [reportStart, setReportStart] = useState(today());
  const [reportEnd, setReportEnd] = useState(today());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [paymentStudent, setPaymentStudent] = useState(null);
  const paymentKey = useRef(makeRequestKey());
  const isAdmin = ['admin', 'feeding_tuckshop_officer'].includes(user?.role);
  const isFeedingOfficer = user?.role === 'feeding_tuckshop_officer';
  const canSeeAccounts = ['admin', 'accountant', 'feeding_tuckshop_officer'].includes(user?.role);
  const canSeeCalendarRates = ['admin', 'accountant', 'feeding_tuckshop_officer'].includes(user?.role);
  const canRecordPayment = ['admin', 'accountant', 'feeding_tuckshop_officer'].includes(user?.role);

  const [termForm, setTermForm] = useState({
    academic_year: `${new Date().getUTCFullYear()}/${new Date().getUTCFullYear() + 1}`,
    term: 'First Term',
    start_date: today(),
    end_date: today(),
    scheduled_weekdays: [1, 2, 3, 4, 5],
  });
  const [rateForm, setRateForm] = useState({
    class_id: '',
    academic_year: '',
    term: '',
    daily_rate: '',
    effective_date: today(),
  });
  const [exceptionForm, setExceptionForm] = useState({
    term_id: '',
    class_id: '',
    name: '',
    event_type: 'holiday',
    start_date: today(),
    end_date: today(),
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    payment_method: 'cash',
    payment_date: today(),
    reference: '',
  });

  useEffect(() => {
    Promise.all([getClasses(), getFeedingTerms()])
      .then(([classResponse, termResponse]) => {
        setClasses(classResponse.data);
        setTerms(termResponse.data);
        setTermsLoaded(true);
        if (termResponse.data[0]) {
          setRateForm((current) => ({
            ...current,
            academic_year: termResponse.data[0].academic_year,
            term: termResponse.data[0].term,
          }));
          setExceptionForm((current) => ({ ...current, term_id: String(termResponse.data[0].id) }));
        }
      })
      .catch((requestError) => {
        setTermsLoaded(true);
        setError(requestError.response?.data?.message || 'Unable to load feeding setup.');
      });
    if (isAdmin || canSeeAccounts) {
      getFeedingRates()
        .then((response) => setRates(response.data))
        .catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load feeding rates.'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedStudent || !canSeeAccounts) {
      setAccount(null);
      return;
    }
    getFeedingAccount(selectedStudent, { date: registerDate })
      .then((response) => setAccount(response.data))
      .catch((requestError) => {
        setAccount(null);
        setError(requestError.response?.data?.message || 'Unable to load the feeding account.');
      });
  }, [selectedStudent, registerDate, canSeeAccounts]);

  const refreshRegister = async () => {
    setError('');
    if (!termsLoaded) return;
    const coveringTerm = coveringTerms.find((term) => String(term.id) === registerTermId);
    if (!coveringTerm) {
      setRegister(null);
      return;
    }
    try {
      const response = await getFeedingRegister({
        date: registerDate,
        class_id: classFilter || undefined,
        academic_year: coveringTerm.academic_year,
        term: coveringTerm.term,
      });
      setRegister(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load the daily feeding register.');
    }
  };

  const coveringTerms = useMemo(() => terms.filter((term) => (
    term.start_date <= registerDate && term.end_date >= registerDate
  )), [terms, registerDate]);

  useEffect(() => {
    if (!coveringTerms.some((term) => String(term.id) === registerTermId)) {
      setRegisterTermId(String(coveringTerms[0]?.id || ''));
    }
  }, [coveringTerms, registerTermId]);

  useEffect(() => {
    refreshRegister();
  }, [registerDate, registerTermId, classFilter, termsLoaded]);

  const loadAccounts = async () => {
    if (!canSeeAccounts) return;
    try {
      const response = await getFeedingAccounts({
        search: search || undefined,
        class_id: classFilter || undefined,
      });
      setAccounts(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load feeding accounts.');
    }
  };

  useEffect(() => {
    if (tab === 'accounts') loadAccounts();
  }, [tab, search, classFilter, canSeeAccounts]);

  const visibleRows = useMemo(() => register?.rows || [], [register]);

  const refreshSetup = async () => {
    const [termResponse, rateResponse] = await Promise.all([
      getFeedingTerms(),
      getFeedingRates(),
    ]);
    setTerms(termResponse.data);
    setTermsLoaded(true);
    setRates(rateResponse.data);
  };

  const submitTerm = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const response = await createFeedingTerm(termForm);
      const createdTerm = response.data;
      const termResponse = await getFeedingTerms();
      const nextTerms = termResponse.data;
      setTerms(nextTerms);
      setTermsLoaded(true);
      const matchingTerm = nextTerms.find((term) => (
        term.academic_year === createdTerm.academic_year
        && term.term === createdTerm.term
        && term.start_date <= registerDate
        && term.end_date >= registerDate
      )) || nextTerms.find((term) => String(term.id) === String(createdTerm.id));
      if (matchingTerm) setRegisterTermId(String(matchingTerm.id));
      setRegisterDate((current) => {
        if (current >= createdTerm.start_date && current <= createdTerm.end_date) return current;
        return createdTerm.start_date;
      });
      setNotice('Feeding term and scheduled weekdays saved.');
      setTab('register');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save feeding term.');
    } finally {
      setBusy(false);
    }
  };

  const submitRate = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await createFeedingRate(rateForm);
      const response = await getFeedingRates();
      setRates(response.data);
      setNotice('New class rate saved. Existing obligations and receipts were not changed.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save feeding rate.');
    } finally {
      setBusy(false);
    }
  };

  const submitException = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await createFeedingCalendarException({
        ...exceptionForm,
        term_id: Number(exceptionForm.term_id),
        class_id: exceptionForm.class_id || null,
      });
      await refreshRegister();
      setNotice('Calendar exception approved and saved.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save calendar exception.');
    } finally {
      setBusy(false);
    }
  };

  const saveCoverage = async (row) => {
    if (!row.obligation_id) return;
    setError('');
    try {
      await updateFeedingCoverage(row.obligation_id, !row.is_served);
      await refreshRegister();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update feeding coverage.');
    }
  };

  const changeFrequency = async (frequency) => {
    setError('');
    try {
      const saved = await setFeedingFrequency(selectedStudent, frequency);
      const response = await getFeedingAccount(selectedStudent, { date: registerDate });
      setAccount(response.data);
      setNotice(`Payment frequency will apply from ${saved.data.effective_from}. Earlier obligations and payment history are unchanged.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update payment frequency.');
    }
  };

  const recordFeedingPayment = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const selectedTerm = terms.find((term) => (
        term.start_date <= paymentForm.payment_date && term.end_date >= paymentForm.payment_date
      ));
      const response = await recordSchoolPayment({
        student_id: paymentStudent.student_id,
        school_fee_amount: 0,
        feeding_amount: paymentForm.amount,
        payment_method: paymentForm.payment_method,
        payment_date: paymentForm.payment_date,
        reference: paymentForm.reference,
        ...(selectedTerm ? { academic_year: selectedTerm.academic_year, term: selectedTerm.term } : {}),
        idempotency_key: paymentKey.current,
      });
      paymentKey.current = makeRequestKey();
      setPaymentStudent(null);
      setPaymentForm({ amount: '', payment_method: 'cash', payment_date: today(), reference: '' });
      setNotice(`Feeding payment recorded. Receipt ${response.data.receipt_number}.`);
      setLastPaymentReceipt(response.data);
      await refreshRegister();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to record feeding payment.');
    } finally {
      setBusy(false);
    }
  };

  const runReport = async () => {
    setError('');
    try {
      const params = {
        report_type: reportType,
        date: reportStart,
        class_id: classFilter || undefined,
      };
      if (['class_collections', 'payment_history'].includes(reportType)) {
        params.start_date = reportStart;
        params.end_date = reportEnd;
      }
      const response = await getFeedingReport(params);
      setReport(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to generate feeding report.');
    }
  };

  const downloadReport = async () => {
    setError('');
    try {
      const params = {
        report_type: reportType,
        date: reportStart,
        class_id: classFilter || undefined,
      };
      if (['class_collections', 'payment_history'].includes(reportType)) {
        params.start_date = reportStart;
        params.end_date = reportEnd;
      }
      const response = await exportFeedingReport(params);
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feeding-${reportType}-${reportStart}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to export feeding report.');
    }
  };

  const setWeekday = (weekday, enabled) => {
    setTermForm((current) => ({
      ...current,
      scheduled_weekdays: enabled
        ? [...current.scheduled_weekdays, weekday].sort()
        : current.scheduled_weekdays.filter((day) => day !== weekday),
    }));
  };

  if (loading) return <div className="page"><p>Loading feeding module...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero fees-hero">
          <div>
            <p className="eyebrow">Student feeding</p>
            <h1>Lunch Register & Feeding</h1>
            <p>Compulsory student accounts, scheduled feeding days, class rates, coverage, and cashier-recorded payments.</p>
          </div>
        </section>

        {error && <div className="error">{error}</div>}
        {notice && <div className="success">{notice}{lastPaymentReceipt && <div><Link to={`/payment-receipt/${lastPaymentReceipt.id}`}>Open printable receipt</Link></div>}</div>}

        <nav className="toolbar" aria-label="Feeding sections">
          {[
            ['register', 'Daily register'],
            ...(canSeeAccounts ? [['accounts', 'Student accounts']] : []),
            ...(canSeeCalendarRates ? [['configuration', 'Rates & calendar']] : []),
            ...(canSeeAccounts ? [['reports', 'Reports']] : []),
          ].map(([value, label]) => (
            <button key={value} className={tab === value ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(value)}>{label}</button>
          ))}
        </nav>

        {tab === 'register' && <>
          <section className="data-panel">
            <div className="toolbar">
              <label>Date <input type="date" value={registerDate} onChange={(event) => setRegisterDate(event.target.value)} /></label>
              <label>Feeding term
                <select
                  value={registerTermId}
                  disabled={!coveringTerms.length}
                  onChange={(event) => setRegisterTermId(event.target.value)}
                >
                  <option value="">Select a term covering this date</option>
                  {coveringTerms.map((term) => (
                    <option key={term.id} value={term.id}>{term.academic_year} · {term.term}</option>
                  ))}
                </select>
              </label>
              <label>Class
                <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                  <option value="">All classes</option>
                  {classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
                </select>
              </label>
              <button className="btn-secondary" onClick={refreshRegister}>Refresh</button>
              {register && <span>{register.academic_year} · {register.term}</span>}
            </div>
            {termsLoaded && !coveringTerms.length && isAdmin && <div className="error" role="alert">
              No feeding term covers {registerDate}.
              <button type="button" className="btn-secondary" onClick={() => {
                setTermForm((current) => ({
        ...current,
        start_date: registerDate,
        end_date: registerDate,
        academic_year: current.academic_year || `${new Date(registerDate).getUTCFullYear()}/${new Date(registerDate).getUTCFullYear() + 1}`,
        scheduled_weekdays: [1, 2, 3, 4, 5],
      }));
                setTab('configuration');
              }}>Configure a term for this date</button>
            </div>}
            {termsLoaded && !coveringTerms.length && !isAdmin && <div className="error" role="alert">
              No feeding term covers {registerDate}. Ask an administrator to configure a term for this date.
            </div>}
            {register?.unconfigured_feeding_days > 0 && (
              <div className="error">{register.unconfigured_feeding_days} scheduled feeding day(s) are missing a class rate.</div>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Student</th><th>Admission no.</th><th>Class</th><th>Frequency</th>
                  <th>Daily rate</th><th>Payment status</th><th>Coverage</th><th>Outstanding</th><th>Actions</th>
                </tr></thead>
                <tbody>{visibleRows.map((row) => (
                  <tr key={row.student_id}>
                    <td>{row.student_name}</td>
                    <td>{row.admission_number}</td>
                    <td>{row.class_name || 'Unassigned'}</td>
                    <td>{frequencyNames[row.payment_frequency] || row.payment_frequency}</td>
                    <td>{row.daily_rate ? formatMoney(row.daily_rate) : '-'}</td>
                    <td>{row.payment_status}</td>
                    <td>{row.coverage_status}</td>
                    <td>{row.obligation_id ? formatMoney(row.outstanding_balance) : '-'}</td>
                    <td className="actions">
                      {row.obligation_id && <button className="btn-small btn-edit" onClick={() => saveCoverage(row)}>
                        {row.is_served ? 'Undo served' : 'Mark served'}
                      </button>}
                      {canRecordPayment && <button className="btn-small btn-edit" onClick={() => {
                        setPaymentStudent(row);
                        setPaymentForm({ amount: '', payment_method: 'cash', payment_date: registerDate, reference: '' });
                        paymentKey.current = makeRequestKey();
                      }}>Record feeding payment</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {register && !visibleRows.length && <p className="empty-state">No enrolled students found for this register.</p>}
          </section>
        </>}

        {tab === 'accounts' && canSeeAccounts && <section className="data-panel">
          <div className="toolbar">
            <input type="search" placeholder="Search student name or admission number" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">All classes</option>
              {classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
            </select>
            <select value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}>
              <option value="">Select a student</option>
              {accounts.map((student) => <option key={student.id} value={student.id}>{student.admission_number} · {student.name}</option>)}
            </select>
          </div>
          {account && <>
            <div className="module-stats">
              <div className="mini-stat"><span>Class / rate</span><strong>{account.student.class_name || 'Unassigned'} · {account.daily_rate ? formatMoney(account.daily_rate) : 'Rate not configured'}</strong></div>
              <div className="mini-stat"><span>Period obligation</span><strong>{formatMoney(account.amount_due)}</strong></div>
              <div className="mini-stat"><span>Paid / outstanding</span><strong>{formatMoney(account.amount_paid)} / {formatMoney(account.outstanding_balance)}</strong></div>
              <div className="mini-stat"><span>Advance credit / coverage</span><strong>{formatMoney(account.advance_credit)} / {account.coverage_days} day(s)</strong></div>
            </div>
            <div className="toolbar">
              <span>Payment frequency</span>
              {isAdmin || user?.role === 'accountant' ? (
                <select value={account.student.payment_frequency} onChange={(event) => changeFrequency(event.target.value)}>
                  {Object.entries(frequencyNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              ) : (
                <strong>{frequencyNames[account.student.payment_frequency] || account.student.payment_frequency}</strong>
              )}
              <span>{account.term ? `${account.term.academic_year} · ${account.term.term}` : account.configuration_message}</span>
            </div>
            {account.unconfigured_feeding_days > 0 && <div className="error">Rates are missing for {account.unconfigured_feeding_days} scheduled day(s).</div>}
            <h2>Obligations and coverage</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Class</th><th>Rate</th><th>Due</th><th>Paid</th><th>Balance</th><th>Payment</th><th>Coverage</th></tr></thead>
              <tbody>{account.obligations.map((obligation) => (
                <tr key={obligation.id}>
                  <td>{obligation.feeding_date}</td><td>{obligation.class_name || 'Unassigned'}</td>
                  <td>{formatMoney(obligation.daily_rate)}</td><td>{formatMoney(obligation.amount_due)}</td>
                  <td>{formatMoney(obligation.amount_paid)}</td>
                  <td>{formatMoney(Math.max(0, Number(obligation.amount_due) - Number(obligation.amount_paid)))}</td>
                  <td>{obligation.payment_status}</td><td>{obligation.coverage_status}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <h2>Payment history</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Receipt</th>{isFeedingOfficer ? null : <><th>School fees</th><th>Total</th></>}<th>Feeding</th><th>Refunded</th><th>Reference</th></tr></thead>
              <tbody>{account.payment_history.map((payment) => (
                <tr key={payment.id}><td>{payment.payment_date}</td><td>{payment.receipt_number}</td>
                  {isFeedingOfficer ? null : <><td>{formatMoney(payment.school_fee_amount)}</td><td>{formatMoney(payment.amount_total)}</td></>}
                  <td>{formatMoney(payment.feeding_amount)}</td><td>{formatMoney(payment.refunded_amount)}</td><td>{payment.reference || '-'}</td></tr>
              ))}</tbody>
            </table></div>
            <h2>Payment frequency history</h2>
            <p>{account.frequency_history.map((item) => `${item.effective_from}: ${frequencyNames[item.payment_frequency]}${item.changed_by_name ? ` by ${item.changed_by_name}` : ''}`).join(' · ') || 'No changes recorded.'}</p>
          </>}
        </section>}

        {tab === 'configuration' && canSeeCalendarRates && <div className="split-layout">
          <section className="data-panel">
            <h2>Feeding terms and calendar</h2>
            {isAdmin && <form className="form-panel" onSubmit={submitTerm}>
              <label>Academic year<input value={termForm.academic_year} onChange={(event) => setTermForm({ ...termForm, academic_year: event.target.value })} required /></label>
              <label>Term<input value={termForm.term} onChange={(event) => setTermForm({ ...termForm, term: event.target.value })} required /></label>
              <label>Start date<input type="date" value={termForm.start_date} onChange={(event) => setTermForm({ ...termForm, start_date: event.target.value })} required /></label>
              <label>End date<input type="date" value={termForm.end_date} onChange={(event) => setTermForm({ ...termForm, end_date: event.target.value })} required /></label>
              <fieldset><legend>Scheduled feeding weekdays</legend>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => (
                  <label key={day}><input type="checkbox" checked={termForm.scheduled_weekdays.includes(index + 1)} onChange={(event) => setWeekday(index + 1, event.target.checked)} /> {day}</label>
                ))}
              </fieldset>
              <button className="btn-primary" disabled={busy}>Create term</button>
            </form>}
            <div className="table-wrap"><table>
              <thead><tr><th>Academic year</th><th>Term</th><th>Dates</th><th>Weekdays</th><th>Approved exceptions</th></tr></thead>
              <tbody>{terms.map((term) => <tr key={term.id}><td>{term.academic_year}</td><td>{term.term}</td>
                <td>{term.start_date} - {term.end_date}</td>
                <td>{term.scheduled_weekdays.map((day) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]).join(', ')}</td>
                <td>{term.exceptions.map((exception) => `${exception.name} (${exception.event_type}: ${exception.start_date} - ${exception.end_date})`).join('; ') || '-'}</td></tr>)}</tbody>
            </table></div>
            <h3>Approved holidays, vacations, and school days</h3>
            {isAdmin && <form className="form-panel" onSubmit={submitException}>
              <label>Term<select value={exceptionForm.term_id} onChange={(event) => setExceptionForm({ ...exceptionForm, term_id: event.target.value })} required>
                <option value="">Choose term</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.academic_year} · {term.term}</option>)}
              </select></label>
              <label>Class scope<select value={exceptionForm.class_id} onChange={(event) => setExceptionForm({ ...exceptionForm, class_id: event.target.value })}>
                <option value="">All classes</option>{classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
              </select></label>
              <label>Name<input value={exceptionForm.name} onChange={(event) => setExceptionForm({ ...exceptionForm, name: event.target.value })} required maxLength={120} /></label>
              <label>Type<select value={exceptionForm.event_type} onChange={(event) => setExceptionForm({ ...exceptionForm, event_type: event.target.value })}>
                <option value="holiday">Holiday</option><option value="vacation">Vacation</option><option value="school_day">Additional school day</option>
              </select></label>
              <label>Start date<input type="date" value={exceptionForm.start_date} onChange={(event) => setExceptionForm({ ...exceptionForm, start_date: event.target.value })} required /></label>
              <label>End date<input type="date" value={exceptionForm.end_date} onChange={(event) => setExceptionForm({ ...exceptionForm, end_date: event.target.value })} required /></label>
              <button className="btn-primary" disabled={busy}>Save calendar exception</button>
            </form>}
          </section>

          <section className="data-panel">
            <h2>Class feeding rates</h2>
            <p>Rates are daily amounts. Rate changes are effective-dated; past obligations remain unchanged.</p>
            {isAdmin && <form className="form-panel" onSubmit={submitRate}>
              <label>Class<select value={rateForm.class_id} onChange={(event) => setRateForm({ ...rateForm, class_id: event.target.value })} required>
                <option value="">Choose class</option>{classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
              </select></label>
              <label>Academic year<select value={rateForm.academic_year} onChange={(event) => setRateForm({ ...rateForm, academic_year: event.target.value })} required>
                <option value="">Choose term</option>{[...new Set(terms.map((term) => term.academic_year))].map((academicYear) => <option key={academicYear} value={academicYear}>{academicYear}</option>)}
              </select></label>
              <label>Term<select value={rateForm.term} onChange={(event) => setRateForm({ ...rateForm, term: event.target.value })} required>
                <option value="">Choose term</option>{terms.filter((term) => !rateForm.academic_year || term.academic_year === rateForm.academic_year).map((term) => <option key={term.id} value={term.term}>{term.term}</option>)}
              </select></label>
              <label>Daily rate<input type="number" min="0.01" step="0.01" value={rateForm.daily_rate} onChange={(event) => setRateForm({ ...rateForm, daily_rate: event.target.value })} required /></label>
              <label>Effective date<input type="date" value={rateForm.effective_date} onChange={(event) => setRateForm({ ...rateForm, effective_date: event.target.value })} required /></label>
              <button className="btn-primary" disabled={busy}>Add rate</button>
            </form>}
            <div className="table-wrap"><table>
              <thead><tr><th>Class</th><th>Term</th><th>Daily rate</th><th>Effective</th><th>Changed by</th></tr></thead>
              <tbody>{rates.map((rate) => <tr key={rate.id}><td>{rate.class_name}</td>
                <td>{rate.academic_year} · {rate.term}</td><td>{formatMoney(rate.daily_rate)}</td>
                <td>{rate.effective_date}</td><td>{rate.created_by_name || '-'}</td></tr>)}</tbody>
            </table></div>
          </section>
        </div>}

        {tab === 'reports' && canSeeAccounts && <section className="data-panel">
          <div className="toolbar">
            <label>Report<select value={reportType} onChange={(event) => setReportType(event.target.value)}>
              {Object.entries(reportNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>{['class_collections', 'payment_history'].includes(reportType) ? 'Start date' : 'Selected date'}<input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
            {['class_collections', 'payment_history'].includes(reportType) && <label>End date<input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>}
            <button className="btn-primary" onClick={runReport}>Run report</button>
            <button className="btn-secondary" onClick={downloadReport}>Export Excel</button>
          </div>
          {report && <>
            <h2>{reportNames[report.report_type]} · {report.range.startDate} – {report.range.endDate}</h2>
            {report.unconfigured_feeding_days > 0 && <div className="error">{report.unconfigured_feeding_days} feeding day(s) have no configured class rate.</div>}
            {report.rows.length ? <div className="table-wrap"><table>
              <thead><tr>{Object.keys(report.rows[0]).map((key) => <th key={key}>{key.replace(/_/g, ' ')}</th>)}</tr></thead>
              <tbody>{report.rows.map((row, index) => <tr key={row.id || row.student_id || row.receipt_number || `${index}`}>
                {Object.entries(row).map(([key, value]) => <td key={key}>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : /amount|rate|balance|collected|refunded/i.test(key) ? formatMoney(value) : value ?? '-'}</td>)}
              </tr>)}</tbody>
            </table></div> : <p className="empty-state">No rows match this report.</p>}
          </>}
        </section>}
      </div>

      {paymentStudent && (
        <div className="modal-overlay" onClick={() => setPaymentStudent(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><h2>Record feeding payment</h2><button className="btn-close" onClick={() => setPaymentStudent(null)}>x</button></div>
            <p>{paymentStudent.student_name} · {paymentStudent.admission_number} · {paymentStudent.class_name || 'Unassigned'}</p>
            <form className="form-panel" onSubmit={recordFeedingPayment}>
              <label>Amount<input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /></label>
              <label>Payment date<input type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} required /></label>
              <label>Method<select value={paymentForm.payment_method} onChange={(event) => setPaymentForm({ ...paymentForm, payment_method: event.target.value })}>
                <option value="cash">Cash</option><option value="mobile_money">Mobile money (cashier recorded)</option>
                <option value="bank_transfer">Bank transfer (cashier recorded)</option><option value="other">Other</option>
              </select></label>
              <label>Reference<input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} maxLength={120} /></label>
              <button className="btn-primary" disabled={busy}>Record payment</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Feeding;
