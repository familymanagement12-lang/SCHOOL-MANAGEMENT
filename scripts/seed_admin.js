require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async()=>{
 const email=process.env.ADMIN_EMAIL||'admin@mccarthyhillschool.edu.gh';
 const password=process.env.ADMIN_PASSWORD;
 if(!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env first.');
 if(!password || password.length<12) throw new Error('Set ADMIN_PASSWORD (at least 12 characters) in backend/.env before running this script.');
 try {
  await pool.query('BEGIN');
  let s=await pool.query("SELECT id FROM schools ORDER BY id LIMIT 1");
  if(!s.rows.length) s=await pool.query("INSERT INTO schools(name,address,phone,currency,academic_year,current_term) VALUES('The McCarthy Hill School',NULL,NULL,'GHS','2026/2027','Term 1') RETURNING id");
  else await pool.query("UPDATE schools SET name='The McCarthy Hill School',currency='GHS' WHERE id=$1",[s.rows[0].id]);
  const schoolId=s.rows[0].id; const hash=await bcrypt.hash(password,12);
  const existing=await pool.query('SELECT id FROM users WHERE email=$1',[email]);
  if(existing.rows.length) await pool.query("UPDATE users SET school_id=$1,name='School Administrator',password=$2,role='admin',is_active=TRUE,must_change_password=FALSE,email_verified=TRUE WHERE id=$3",[schoolId,hash,existing.rows[0].id]);
  else await pool.query("INSERT INTO users(school_id,name,email,password,role,must_change_password,is_active,email_verified) VALUES($1,'School Administrator',$2,$3,'admin',FALSE,TRUE,TRUE)",[schoolId,email,hash]);
  await pool.query('COMMIT'); console.log(`Admin account ready for ${email}. Credentials were read from environment; password not printed.`);
 } catch(e){await pool.query('ROLLBACK'); console.error(e.message);process.exitCode=1;} finally{await pool.end();}
})();
