import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadStudentLearningMaterial, getStudentLearningMaterials } from '../api/learningMaterials';

function StudentMaterials() {
  const [items,setItems]=useState([]); const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const load=async()=>{ const response=await getStudentLearningMaterials(); setItems(response.data); };
  useEffect(()=>{load().catch((e)=>setError(e.response?.data?.message || 'Unable to load learning materials.')).finally(()=>setLoading(false));},[]);
  const download=async(item,file)=>{
    setBusy(true);setError('');
    try { const response=await downloadStudentLearningMaterial(item.id,file.id); const url=URL.createObjectURL(response.data); const link=document.createElement('a'); link.href=url;link.download=file.original_name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
    catch(e){setError(e.response?.data?.message || 'Unable to download this file.');}
    finally{setBusy(false);}
  };
  if(loading)return <div className="page module-page"><div className="module-shell"><p className="data-panel" role="status">Loading learning materials…</p></div></div>;
  return <div className="page module-page"><div className="module-shell">
    <section className="module-hero"><div><p className="eyebrow">Student Portal</p><h1>Learning Materials</h1><p>Resources shared by your teachers for your current class.</p></div></section>
    {error&&<div className="error" role="alert">{error}</div>}
    <section className="data-panel"><div className="panel-heading"><div><p className="eyebrow">Your class</p><h2>Published resources</h2></div><button className="btn-secondary" disabled={busy} onClick={()=>load().catch((e)=>setError(e.response?.data?.message || 'Unable to refresh materials.'))}><RefreshCw size={14}/> Refresh</button></div>
      {!items.length?<p className="empty-state">No learning materials are published for your class yet.</p>:<div className="class-grid">{items.map((item)=><article className="data-panel" key={item.id}><h3>{item.title}</h3><p>{item.academic_year} · {item.term} · {item.subject_name} · {item.teacher_name}</p>{item.description&&<p style={{whiteSpace:'pre-wrap'}}>{item.description}</p>}{item.files.map((file)=><p key={file.id}><button className="parent-text-button" disabled={busy} onClick={()=>download(item,file)}><Download size={14}/> {file.original_name}</button></p>)}</article>)}</div>}
    </section>
  </div></div>;
}

export default StudentMaterials;
