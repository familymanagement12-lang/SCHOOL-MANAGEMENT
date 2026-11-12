const pool = require('../config/db');

const getSettings = async (req, res, next) => {
  const { school_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT name, address, phone, motto, logo_url, academic_year, current_term, currency, grading_scale 
       FROM schools WHERE id = $1`,
      [school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  const { school_id } = req.user;
  const { name, address, phone, motto, logo_url, academic_year, current_term, currency, grading_scale } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE schools SET 
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        phone = COALESCE($3, phone),
        motto = COALESCE($4, motto),
        logo_url = COALESCE($5, logo_url),
        academic_year = COALESCE($6, academic_year),
        current_term = COALESCE($7, current_term),
        currency = COALESCE($8, currency),
        grading_scale = COALESCE($9, grading_scale)
       WHERE id = $10 RETURNING name, address, phone, motto, logo_url, academic_year, current_term, currency, grading_scale`,
       [name, address, phone, motto, logo_url, academic_year, current_term, currency, grading_scale, school_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings };