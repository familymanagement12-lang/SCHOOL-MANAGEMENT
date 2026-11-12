import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createClassAssessment, getClassAssessments, getResultsByStudent,
  recordResult, saveClassAssessmentScores, setResultPublication,
} from '../api/results';
import { getStudents } from '../api/students';
import { getClasses } from '../api/classes';

const initialAssessment = { title: '', assessment_type: 'exercise', max_score: '' };

function Results() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [results, setResults] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState('');
  const [assessmentScores, setAssessmentScores] = useState({});
  const [assessmentForm, setAssessmentForm] = useState(initialAssessment);
  const [subject, setSubject] = useState('');
  const [term, setTerm] = useState('Term 1');
  const [examScore, setExamScore] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const classStudents = useMemo(
    () => students.filter((student) => String(student.class_id) === selectedClass),
    [students, selectedClass]
  );
  const currentAssessment = assessments.find((assessment) => String(assessment.id) === selectedAssessment);
  const selectedResult = results.find((result) => result.term === term && result.subject.toLowerCase() === subject.trim().toLowerCase());

  useEffect(() => {
    Promise.all([getClasses(), getStudents()])
      .then(([classesResponse, studentsResponse]) => {
        setClasses(classesResponse.data);
        setStudents(studentsResponse.data);
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.message || 'Failed to load classes and students.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelectedStudent('');
    setResults([]);
    setAssessments([]);
    setSelectedAssessment('');
    setAssessmentScores({});
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass || !subject.trim()) {
      setAssessments([]);
      setSelectedAssessment('');
      return;
    }
    let active = true;
    getClassAssessments({ class_id: selectedClass, subject: subject.trim(), term })
      .then((response) => {
        if (!active) return;
        setAssessments(response.data);
        setSelectedAssessment((current) => response.data.some((assessment) => String(assessment.id) === current)
          ? current
          : String(response.data[0]?.id || ''));
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || 'Failed to load class assessments.');
      });
    return () => { active = false; };
  }, [selectedClass, subject, term]);

  useEffect(() => {
    if (!selectedAssessment) {
      setAssessmentScores({});
      return;
    }
    const assessment = assessments.find((item) => String(item.id) === selectedAssessment);
    if (!assessment) return;
    setAssessmentScores(Object.fromEntries(
      assessment.scores.map((entry) => [String(entry.student_id), String(entry.score)])
    ));
  }, [selectedAssessment, assessments]);

  useEffect(() => {
    if (!selectedStudent) {
      setResults([]);
      return;
    }
    let active = true;
    getResultsByStudent(selectedStudent)
      .then((response) => {
        if (active) setResults(response.data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || 'Failed to load results.');
      });
    return () => { active = false; };
  }, [selectedStudent]);

  useEffect(() => {
    setExamScore(selectedResult ? String(selectedResult.exam_score) : '');
  }, [selectedResult?.id, selectedResult?.exam_score]);

  const createAssessment = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const response = await createClassAssessment({
        class_id: Number(selectedClass),
        subject: subject.trim(),
        term,
        ...assessmentForm,
        max_score: Number(assessmentForm.max_score),
      });
      setAssessmentForm(initialAssessment);
      const refreshed = await getClassAssessments({ class_id: selectedClass, subject: subject.trim(), term });
      setAssessments(refreshed.data);
      setSelectedAssessment(String(response.data.id));
      setMessage('Assessment added. Enter the marks for the class below.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to add assessment.');
    } finally {
      setSaving(false);
    }
  };

  const saveAssessmentScores = async (event) => {
    event.preventDefault();
    if (!currentAssessment) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const scores = classStudents.map((student) => ({
        student_id: Number(student.id),
        score: assessmentScores[String(student.id)] === undefined || assessmentScores[String(student.id)] === ''
          ? null
          : Number(assessmentScores[String(student.id)]),
      }));
      await saveClassAssessmentScores(currentAssessment.id, scores);
      const refreshed = await getClassAssessments({ class_id: selectedClass, subject: subject.trim(), term });
      setAssessments(refreshed.data);
      setSelectedAssessment(String(currentAssessment.id));
      if (selectedStudent) {
        const resultsResponse = await getResultsByStudent(selectedStudent);
        setResults(resultsResponse.data);
      }
      setMessage('Marks saved. Class scores have been recalculated out of 50.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to save assessment marks.');
    } finally {
      setSaving(false);
    }
  };

  const saveExamScore = async (event) => {
    event.preventDefault();
    if (!selectedStudent || !subject.trim()) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await recordResult({
        student_id: Number(selectedStudent),
        subject: subject.trim(),
        exam_score: Number(examScore),
        term,
      });
      const response = await getResultsByStudent(selectedStudent);
      setResults(response.data);
      setMessage('Exam score saved out of 50.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to save exam score.');
    } finally {
      setSaving(false);
    }
  };

  const togglePublication = async () => {
    if (!selectedResult || !selectedStudent) return;
    setError('');
    setMessage('');
    setPublishing(true);
    try {
      await setResultPublication({
        student_id: Number(selectedStudent),
        subject: selectedResult.subject,
        term: selectedResult.term,
        published: !selectedResult.is_published,
      });
      const response = await getResultsByStudent(selectedStudent);
      setResults(response.data);
      setMessage(selectedResult.is_published ? 'Results unpublished.' : 'Results published to the student portal.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to update result publication.');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div className="page"><p>Loading...</p></div>;

  return (
    <div className="page module-page">
      <div className="module-shell">
        <section className="module-hero">
          <div>
            <p className="eyebrow">Academic Records</p>
            <h1>Student Results</h1>
            <p>Class assessments count for 50 points and the final exam counts for 50 points.</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <select aria-label="Select class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              <option value="">Select Class</option>
              {classes.map((classItem) => <option key={classItem.id} value={classItem.id}>{classItem.name}</option>)}
            </select>
            {selectedClass && <select aria-label="Select student" value={selectedStudent} onChange={(event) => setSelectedStudent(event.target.value)}>
              <option value="">Select Student</option>
              {classStudents.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>}
          </div>
        </section>

        {error && <div className="error" role="alert">{error}</div>}
        {message && <div role="status" style={{ background: '#edf5ef', color: '#286447', padding: '1rem', marginBottom: '1rem', border: '1px solid #d0e7d6', borderRadius: '8px' }}>{message}</div>}

        {selectedClass && <>
          <section className="data-panel" style={{ marginBottom: '1.5rem' }}>
            <div className="panel-heading">
              <div><p className="eyebrow">Class grading setup</p><h2>Term assessments</h2></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label htmlFor="results-term">Term</label>
                <select id="results-term" value={term} onChange={(event) => setTerm(event.target.value)}>
                  <option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option>
                </select>
              </div>
              <div>
                <label htmlFor="results-subject">Subject</label>
                <input id="results-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Mathematics" />
              </div>
            </div>
            <p>Enter every exercise and the mid-semester assessment with its maximum mark. All earned marks are pooled and scaled to a class score out of 50.</p>
            <form onSubmit={createAssessment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', alignItems: 'end', marginTop: '1rem' }}>
              <div><label htmlFor="assessment-title">Assessment name</label><input id="assessment-title" required maxLength="120" placeholder="e.g. Exercise 1" value={assessmentForm.title} onChange={(event) => setAssessmentForm({ ...assessmentForm, title: event.target.value })} /></div>
              <div><label htmlFor="assessment-type">Type</label><select id="assessment-type" value={assessmentForm.assessment_type} onChange={(event) => setAssessmentForm({ ...assessmentForm, assessment_type: event.target.value })}><option value="exercise">Term exercise</option><option value="midterm">Mid-semester</option></select></div>
              <div><label htmlFor="assessment-max-score">Maximum mark</label><input id="assessment-max-score" type="number" min="0.01" max="10000" step="0.01" required value={assessmentForm.max_score} onChange={(event) => setAssessmentForm({ ...assessmentForm, max_score: event.target.value })} /></div>
              <button type="submit" className="btn-primary" disabled={saving || !subject.trim()}>{saving ? 'Saving…' : 'Add assessment'}</button>
            </form>

            {assessments.length > 0 && <div style={{ marginTop: '1.5rem' }}>
              <label htmlFor="assessment-select">Enter marks for</label>
              <select id="assessment-select" value={selectedAssessment} onChange={(event) => setSelectedAssessment(event.target.value)}>
                {assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title} · {assessment.assessment_type === 'midterm' ? 'Mid-semester' : 'Exercise'} · out of {assessment.max_score}</option>)}
              </select>
              {currentAssessment && <form onSubmit={saveAssessmentScores} style={{ marginTop: '1rem' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ textAlign: 'left', padding: '0.6rem' }}>Student</th><th style={{ textAlign: 'left', padding: '0.6rem' }}>Mark / {currentAssessment.max_score}</th></tr></thead>
                    <tbody>
                      {classStudents.map((student) => <tr key={student.id}>
                        <td style={{ padding: '0.5rem 0.6rem' }}>{student.name}</td>
                        <td style={{ padding: '0.5rem 0.6rem' }}><input aria-label={`${student.name} score for ${currentAssessment.title}`} type="number" min="0" max={currentAssessment.max_score} step="0.01" placeholder="Not entered" value={assessmentScores[String(student.id)] ?? ''} onChange={(event) => setAssessmentScores({ ...assessmentScores, [String(student.id)]: event.target.value })} /></td>
                      </tr>)}
                      {!classStudents.length && <tr><td colSpan="2" style={{ padding: '1rem' }}>No students are enrolled in this class.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <button type="submit" className="btn-primary" disabled={saving || !classStudents.length} style={{ marginTop: '1rem' }}>{saving ? 'Saving…' : 'Save class marks'}</button>
              </form>}
            </div>}
            {!assessments.length && subject.trim() && <p className="empty-state">No assessments for this subject and term yet.</p>}
          </section>

          {selectedStudent && <section className="split-layout">
            <form className="data-panel form-panel" onSubmit={saveExamScore}>
              <div className="panel-heading"><div><p className="eyebrow">Final exam</p><h2>Exam score (50)</h2></div></div>
              <p>{subject.trim() ? `Enter ${classStudents.find((student) => String(student.id) === selectedStudent)?.name || 'the student'}’s exam mark for ${subject}.` : 'Select a subject above first.'}</p>
              <label htmlFor="exam-score">Exam mark out of 50</label>
              <input id="exam-score" type="number" min="0" max="50" step="0.01" required value={examScore} onChange={(event) => setExamScore(event.target.value)} disabled={!subject.trim()} />
              <button type="submit" className="btn-primary" disabled={saving || !subject.trim()}>{saving ? 'Saving…' : 'Save exam score'}</button>
              {selectedResult && <p>Current total: {selectedResult.class_score} class + {selectedResult.exam_score} exam = {selectedResult.score} / 100</p>}
              {selectedResult && <button type="button" className="btn-secondary" onClick={togglePublication} disabled={publishing}>
                {publishing ? 'Updating…' : selectedResult.is_published ? 'Unpublish result' : 'Publish result to student'}
              </button>}
            </form>

            <section className="data-panel">
              <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Academic Record</h2>
                <Link to={`/report-card/${selectedStudent}?term=${encodeURIComponent(term)}`} className="btn-small btn-secondary" style={{ textDecoration: 'none' }}>🖨️ Print Card</Link>
              </div>
              <div className="insight-list">
                {results.map((result) => <div key={result.id}>
                  <span className={result.score >= 50 ? 'present' : 'absent'} style={{ width: 'auto', padding: '0.2rem 0.6rem', borderRadius: '8px' }}>{result.score}%</span>
                  <p><strong>{result.subject}</strong> ({result.term}) · class {result.class_score}/50 · exam {result.exam_score}/50</p>
                  <small>{result.is_published ? 'Published to student' : 'Not published'}</small>
                  {result.term === term && result.subject.toLowerCase() === subject.trim().toLowerCase() && result.class_assessments?.length > 0 && <small>{result.class_assessments.map((item) => `${item.title}: ${item.score ?? '—'}/${item.max_score}`).join(' · ')}</small>}
                </div>)}
              </div>
              {results.length === 0 && <p className="empty-state">No results entered yet.</p>}
            </section>
          </section>}
        </>}
      </div>
    </div>
  );
}

export default Results;
