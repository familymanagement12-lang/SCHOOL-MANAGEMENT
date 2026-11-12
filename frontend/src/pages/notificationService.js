// Centralized Notification Service (Layer 1 & 2)
const EventEmitter = require('events');
const pool = require('../config/db');

class NotificationEmitter extends EventEmitter {}
const notificationEvents = new NotificationEmitter();

// Mock Delivery Function (Layer 2)
const sendMockNotification = (type, to, message) => {
  console.log(`\n=== 🔔 MOCK ${type} NOTIFICATION ===`);
  console.log(`TO: ${to || 'N/A'}`);
  console.log(`MESSAGE: ${message}`);
  console.log(`===================================\n`);
};

const sendDatabaseNotification = async (school_id, user_id, title, message) => {
  try {
    await pool.query(
      `INSERT INTO notifications (school_id, user_id, title, message) VALUES ($1, $2, $3, $4)`,
      [school_id, user_id, title, message]
    );
  } catch (err) {
    console.error('Error saving notification to DB:', err);
  }
};

// 1. Attendance Listener
notificationEvents.on('attendance.marked', async (data) => {
  const { student_id, date, status } = data;
  
  // Only notify for absences or lateness
  if (status === 'absent' || status === 'late') {
    try {
      const res = await pool.query(`
        SELECT p.name as parent_name, p.phone, u.email, u.id as user_id, p.school_id, s.name as student_name
        FROM student_parent sp
        JOIN parents p ON sp.parent_id = p.id
        JOIN users u ON p.user_id = u.id
        JOIN students s ON sp.student_id = s.id
        WHERE sp.student_id = $1
      `, [student_id]);

      for (const parent of res.rows) {
        const message = `Dear ${parent.parent_name}, your child ${parent.student_name} was marked ${status} at school today (${date}).`;
        sendMockNotification('SMS', parent.phone, message);
        await sendDatabaseNotification(parent.school_id, parent.user_id, `Attendance Alert: ${status}`, message);
      }
    } catch (err) {
      console.error('Error processing attendance notification:', err);
    }
  }
});

// 2. Fees Listener
notificationEvents.on('fee.paid', async (data) => {
  const { student_id, amount_paid, balance } = data;
  
  if (amount_paid > 0) {
    try {
      const res = await pool.query(`
        SELECT p.name as parent_name, p.phone, u.id as user_id, p.school_id, s.name as student_name
        FROM student_parent sp
        JOIN parents p ON sp.parent_id = p.id
        JOIN users u ON p.user_id = u.id
        JOIN students s ON sp.student_id = s.id
        WHERE sp.student_id = $1
      `, [student_id]);

      for (const parent of res.rows) {
        const message = `Dear ${parent.parent_name}, a payment of ${amount_paid} has been received for ${parent.student_name}. Remaining balance: ${balance}.`;
        sendMockNotification('SMS', parent.phone, message);
        await sendDatabaseNotification(parent.school_id, parent.user_id, 'Payment Received', message);
      }

      // Automatically record the income in the Transactions ledger
      const studentRes = await pool.query('SELECT name, school_id FROM students WHERE id = $1', [student_id]);
      if (studentRes.rows.length > 0) {
        const student = studentRes.rows[0];
        await pool.query(
          `INSERT INTO transactions (school_id, type, category, amount, reference, description, date)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)`,
          [student.school_id, 'income', 'School Fees', amount_paid, `STU-${student_id}`, `Fee payment received for ${student.name}`]
        );
      }
    } catch (err) {
      console.error('Error processing fee notification:', err);
    }
  }
});

// 3. Announcements Listener
notificationEvents.on('announcement.created', async (data) => {
  const { title, message, audience, class_id, school_id } = data;
  try {
    const query = audience === 'everyone' 
      ? `SELECT DISTINCT p.name, p.phone, u.email, u.id as user_id FROM parents p JOIN users u ON p.user_id = u.id WHERE p.school_id = $1`
      : `SELECT DISTINCT p.name, p.phone, u.email, u.id as user_id FROM student_parent sp JOIN parents p ON sp.parent_id = p.id JOIN users u ON p.user_id = u.id JOIN students s ON sp.student_id = s.id WHERE p.school_id = $1 AND s.class_id = $2`;
    const values = audience === 'everyone' ? [school_id] : [school_id, class_id];
    
    const res = await pool.query(query, values);
    for (const parent of res.rows) {
      sendMockNotification('EMAIL', parent.email, `[New Announcement: ${title}]\n${message}`);
      await sendDatabaseNotification(school_id, parent.user_id, title, message);
    }
  } catch (err) {
    console.error('Error processing announcement notification:', err);
  }
});

module.exports = notificationEvents;