import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownToLine, BookOpen, Boxes, CalendarDays, Camera, Check,
  CircleAlert, Clock3, Plus, Search, SquarePen, Users, X
} from 'lucide-react';
import {
  createBook, getActiveLoansByBookCode, getBooks, getBorrowers, getLibraryDashboard, getLoans, lookupBookByIsbn,
  getMyLoans, issueLoan, returnLoan, updateBook
} from '../api/library';
import { printBarcodeLabel } from '../utils/barcode';

const blankBook = {
  title: '', author: '', isbn: '', book_code: '', category: 'General',
  publisher: '', shelf_location: '', total_copies: 1,
};

const roleNames = { admin: 'Administrator', librarian: 'Librarian', inventory: 'Inventory', store: 'Inventory', teacher: 'Teacher' };

function LibraryWorkspace() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const canManage = ['admin', 'librarian'].includes(user?.role);
  const [view, setView] = useState('catalogue');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('borrowed');
  const [dashboard, setDashboard] = useState({});
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [borrowers, setBorrowers] = useState({ students: [], staff: [] });
  const [book, setBook] = useState({ ...blankBook });
  const [editingId, setEditingId] = useState(null);
  const [loan, setLoan] = useState({ book_id: '', borrower_type: 'student', borrower_id: '', due_date: '' });
  const [scanCode, setScanCode] = useState('');
  const [returnCode, setReturnCode] = useState('');
  const [returnMatches, setReturnMatches] = useState([]);
  const [cameraScan, setCameraScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const videoRef = useRef(null);
  const booksRef = useRef(books);
  const scannedBookHandler = useRef(null);
  const issueScanTimer = useRef(null);
  const returnScanTimer = useRef(null);
  const isbnLookupTimer = useRef(null);
  const isbnLookupRequest = useRef(0);
  booksRef.current = books;

  const loadData = async () => {
    const requests = [getLibraryDashboard(), getBooks()];
    if (canManage) requests.push(getLoans(status), getBorrowers());
    else requests.push(getMyLoans());
    const [dashboardResponse, booksResponse, loansResponse, borrowersResponse] = await Promise.all(requests);
    setDashboard(dashboardResponse.data);
    setBooks(booksResponse.data);
    setLoans(loansResponse.data);
    if (canManage) setBorrowers(borrowersResponse.data);
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    loadData().catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load library data.');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [status]);

  const showSuccess = (text) => {
    setError('');
    setMessage(text);
  };

  const updateBookCode = (rawCode) => {
    const code = rawCode.toUpperCase();
    setBook((current) => ({ ...current, book_code: code }));
    setError('');
    setMessage('');
    window.clearTimeout(isbnLookupTimer.current);
    const normalizedIsbn = code.replace(/[^0-9X]/g, '');
    if (!/^(?:\d{9}[\dX]|\d{13})$/.test(normalizedIsbn)) return;

    const requestId = ++isbnLookupRequest.current;
    isbnLookupTimer.current = window.setTimeout(async () => {
      setMessage(`Looking up ISBN ${normalizedIsbn}…`);
      try {
        const response = await lookupBookByIsbn(normalizedIsbn);
        if (requestId !== isbnLookupRequest.current) return;
        const details = response.data;
        setBook((current) => current.book_code.replace(/[^0-9X]/g, '') === normalizedIsbn
          ? {
            ...current,
            title: current.title || details.title,
            author: current.author || details.author,
            isbn: current.isbn || details.isbn || normalizedIsbn,
            publisher: current.publisher || details.publisher,
            category: current.category === 'General' ? details.category || 'General' : current.category,
          }
          : current);
        showSuccess(`Found ${details.title || 'book details'} for ISBN ${normalizedIsbn}. Review the details and add the title.`);
      } catch (requestError) {
        if (requestId !== isbnLookupRequest.current) return;
        setError(requestError.response?.data?.message || 'Could not look up this ISBN. Enter the book details manually.');
        setMessage('');
      }
    }, 500);
  };

  const selectScannedBook = (rawCode) => {
    const code = String(rawCode || '').trim().toLocaleUpperCase();
    const isbnCode = code.replace(/[^A-Z0-9]/g, '');
    if (!code) return;
    const catalogue = booksRef.current;
    let matches = catalogue.filter((item) => String(item.book_code || '').trim().toLocaleUpperCase() === code);
    if (!matches.length) {
      matches = catalogue.filter((item) => String(item.isbn || '').toLocaleUpperCase().replace(/[^A-Z0-9]/g, '') === isbnCode);
    }
    if (!matches.length) {
      setMessage('');
      setError(`No catalogue book matches scanned code “${String(rawCode).trim()}”.`);
      return;
    }
    if (matches.length > 1) {
      setMessage('');
      setError('That ISBN belongs to multiple titles. Scan the unique book-code QR label instead.');
      return;
    }
    const found = matches[0];
    if (found.available_copies < 1) {
      setMessage('');
      setError(`${found.title} has no available copies to issue.`);
      return;
    }
    setLoan((current) => ({ ...current, book_id: String(found.id) }));
    setScanCode('');
    setError('');
    setMessage(`Scanned ${found.title}. Select a borrower and due date to issue it.`);
  };
  scannedBookHandler.current = selectScannedBook;

  useEffect(() => () => {
    window.clearTimeout(issueScanTimer.current);
    window.clearTimeout(returnScanTimer.current);
    window.clearTimeout(isbnLookupTimer.current);
  }, []);

  useEffect(() => {
    if (!cameraScan || view !== 'circulation') return undefined;
    let active = true;
    let stream;
    let scanTimer;

    const startCamera = async () => {
      const Detector = window.BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access is unavailable. Use a handheld QR scanner in the code field instead.');
        setCameraScan(false);
        return;
      }
      try {
        let detector;
        let decodeQr;
        if (Detector) {
          const supported = typeof Detector.getSupportedFormats === 'function'
            ? await Detector.getSupportedFormats()
            : ['qr_code', 'code_39'];
          const formats = ['qr_code', 'code_39'].filter((format) => supported.includes(format));
          if (formats.includes('qr_code')) detector = new Detector({ formats });
        }
        if (!detector) {
          const { default: jsQR } = await import('jsqr');
          decodeQr = jsQR;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) throw new Error('Camera preview is unavailable.');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Camera image processing is unavailable.');

        const scanFrame = async () => {
          if (!active) return;
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
              let value;
              if (detector) {
                const detected = await detector.detect(video);
                value = detected.find((item) => item.rawValue)?.rawValue;
              } else {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const image = context.getImageData(0, 0, canvas.width, canvas.height);
                value = decodeQr(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data;
              }
              if (value) {
                scannedBookHandler.current?.(value);
                setCameraScan(false);
                return;
              }
            } catch {
              if (active) {
                setError('Could not read the camera image. Adjust the book label and try again.');
                setCameraScan(false);
              }
              return;
            }
          }
          scanTimer = window.setTimeout(scanFrame, 250);
        };
        scanFrame();
      } catch (cameraError) {
        if (active) {
          setError(cameraError.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access or use a handheld QR scanner in the code field.'
            : 'Could not start the camera. Check that it is available and use a handheld QR scanner if needed.');
          setCameraScan(false);
        }
      }
    };

    startCamera();
    return () => {
      active = false;
      window.clearTimeout(scanTimer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraScan, view]);

  const printBookLabel = async (item) => {
    try {
      await printBarcodeLabel(item);
    } catch {
      setError('Unable to create the QR label. Please try again.');
    }
  };

  const saveBook = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = { ...book, total_copies: Number(book.total_copies) };
      if (editingId) await updateBook(editingId, payload);
      else await createBook(payload);
      setBook({ ...blankBook });
      setEditingId(null);
      setView('catalogue');
      showSuccess(editingId ? 'Book details updated.' : 'Book added to the catalogue.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save this book.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setBook({
      title: item.title, author: item.author, isbn: item.isbn || '',
      book_code: item.book_code, category: item.category || 'General',
      publisher: item.publisher || '', shelf_location: item.shelf_location || '',
      total_copies: item.total_copies,
    });
    setView('add');
  };

  const issueBook = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await issueLoan({ ...loan, book_id: Number(loan.book_id), borrower_id: Number(loan.borrower_id) });
      setLoan({ ...loan, book_id: '', borrower_id: '' });
      showSuccess('Book issued and added to the borrowing register.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to issue this book.');
    } finally {
      setBusy(false);
    }
  };

  const markReturned = async (loanId) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await returnLoan(loanId);
      setReturnMatches([]);
      showSuccess('Return recorded. One copy is available again.');
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to record this return.');
    } finally {
      setBusy(false);
    }
  };

  const scanReturn = async (rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code || busy) return;
    window.clearTimeout(returnScanTimer.current);
    setReturnCode('');
    setReturnMatches([]);
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const response = await getActiveLoansByBookCode(code);
      const matches = response.data;
      if (!matches.length) {
        setError(`No active loan matches barcode “${code}”.`);
      } else if (matches.length === 1) {
        await returnLoan(matches[0].id);
        showSuccess(`Returned ${matches[0].title} for ${matches[0].borrower_name}.`);
        await loadData();
      } else {
        setReturnMatches(matches);
        setMessage(`${matches.length} active loans match this barcode. Choose the borrower whose copy is being returned.`);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to find an active loan for this barcode.');
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setBook({ ...blankBook });
    setView('catalogue');
  };

  const today = new Date().toISOString().slice(0, 10);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBooks = books.filter((item) => [item.title, item.author, item.book_code, item.isbn, item.category]
    .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
  const staffLoans = loans.filter((item) => item.status === 'borrowed');
  const overdueCount = (canManage ? staffLoans : loans.filter((item) => item.status === 'borrowed'))
    .filter((item) => String(item.due_date).slice(0, 10) < today).length;
  const metrics = canManage
    ? [
      { label: 'Book titles', value: dashboard.titles || 0, icon: BookOpen, tone: 'forest' },
      { label: 'Total copies', value: dashboard.total_copies || 0, icon: Boxes, tone: 'blue' },
      { label: 'Available', value: dashboard.available_copies || 0, icon: Check, tone: 'green' },
      { label: 'On loan', value: dashboard.borrowed || 0, icon: Users, tone: 'rust' },
      { label: 'Overdue', value: dashboard.overdue || 0, icon: CircleAlert, tone: 'amber' },
    ]
    : [
      { label: 'Titles in catalogue', value: dashboard.titles || 0, icon: BookOpen, tone: 'forest' },
      { label: 'Available copies', value: dashboard.available_copies || 0, icon: Boxes, tone: 'green' },
      { label: 'My active loans', value: loans.filter((item) => item.status === 'borrowed').length, icon: Users, tone: 'blue' },
      { label: 'My overdue', value: overdueCount, icon: CircleAlert, tone: 'amber' },
    ];

  const tabs = canManage
    ? [['catalogue', 'Catalogue'], ['circulation', 'Circulation'], ['add', editingId ? 'Edit title' : 'Add a title']]
    : [['catalogue', 'Catalogue'], ['my-loans', 'My loans']];

  return (
    <div className="page library-workspace">
      <section className="library-heading">
        <div className="library-heading-mark"><BookOpen size={24} strokeWidth={1.7} /></div>
        <div className="library-heading-copy">
          <p>Learning resources <span> / </span>{roleNames[user?.role] || 'School staff'}</p>
          <h2>Library</h2>
          <span>{canManage ? 'Catalogue, stock, and circulation in one place.' : 'Browse available titles and keep track of your borrowed books.'}</span>
        </div>
        {canManage && <button className="library-primary-button library-heading-action" onClick={() => { setView('add'); setEditingId(null); setBook({ ...blankBook }); }}><Plus size={17} /> Add title</button>}
      </section>

      {error && <div className="library-alert library-alert-error" role="alert"><AlertCircle size={17} />{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {message && <div className="library-alert library-alert-success" role="status"><Check size={17} />{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}><X size={16} /></button></div>}

      <section className={`library-metrics${canManage ? '' : ' teacher-metrics'}`} aria-label="Library summary">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <article className="library-metric" key={label}>
            <span className={`library-metric-icon ${tone}`}><Icon size={18} strokeWidth={1.8} /></span>
            <div><span>{label}</span><strong>{value}</strong></div>
          </article>
        ))}
      </section>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} className={view === key ? 'selected' : ''} onClick={() => { setView(key); setError(''); setMessage(''); }}>
            {label}
          </button>
        ))}
        {view === 'catalogue' && <label className="library-search"><Search size={16} /><input aria-label="Search catalogue" placeholder="Title, author, category, or code" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></label>}
      </div>

      {loading ? <div className="library-loading"><span className="library-spinner" />Loading library records</div> : <>
        {view === 'catalogue' && <section className="library-surface">
          <div className="library-section-heading"><div><h3>Book catalogue</h3><p>{visibleBooks.length} {visibleBooks.length === 1 ? 'title' : 'titles'}{query ? ` matching “${query}”` : ' in this view'}</p></div></div>
          <div className="library-table-scroll">
            <table className="library-table">
              <thead><tr><th>Title / author</th><th>Book code</th><th>Location</th><th>Availability</th><th className="library-actions-column">Actions</th></tr></thead>
              <tbody>
                {visibleBooks.map((item) => <tr key={item.id}>
                  <td><div className="library-title-cell"><span className="book-spine"><BookOpen size={18} /></span><span><strong>{item.title}</strong><small>{item.author}{item.publisher ? ` · ${item.publisher}` : ''}</small></span></div></td>
                  <td><span className="library-code">{item.book_code}</span><small className="library-isbn">{item.isbn || 'No ISBN'}</small></td>
                  <td><span className="library-category">{item.category || 'General'}</span><small className="library-shelf">{item.shelf_location || 'No shelf assigned'}</small></td>
                  <td><span className={`stock-status${item.available_copies > 0 ? ' in-stock' : ' checked-out'}`}><i />{item.available_copies > 0 ? `${item.available_copies} of ${item.total_copies} available` : 'All copies out'}</span></td>
                  <td><div className="library-row-actions">
                    {canManage && <button className="library-icon-action" title="Edit title" aria-label={`Edit ${item.title}`} onClick={() => startEdit(item)}><SquarePen size={16} /></button>}
                    <button className="library-icon-action" title="Print QR and barcode label" aria-label={`Print QR and barcode label for ${item.title}`} onClick={() => printBookLabel(item)}><ArrowDownToLine size={16} /></button>
                  </div></td>
                </tr>)}
                {!visibleBooks.length && <tr><td colSpan="5" className="library-empty"><BookOpen size={25} /><strong>No titles found</strong><span>{query ? 'Try another title, author, or book code.' : 'Add a title to begin building the catalogue.'}</span></td></tr>}
              </tbody>
            </table>
          </div>
        </section>}

        {view === 'add' && canManage && <section className="library-surface library-form-surface">
          <div className="library-section-heading"><div><h3>{editingId ? 'Edit title' : 'Add a title'}</h3><p>Book codes are unique and printed as QR and Code 39 barcode labels.</p></div></div>
          <form className="library-form" onSubmit={saveBook}>
            <label>Title *<input required maxLength="180" value={book.title} onChange={(event) => setBook({ ...book, title: event.target.value })} /></label>
            <label>Author *<input required maxLength="140" value={book.author} onChange={(event) => setBook({ ...book, author: event.target.value })} /></label>
            <label>Book code / barcode *<input required autoFocus={!editingId} maxLength="40" autoComplete="off" placeholder="Scan ISBN to fill book details" value={book.book_code} onChange={(event) => updateBookCode(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }} /></label>
            <label>ISBN<input value={book.isbn} onChange={(event) => setBook({ ...book, isbn: event.target.value })} /></label>
            <label>Category<input value={book.category} onChange={(event) => setBook({ ...book, category: event.target.value })} /></label>
            <label>Publisher<input value={book.publisher} onChange={(event) => setBook({ ...book, publisher: event.target.value })} /></label>
            <label>Shelf location<input placeholder="e.g. B-04" value={book.shelf_location} onChange={(event) => setBook({ ...book, shelf_location: event.target.value })} /></label>
            <label>Copies *<input type="number" min="1" required value={book.total_copies} onChange={(event) => setBook({ ...book, total_copies: event.target.value })} /></label>
            <div className="library-form-note"><CircleAlert size={16} /> Copies cannot be reduced below the number currently checked out.</div>
            <div className="library-form-actions"><button type="button" className="library-quiet-button" onClick={cancelEdit}>Cancel</button><button type="submit" className="library-primary-button" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add to catalogue'}</button></div>
          </form>
        </section>}

        {view === 'circulation' && canManage && <div className="library-circulation">
          <section className="library-surface issue-surface">
            <div className="library-section-heading"><div><h3>Issue a book</h3><p>Choose a borrower and set a return date.</p></div><span className="circulation-heading-icon"><CalendarDays size={19} /></span></div>
            <div className="library-scan-panel">
              <div>
                <label htmlFor="library-book-scan">Scan book QR code or barcode</label>
                <span className="library-scan-entry">
                  <input id="library-book-scan" autoFocus autoComplete="off" placeholder="Scan book barcode or ISBN to select for issue" value={scanCode} onChange={(event) => {
                    const value = event.target.value;
                    setScanCode(value);
                    window.clearTimeout(issueScanTimer.current);
                    if (value.trim()) issueScanTimer.current = window.setTimeout(() => scannedBookHandler.current?.(value), 250);
                  }} onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      window.clearTimeout(issueScanTimer.current);
                      selectScannedBook(event.currentTarget.value);
                    }
                  }} />
                  <button type="button" className="library-quiet-button" onClick={() => selectScannedBook(scanCode)} disabled={!scanCode.trim()}>Use code</button>
                </span>
              </div>
              <button type="button" className="library-quiet-button library-camera-button" onClick={() => { setError(''); setMessage(''); setCameraScan((active) => !active); }}>
                <Camera size={15} /> {cameraScan ? 'Stop camera' : 'Use camera'}
              </button>
              {cameraScan && <div className="library-camera-frame"><video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview for scanning book QR codes" /><span>Point the camera at the book’s QR code.</span></div>}
              <p>Scan into the focused field. The book code appears while scanning and the matching title is selected automatically when the scan finishes.</p>
            </div>
            <form className="library-form" onSubmit={issueBook}>
              <label className="full-width">Book<select required value={loan.book_id} onChange={(event) => setLoan({ ...loan, book_id: event.target.value })}><option value="">Select an available title</option>{books.filter((item) => item.available_copies > 0).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.book_code} ({item.available_copies} available)</option>)}</select></label>
              <label>Borrower type<select value={loan.borrower_type} onChange={(event) => setLoan({ ...loan, borrower_type: event.target.value, borrower_id: '' })}><option value="student">Student</option><option value="staff">Staff</option></select></label>
              <label>{loan.borrower_type === 'student' ? 'Student' : 'Staff member'}<select required value={loan.borrower_id} onChange={(event) => setLoan({ ...loan, borrower_id: event.target.value })}><option value="">Select borrower</option>{(loan.borrower_type === 'student' ? borrowers.students : borrowers.staff).map((person) => <option key={person.id} value={person.id}>{person.name}{person.class_name ? ` · ${person.class_name}` : ''}{person.role ? ` · ${person.role}` : ''}</option>)}</select></label>
              <label>Due date<input type="date" min={today} required value={loan.due_date} onChange={(event) => setLoan({ ...loan, due_date: event.target.value })} /></label>
              <div className="library-form-actions full-width"><span className="library-no-fines"><Clock3 size={15} /> Overdue items are flagged; no fines are calculated.</span><button type="submit" className="library-primary-button" disabled={busy}>{busy ? 'Issuing…' : 'Issue book'}</button></div>
            </form>
          </section>

          <section className="library-surface register-surface">
            <div className="library-section-heading"><div><h3>Borrowing register</h3><p>Searchable record of issued and returned copies.</p></div><select className="library-filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="borrowed">Active loans</option><option value="all">All loans</option><option value="returned">Returned</option></select></div>
            <div className="library-return-scan">
              <label htmlFor="library-return-scan">Scan a book barcode or ISBN to return it</label>
              <form className="library-scan-entry" onSubmit={(event) => {
                event.preventDefault();
                window.clearTimeout(returnScanTimer.current);
                scanReturn(event.currentTarget.querySelector('input').value);
              }}>
                <input id="library-return-scan" autoComplete="off" placeholder="Focus here, then scan the borrowed book" value={returnCode} onChange={(event) => {
                  const value = event.target.value;
                  setReturnCode(value);
                  window.clearTimeout(returnScanTimer.current);
                  if (value.trim()) returnScanTimer.current = window.setTimeout(() => scanReturn(value), 250);
                }} disabled={busy} />
                <button type="submit" className="library-quiet-button" disabled={busy || !returnCode.trim()}>{busy ? 'Checking…' : 'Scan to return'}</button>
              </form>
              <p>Click this field and scan a borrowed book. A single matching loan is returned automatically; if there are multiple copies on loan, choose the correct borrower.</p>
            </div>
            {returnMatches.length > 0 && <div className="library-return-matches" role="status">
              {returnMatches.map((item) => <div className="library-return-match" key={item.id}>
                <span><strong>{item.borrower_name}</strong><small>{item.title} · due {String(item.due_date).slice(0, 10)}</small></span>
                <button type="button" className="library-return-button" disabled={busy} onClick={() => markReturned(item.id)}>Return this copy</button>
              </div>)}
            </div>}
            <LoanTable loans={loans} today={today} onReturn={markReturned} canReturn={!busy} />
          </section>
        </div>}

        {view === 'my-loans' && !canManage && <section className="library-surface">
          <div className="library-section-heading"><div><h3>My borrowing history</h3><p>Only your own issued books are shown here.</p></div></div>
          <LoanTable loans={loans} today={today} />
        </section>}
      </>}
    </div>
  );
}

