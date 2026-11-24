import React, { useState, useEffect, useRef } from 'react';
import { bulkCreateStudents } from '../api/students';
import { getClasses } from '../api/classes';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const BulkStudentUploader = ({ onSuccess }) => {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [credentials, setCredentials] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const res = await getClasses();
        setClasses(res.data);
      } catch (error) {
        console.error('Failed to fetch classes:', error);
      }
    };
    fetchClasses();
  }, []);

  const handleBulkUpload = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (!classId) {
      return setMessage({ type: 'error', text: 'Please select a class first.' });
    }
    if (!file) {
      return setMessage({ type: 'error', text: 'Please select an Excel (.xlsx) file.' });
    }

    setLoading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const buffer = event.target.result;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        
        const worksheet = workbook.getWorksheet(1);
        const studentsList = [];

        // Helper to safely extract text from rich-text/hyperlink cell objects
        const extractValue = (cell) => {
          if (!cell || !cell.value) return '';
          if (cell.value instanceof Date) {
            return cell.value.toISOString().split('T')[0];
          }
          if (typeof cell.value === 'object') {
            if (cell.value.richText) return cell.value.richText.map(rt => rt.text).join('').trim();
            if (cell.value.text) return cell.value.text.trim();
          }
          return cell.value.toString().trim();
        };
        
        worksheet.eachRow((row, rowNumber) => {
          // Skip headers and instructions. Data starts at row 12
          if (rowNumber >= 12) {
            const name = extractValue(row.getCell(1));
            let dob = extractValue(row.getCell(2));
            const allergies = extractValue(row.getCell(3)) || extractValue(row.getCell(5)) || '';
            const disability = extractValue(row.getCell(4)) || extractValue(row.getCell(6)) || '';

            // Convert exact Age to a valid YYYY-MM-DD Date of Birth format
            if (dob && !isNaN(dob) && Number(dob) > 0 && Number(dob) < 100) {
              const birthYear = new Date().getFullYear() - Number(dob);
              dob = `${birthYear}-01-01`;
            }

            // Ignore the footer text if the user leaves it in the file
            if (name && name !== '' && !name.includes('Powered by The McCarthy Hill School')) {
              studentsList.push({ name, dob, allergies, disability });
            }
          }
        });

        if (studentsList.length === 0) {
          throw new Error('No valid students found in the file.');
        }

        const response = await bulkCreateStudents({
          class_id: classId,
          students: studentsList,
        });

        setMessage({ type: 'success', text: response.data.message || 'Students successfully uploaded!' });
        setCredentials(Array.isArray(response.data.credentials) ? response.data.credentials : []);
        setFile(null); // Clear the file state
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = ''; // Reset the input visually
        
        if (onSuccess) {
          onSuccess(); // Trigger parent component to refresh the student table
        }
      } catch (error) {
        const errorMsg = error.response?.data?.message || error.message || 'Failed to process Excel file. Please check your formatting.';
        setMessage({ type: 'error', text: errorMsg });
      } finally {
        setLoading(false);
      }
    };
    
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadTemplate = async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Student Upload Template', {
      views: [{ state: 'frozen', ySplit: 11 }] // Freeze header row
    });

    // Set column widths
    sheet.columns = [
      { width: 30 }, // A: Student Name
      { width: 20 }, // B: Age or DOB
      { width: 30 }, // C: Allergies
      { width: 30 }  // D: Disability / Special Needs
    ];

    // Increase row heights so the banner has plenty of room
    sheet.getRow(1).height = 25;
    sheet.getRow(2).height = 25;

    // 🎓 Top Banner (A1:D2)
    sheet.mergeCells('A1:D2');
    const banner = sheet.getCell('A1');
    banner.value = '🎓 Bulk Student Upload Template';
    banner.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    banner.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    // 📋 Instructions Section
    sheet.mergeCells('B4:D4');
    sheet.getCell('A4').value = 'IMPORTANT';
    sheet.getCell('B4').value = 'Read before uploading';
    
    sheet.mergeCells('B5:D5');
    sheet.getCell('A5').value = 'Required Field';
    sheet.getCell('B5').value = 'Student Name';
    
    sheet.mergeCells('B6:D6');
    sheet.getCell('A6').value = 'Optional Fields';
    sheet.getCell('B6').value = 'Age or Date of Birth, Allergies, Disability / Needs';
    
    sheet.mergeCells('B7:D7');
    sheet.getCell('A7').value = 'Student Access';
    sheet.getCell('B7').value = 'A student portal account will be created automatically';

    for (let i = 4; i <= 7; i++) {
      sheet.getCell(`A${i}`).font = { bold: true };
      sheet.getCell(`A${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
      ['B', 'C', 'D'].forEach(col => { sheet.getCell(`${col}${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } }; sheet.getCell(`${col}${i}`).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1'} } }; });
      sheet.getCell(`A${i}`).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1'} } };
    }

    // Required Highlight Note
    sheet.getCell('A10').value = '* Required';
    sheet.getCell('A10').font = { color: { argb: 'FFDC2626' }, italic: true, size: 10 };

    // 📊 Student Data Table Header (Row 11)
    const headerRow = sheet.getRow(11);
    headerRow.values = ['Student Name *', 'Age or DOB', 'Allergies', 'Disability / Special Needs'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center' };
    
    ['A', 'B', 'C', 'D'].forEach(col => {
      const cell = sheet.getCell(`${col}11`);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    // 🎨 Data Rows with alternating colors and validation
    for (let i = 12; i <= 61; i++) { // Provide 50 pre-formatted rows
      ['A', 'B', 'C', 'D'].forEach(col => {
        const cell = sheet.getCell(`${col}${i}`);
        cell.border = { 
          top: { style: 'thin', color: { argb: 'FFCBD5E1'} }, 
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1'} }, 
          left: { style: 'thin', color: { argb: 'FFCBD5E1'} }, 
          right: { style: 'thin', color: { argb: 'FFCBD5E1'} } 
        };
        if (i % 2 === 0) {
           cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    }

    // Footer
    sheet.getCell('A63').value = 'Powered by The McCarthy Hill School';
    sheet.getCell('A63').font = { italic: true, color: { argb: 'FF94A3B8' } };

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'mccarthy_hill_school_student_upload_template.xlsx');
  };

  return (
    <div className="data-panel form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bulk Input</p>
          <h2>Add Multiple Students</h2>
        </div>
      </div>
      {message.text && (
        <div className={message.type === 'error' ? 'error' : 'success'} style={{ marginBottom: '15px', color: message.type === 'error' ? 'red' : 'green' }}>
          {message.text}
        </div>
      )}
      {credentials.length > 0 && (
        <div style={{ marginBottom: '1rem', maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem' }}>
          <strong>One-time student portal credentials</strong>
          {credentials.map((credential) => (
            <div key={credential.student_id} style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
              <div><strong>{credential.name}</strong> · {credential.student_id}</div>
              <div>Username: <strong>{credential.username}</strong></div>
              <div>Temporary password: <strong>{credential.temporary_password}</strong></div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleBulkUpload}>
        <label>Select Class *</label>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} required>
          <option value="">-- Choose Class --</option>
          {classes.map((cls) => (
            <option key={cls.id} value={cls.id}>{cls.name}</option>
          ))}
        </select>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '1.5rem' }}>
          <label style={{ margin: 0 }}>Upload Excel (.xlsx) File *</label>
          <button type="button" onClick={handleDownloadTemplate} className="btn-small btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', backgroundColor: '#f8fafc' }}>
            ⬇️ Download Template
          </button>
        </div>

        <label 
          style={{ 
            display: 'block', 
            background: fileName ? '#ecfdf5' : '#f8fafc', 
            border: `2px dashed ${fileName ? '#10b981' : '#cbd5e1'}`, 
            borderRadius: '12px', 
            padding: '3rem 2rem', 
            textAlign: 'center', 
            marginBottom: '1.5rem', 
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <input 
            type="file" 
            accept=".xlsx"
            ref={fileInputRef}
            onChange={(e) => {
              const selectedFile = e.target.files[0];
              setFile(selectedFile);
              setFileName(selectedFile ? selectedFile.name : '');
            }}
            required
            style={{ display: 'none' }} 
          />
          
          {fileName ? (
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#065f46', fontSize: '1.2rem' }}>File Ready!</h3>
              <p style={{ margin: 0, color: '#059669', fontWeight: '600' }}>{fileName}</p>
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#10b981', textDecoration: 'underline' }}>Click to choose a different file</p>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📁</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.2rem' }}>Click here to browse files</h3>
              <p style={{ fontSize: '0.95rem', color: '#64748b', margin: '0 auto', maxWidth: '300px', lineHeight: '1.5' }}>
                Upload the <strong>.xlsx</strong> template file provided above.
              </p>
            </div>
          )}
        </label>

        <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '0.875rem' }}>
          {loading ? 'Uploading & Sending Emails...' : 'Bulk Add Students'}
        </button>
      </form>
    </div>
  );
};

export default BulkStudentUploader;
