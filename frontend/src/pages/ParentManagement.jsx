import { useEffect, useState } from 'react';
import api from '../api/api';

function ParentManagement() {
  const [parents, setParents] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', relationship: 'Parent', student_ids: [] });
  const [linkForms, setLinkForms] = useState({});
  const [enquiryForms, setEnquiryForms] = useState({});
  const [credentials, setCredentials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const [parentResponse, studentResponse, enquiryResponse] = await Promise.all([
      api.get('/parent-portal/admin/parents'),
      api.get('/students'),
      api.get('/parent-portal/admin/enquiries'),
    ]);
    setParents(parentResponse.data);
    setStudents(studentResponse.data);
    setEnquiries(enquiryResponse.data);
  };
  useEffect(() => {
    load().catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load parent accounts.'))
      .finally(() => setLoading(false));
  }, []);

  const createParent = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage(''); setCredentials(null);
    try {
      const response = await api.post('/parent-portal/admin/parents', form);
      setCredentials(response.data);
      setForm({ name: '', email: '', phone: '', relationship: 'Parent', student_ids: [] });
      setMessage('Parent account created. Share this temporary password with the guardian securely.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create parent account.');
    } finally { setSaving(false); }
  };
  const setStatus = async (parent) => {
    setError(''); setMessage('');
    try {
      await api.patch(`/parent-portal/admin/parents/${parent.id}`, { is_active: !parent.is_active });
      setParents((current) => current.map((item) => item.id === parent.id ? { ...item, is_active: !parent.is_active } : item));
      setMessage(`Account ${parent.is_active ? 'suspended' : 'activated'}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update parent account.');
    }
  };
  const addChild = async (parentId) => {
    const student_id = Number(linkForms[parentId]?.student_id);
    if (!student_id) return setError('Select a child before linking.');
    setError(''); setMessage('');
    try {
      await api.post(`/parent-portal/admin/parents/${parentId}/children`, {
        student_id, relationship: linkForms[parentId]?.relationship || 'Parent',
      });
      setLinkForms((current) => ({ ...current, [parentId]: { student_id: '', relationship: 'Parent' } }));
      setMessage('Child link saved.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to link child.');
    }
  };
  const updateEnquiry = async (enquiry) => {
    const values = enquiryForms[enquiry.id] || {};
    const status = values.status || (enquiry.status === 'pending' ? 'in_review' : enquiry.status);
    setError(''); setMessage('');
    try {
      await api.patch(`/parent-portal/admin/enquiries/${enquiry.id}`, {
        status,
        school_response: values.school_response || '',
      });
      setMessage('Parent request updated.');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update parent request.');
    }
  };
  const reissueAccess = async (parent) => {
    setError(''); setMessage(''); setCredentials(null);
    try {
      const response = await api.post(`/parent-portal/admin/parents/${parent.id}/invitations`);
      setCredentials(response.data);
      setMessage(`A new sign-in credential is ready for ${parent.name}. Share it with the guardian securely.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reissue parent access.');
    }
  };
  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return <div className="page module-page parent-admin-page"><div className="module-shell">
    <section className="module-hero"><div><p className="eyebrow">Administration</p><h1>Parent accounts</h1><p>Create parent logins and manage approved guardian links.</p></div></section>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="teacher-badge" role="status">{message}</div>}
    {credentials && <div className="parent-credentials"><strong>Temporary password</strong><code>{credentials.temporary_password}</code><span>Shown once. The parent must change it at first login.</span></div>}
    <form className="data-panel form-panel" onSubmit={createParent}>
      <div className="panel-heading"><div><p className="eyebrow">New account</p><h2>Create a parent</h2></div></div>
      <div className="parent-admin-fields">
        <label>Parent name<input required maxLength="150" value={form.name} onChange={(event) => updateForm('name', event.target.value)} /></label>
        <label>Email address<input required type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} /></label>
        <label>Registered phone<input type="tel" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} /></label>
        <label>Relationship<input value={form.relationship || 'Parent'} onChange={(event) => updateForm('relationship', event.target.value)} /></label>
      </div>
      <label>Link existing children now (optional)
        <select multiple value={form.student_ids.map(String)} onChange={(event) => updateForm('student_ids', Array.from(event.target.selectedOptions, (option) => Number(option.value)))} size={Math.min(6, Math.max(3, students.length))}>
          {students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.student_id} · {student.class_name || 'No class'}</option>)}
        </select>
      </label>
      <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create parent account'}</button>
    </form>
    <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Family access</p><h2>Parent accounts</h2></div></div>
      <label className="parent-admin-search">Search parent accounts<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone, or child" /></label>
      {loading ? <p role="status">Loading accounts…</p> : parents.filter((parent) => `${parent.name} ${parent.email} ${parent.phone || ''} ${parent.children.map((child) => child.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())).length ? <div className="table-wrap"><table><thead><tr><th>Parent</th><th>Contact</th><th>Linked children</th><th>Status</th><th>Manage links</th><th></th></tr></thead><tbody>
        {parents.filter((parent) => `${parent.name} ${parent.email} ${parent.phone || ''} ${parent.children.map((child) => child.name).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())).map((parent) => <tr key={parent.id}><td>{parent.name}</td><td>{parent.email}<br />{parent.phone || 'No phone'}</td>
          <td>{parent.children.map((child) => <div className="parent-admin-child" key={child.id}>{child.name} · {child.class_name || 'No class'} ({child.relationship})
            <button className="parent-text-button" onClick={async () => {
              setError(''); setMessage('');
              try {
                await api.delete(`/parent-portal/admin/parents/${parent.id}/children/${child.id}`);
                setMessage('Child link removed.');
                await load();
              } catch (requestError) {
                setError(requestError.response?.data?.message || 'Unable to remove child link.');
              }
            }}>Remove</button>
          </div>)}</td>
          <td>{parent.is_active ? 'Active' : 'Suspended'}</td>
          <td><div className="parent-admin-link">
            <select aria-label={`Child to link to ${parent.name}`} value={linkForms[parent.id]?.student_id || ''} onChange={(event) => setLinkForms((current) => ({ ...current, [parent.id]: { ...current[parent.id], student_id: event.target.value } }))}>
              <option value="">Select child</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.student_id}</option>)}
            </select>
            <button className="btn-small btn-edit" onClick={() => addChild(parent.id)}>Link</button>
          </div></td>
          <td><button className="btn-small btn-edit" onClick={() => setStatus(parent)}>{parent.is_active ? 'Suspend' : 'Activate'}</button>
            {parent.is_active && <button className="btn-small btn-edit" onClick={() => reissueAccess(parent)} style={{ marginTop: '.35rem' }}>Reissue invite</button>}</td>
        </tr>)}
      </tbody></table></div> : <p className="empty-state">No parent accounts have been created.</p>}
    </section>
    <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Family communication</p><h2>Parent enquiries and correction requests</h2></div></div>
      {loading ? <p role="status">Loading parent requests…</p> : enquiries.length ? <div className="parent-admin-enquiries">
        {enquiries.map((enquiry) => {
          const values = enquiryForms[enquiry.id] || {};
          return <article className="parent-admin-enquiry" key={enquiry.id}>
            <div className="parent-panel-heading"><div><strong>{enquiry.subject}</strong><p>{enquiry.parent_name} · {enquiry.parent_email}{enquiry.phone ? ` · ${enquiry.phone}` : ''}</p>
              <small>{enquiry.request_type.replace('_', ' ')}{enquiry.student_name ? ` · ${enquiry.student_name}` : ''} · {new Date(enquiry.created_at).toLocaleString()}</small></div>
              <span className={`parent-request-status ${enquiry.status}`}>{enquiry.status.replace('_', ' ')}</span>
            </div>
            <p>{enquiry.message}</p>
            {enquiry.school_response && <p className="parent-response"><strong>Previous response:</strong> {enquiry.school_response}</p>}
            <div className="parent-admin-enquiry-controls">
              <select aria-label={`Request status for ${enquiry.subject}`} value={values.status || enquiry.status}
                onChange={(event) => setEnquiryForms((current) => ({ ...current, [enquiry.id]: { ...current[enquiry.id], status: event.target.value } }))}>
                <option value="pending">Pending</option><option value="in_review">In review</option><option value="responded">Responded</option><option value="closed">Closed</option>
              </select>
              <textarea aria-label={`Response to ${enquiry.subject}`} rows="2" maxLength="4000" placeholder="Write a response (required for Responded)"
                value={values.school_response ?? enquiry.school_response ?? ''}
                onChange={(event) => setEnquiryForms((current) => ({ ...current, [enquiry.id]: { ...current[enquiry.id], school_response: event.target.value } }))} />
              <button className="btn-small btn-edit" onClick={() => updateEnquiry(enquiry)}>Save / reply</button>
            </div>
          </article>;
        })}
      </div> : <p className="empty-state">No parent enquiries or correction requests.</p>}
    </section>
  </div></div>;
}

export default ParentManagement;