function LoanTable({ loans, today, onReturn, canReturn = false }) {
  return <div className="library-table-scroll"><table className="library-table loan-table">
    <thead><tr><th>Title</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Status</th>{canReturn && <th>Action</th>}</tr></thead>
    <tbody>
      {loans.map((item) => {
        const overdue = item.status === 'borrowed' && String(item.due_date).slice(0, 10) < today;
        return <tr key={item.id}>
          <td><strong>{item.title}</strong><small className="library-isbn">{item.book_code}</small></td>
          <td>{item.borrower_name}<small className="library-isbn">{item.borrower_type}{item.class_name ? ` · ${item.class_name}` : ''}</small></td>
          <td>{new Date(item.issued_at).toLocaleDateString()}</td>
          <td>{String(item.due_date).slice(0, 10)}</td>
          <td><span className={`loan-status${overdue ? ' overdue' : item.status === 'returned' ? ' returned' : ''}`}>{overdue ? 'Overdue' : item.status === 'returned' ? 'Returned' : 'On loan'}</span></td>
          {canReturn && <td>{item.status === 'borrowed' && <button className="library-return-button" onClick={() => onReturn(item.id)}><Check size={14} /> Return</button>}</td>}
        </tr>;
      })}
      {!loans.length && <tr><td colSpan={canReturn ? 6 : 5} className="library-empty"><BookOpen size={25} /><strong>No borrowing records</strong><span>New issues and returns will appear here.</span></td></tr>}
    </tbody>
  </table></div>;
}

export default LibraryWorkspace;