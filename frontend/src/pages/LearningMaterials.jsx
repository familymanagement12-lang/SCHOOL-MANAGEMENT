import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, Plus, RefreshCw } from 'lucide-react';
import { createLearningMaterial, downloadLearningMaterial, getLearningMaterialMeta, getLearningMaterials } from '../api/learningMaterials';

const saveBlob = (blob,name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href=url; link.download=name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url),1000);
};

function LearningMaterials() {
  const [meta,setMeta] = useState({ terms: [], pairs: [] });
  const [termId,setTermId] = useState('');
  const [items,setItems] = useState([]);
  const [form,setForm] = useState({ class_id:'',subject_id:'',teacher_id:'',title:'',description:'' });
  const [files,setFiles] = useState([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const isAdmin = user?.role === 'admin';
  const pairs = useMemo(() => meta.pairs.filter((pair) => String(pair.class_id)===form.class_id),[meta.pairs,form.class_id]);
  const subjects = useMemo(() => [...new Map(pairs.map((pair) => [pair.subject_id,pair])).values()],[pairs]);
  const teachers = useMemo(() => pairs.filter((pair) => String(pair.subject_id)===form.subject_id),[pairs,form.subject_id]);

  const load = async (selected=termId) => {
    const response=await getLearningMaterialMeta(selected || undefined);
    const active=selected || response.data.selected_term_id;
    const list=await getLearningMaterials(active);
    setMeta(response.data); setTermId(String(active || '')); setItems(list.data);
  };
  useEffect(() => { load('').catch((e) => setError(e.response?.data?.message || 'Unable to load learning materials.')); },[]);

  const changeTerm = async (value) => {
    setTermId(value); setForm((current) => ({...current,class_id:'',subject_id:'',teacher_id:''}));
    try { await load(value); setError(''); } catch (e) { setError(e.response?.data?.message || 'Unable to load this term.'); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!files.length) { setError('Attach at least one file before publishing.'); return; }
    const data=new FormData();
    Object.entries({...form,term_id:termId}).forEach(([key,value]) => data.append(key,value));
    files.forEach((file) => data.append('files',file));
    setBusy(true); setError(''); setMessage('');
    try {
      await createLearningMaterial(data);
      setMessage('Learning material published to the selected class.');
      setForm({class_id:'',subject_id:'',teacher_id:'',title:'',description:''}); setFiles([]);
      await load(termId);
    } catch (e) { setError(e.response?.data?.message || 'Unable to publish learning material.'); }
    finally { setBusy(false); }
  };
  const download = async (item,file) => {
    setBusy(true); setError('');
    try { const response=await downloadLearningMaterial(item.id,file.id); saveBlob(response.data,file.original_name); }
    catch (e) { setError(e.response?.data?.message || 'Unable to download this file.'); }
    finally { setBusy(false); }
  };

  return <div className="page module-page"><div className="module-shell">
    <section className="module-hero"><div><p className="eyebrow">Teaching and learning</p><h1>Learning Materials</h1><p>Publish class resources in private storage for enrolled students.</p></div></section>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
    <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Term</p><h2>Class resources</h2></div>
      <label>Academic term<select value={termId} onChange={(e)=>changeTerm(e.target.value)}>{meta.terms.map((term)=><option key={term.id} value={term.id}>{term.academic_year} · {term.term}</option>)}</select></label>
    </div>
      {!meta.pairs.length ? <p className="empty-state">No subject allocations are configured for this term. Ask an administrator to configure teaching allocations first.</p> : <form onSubmit={submit} className="data-panel" style={{display:'grid',gap:'1rem'}}>
        <div className="class-grid">
          <label>Class<select required value={form.class_id} onChange={(e)=>setForm({...form,class_id:e.target.value,subject_id:'',teacher_id:''})}><option value="">Select a class</option>{meta.classes.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Subject<select required value={form.subject_id} onChange={(e)=>setForm({...form,subject_id:e.target.value,teacher_id:''})}><option value="">Select a subject</option>{subjects.map((item)=><option key={item.subject_id} value={item.subject_id}>{item.subject_name}</option>)}</select></label>
          {isAdmin && <label>Teacher<select required value={form.teacher_id} onChange={(e)=>setForm({...form,teacher_id:e.target.value})}><option value="">Select allocated teacher</option>{teachers.map((item)=><option key={item.teacher_id} value={item.teacher_id}>{item.teacher_name}</option>)}</select></label>}
          <label>Title<input maxLength="200" required value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></label>
        </div>
        <label>Description<textarea rows="3" maxLength="5000" value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
        <label>Files (PDF, DOC, DOCX, JPG, PNG; up to five files, 10 MB each)<input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e)=>setFiles(Array.from(e.target.files || []))}/></label>
        <button className="btn-primary" disabled={busy || (isAdmin && !form.teacher_id)}><Plus size={15}/> Publish material</button>
      </form>}
    </section>
    <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Published resources</p><h2>Learning material library</h2></div><button className="btn-secondary" disabled={busy} onClick={()=>load(termId)}><RefreshCw size={14}/> Refresh</button></div>
      {!items.length ? <p className="empty-state">No learning materials have been published for this term.</p> : <div className="class-grid">{items.map((item)=><article className="data-panel" key={item.id}>
        <h3>{item.title}</h3><p>{item.class_name} · {item.subject_name} · {item.teacher_name}</p>{item.description && <p style={{whiteSpace:'pre-wrap'}}>{item.description}</p>}
        {item.files.map((file)=><p key={file.id}><button className="parent-text-button" disabled={busy} onClick={()=>download(item,file)}><Download size={14}/> {file.original_name}</button></p>)}
      </article>)}</div>}
    </section>
  </div></div>;
}

export default LearningMaterials;
