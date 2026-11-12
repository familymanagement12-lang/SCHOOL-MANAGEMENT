const pool = require('../config/db');
const notificationEvents = require('../services/notificationService');

const getAnnouncements = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;

  try {
    let query = '';
    let values = [school_id];

    if (role === 'admin') {
      query = `SELECT a.*, u.name as sender_name, c.name as class_name 
               FROM announcements a 
               LEFT JOIN users u ON a.sender_id = u.id 
               LEFT JOIN classes c ON a.class_id = c.id 
               WHERE a.school_id = $1 
               ORDER BY a.created_at DESC`;
    } else if (role === 'teacher') {
      query = `SELECT a.*, u.name as sender_name, c.name as class_name 
               FROM announcements a 
               LEFT JOIN users u ON a.sender_id = u.id 
               LEFT JOIN classes c ON a.class_id = c.id 
               WHERE a.school_id = $1 
               AND (a.audience = 'everyone' OR a.class_id IN (SELECT id FROM classes WHERE teacher_id = $2))
               ORDER BY a.created_at DESC`;
      values.push(userId);
    } else if (role === 'student') {
      query = `SELECT a.*, u.name as sender_name, c.name as class_name 
               FROM announcements a 
               LEFT JOIN users u ON a.sender_id = u.id 
               LEFT JOIN classes c ON a.class_id = c.id 
               WHERE a.school_id = $1 
               AND (a.audience = 'everyone' OR a.class_id = (SELECT class_id FROM students WHERE user_id = $2 LIMIT 1))
               ORDER BY a.created_at DESC`;
      values.push(userId);
    } else if (role === 'parent') {
      query = `SELECT a.*, u.name as sender_name, c.name as class_name 
               FROM announcements a 
               LEFT JOIN users u ON a.sender_id = u.id 
               LEFT JOIN classes c ON a.class_id = c.id 
               WHERE a.school_id = $1 
               AND (a.audience = 'everyone' OR a.class_id IN (
                 SELECT s.class_id FROM students s 
                 JOIN student_parent sp ON s.id = sp.student_id 
                 JOIN parents p ON sp.parent_id = p.id 
                 WHERE p.user_id = $2
               ))
               ORDER BY a.created_at DESC`;
      values.push(userId);
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};

const createAnnouncement = async (req, res, next) => {
  const { school_id, role, id: userId } = req.user;
  const { title, message, audience, class_id } = req.body;

  if (!title || !message || !audience) {
    return res.status(400).json({ message: 'Title, message, and audience are required.' });
  }

  try {
    if (role === 'teacher' && audience !== 'class') {
       return res.status(403).json({ message: 'Teachers can only send class announcements.' });
    }

    const result = await pool.query(
      `INSERT INTO announcements (school_id, sender_id, audience, class_id, title, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [school_id, userId, audience, class_id || null, title, message]
    );

    notificationEvents.emit('announcement.created', {
      title,
      message,
      audience,
      class_id,
      school_id
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
};

module.exports = { getAnnouncements, createAnnouncement };