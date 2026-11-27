const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const storage = require('../services/assignmentStorage');
const controller = require('./learningMaterialController');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode=code; return this; },
  json(value) { this.body=value; return this; },
  setHeader(name,value) { (this.headers ||= {})[name]=value; },
});

test('teacher cannot publish Learning Materials for a class and subject outside their allocation', async () => {
  const originalConnect=pool.connect;
  const originalPut=storage.putPrivateFile;
  const statements=[]; let stored=false;
  pool.connect=async()=>({
    async query(sql) {
      statements.push(sql);
      if(sql==='BEGIN'||sql==='ROLLBACK') return {rows:[],rowCount:0};
      if(/SELECT academic_year,term FROM timetable_terms/.test(sql)) return {rows:[{academic_year:'2026/2027',term:'Term 1'}],rowCount:1};
      if(/SELECT EXISTS/.test(sql)) return {rows:[{allowed:false}],rowCount:1};
      return {rows:[],rowCount:0};
    }, release(){},
  });
  storage.putPrivateFile=async()=>{stored=true;throw new Error('not expected');};
  try {
    const res=response();
    await controller.createMaterial({
      user:{school_id:1,id:22,role:'teacher'},body:{title:'Notes',description:'',class_id:'3',subject_id:'7',term_id:'9'},
      files:[{originalname:'notes.pdf',buffer:Buffer.from('mock')}],
    },res,assert.fail);
    assert.equal(res.statusCode,403);
    assert.equal(stored,false);
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.some((sql)=>/INSERT INTO learning_materials/.test(sql)),false);
  } finally { pool.connect=originalConnect; storage.putPrivateFile=originalPut; }
});

test('student file download refuses a resource outside the authenticated student scope before storage access', async () => {
  const originalQuery=pool.query, originalGet=storage.getPrivateFile;
  const statements=[];let storageRead=false;
  pool.query=async(sql,values)=>{statements.push({sql,values});return {rows:[],rowCount:0};};
  storage.getPrivateFile=async()=>{storageRead=true;throw new Error('not expected');};
  try {
    const res=response();
    await controller.downloadMaterialFile({user:{school_id:2,id:31,role:'student'},params:{id:'5',fileId:'8'}},res,assert.fail);
    assert.equal(res.statusCode,404);
    assert.equal(storageRead,false);
    assert.deepEqual(statements[0].values,[2,31,'5','8']);
    assert.match(statements[0].sql,/st\.user_id=\$2/);
  } finally { pool.query=originalQuery; storage.getPrivateFile=originalGet; }
});
