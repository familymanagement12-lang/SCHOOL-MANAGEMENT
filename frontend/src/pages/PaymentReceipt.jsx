import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPaymentReceipt } from '../api/feeding';

const currencyCode = localStorage.getItem('sms_currency') || 'GHS';
const formatMoney = (value) => Number(value || 0).toLocaleString(undefined, {
  style: 'currency',
  currency: currencyCode,
});

function PaymentReceipt() {
  const { receiptId } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const isFeedingOfficer = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'feeding_tuckshop_officer'; } catch { return false; }
  })();
  const backPath = isFeedingOfficer ? '/feeding' : '/fees';

  useEffect(() => {
    getPaymentReceipt(receiptId)
      .then((response) => setReceipt(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load payment receipt.'));
  }, [receiptId]);

  if (error) return <div className="page"><div className="error">{error}</div><Link to={backPath}>Back to payments</Link></div>;
  if (!receipt) return <div className="page"><p>Loading receipt...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="data-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Payment receipt</p>
              <h1>{receipt.receipt_number}</h1>
              <p>{receipt.student_name} · {receipt.admission_number} · {receipt.class_name || 'Unassigned'}</p>
            </div>
            <button type="button" className="btn-primary" onClick={() => window.print()}>Print receipt</button>
          </div>
          <p>Date: {receipt.payment_date} · Method: {receipt.payment_method} · Reference: {receipt.reference || '-'}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Component</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>School fees</td><td>{formatMoney(receipt.school_fee_amount)}</td></tr>
                <tr><td>Feeding</td><td>{formatMoney(receipt.feeding_amount)}</td></tr>
                <tr><th>Total received</th><th>{formatMoney(receipt.amount_total)}</th></tr>
              </tbody>
            </table>
          </div>
          <h2>Allocations</h2>
          {receipt.allocations.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Account</th><th>Period / detail</th><th>Amount</th></tr></thead>
                <tbody>{receipt.allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td>{allocation.component === 'school_fee' ? 'School fees' : 'Feeding'}</td>
                    <td>{allocation.fee_description || [allocation.academic_year, allocation.term, allocation.feeding_date, allocation.class_name].filter(Boolean).join(' · ') || 'Advance credit'}</td>
                    <td>{formatMoney(allocation.amount)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>No component allocations were created for this receipt.</p>}
          {Number(receipt.feeding_advance_credit) > 0 && <p>Feeding advance credit not yet allocated: {formatMoney(receipt.feeding_advance_credit)}</p>}
          {receipt.refunds?.length > 0 && <p>Refunded: {formatMoney(receipt.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0))}</p>}
          <Link to={backPath}>Back to payments</Link>
        </section>
      </div>
    </div>
  );
}

export default PaymentReceipt;
