const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { getReportCard } = require('./resultController');

test('legacy report results without class snapshots are not ranked against the current class', async () => {
  const originalQuery = pool.query;
  const rankingClassIds = [];
  pool.query = async (sql, values = []) => {
    if (/SELECT s\.name/.test(sql)) {
      return {
        rows: [{
          name: 'Student',
          class_name: 'Current Year 6',
          class_id: 6,
          class_year_level: 6,
          curriculum: 'COMMON',
        }],
      };
    }
    if (/SELECT class_id, class_name_snapshot/.test(sql)) {
      return {
        rows: [{
          class_id: null,
          class_name_snapshot: null,
          year_level_snapshot: null,
          curriculum: null,
          academic_year_snapshot: null,
        }],
      };
    }
    if (/WITH RankedResults/.test(sql) || /WITH StudentAverages/.test(sql)) {
      rankingClassIds.push(values[2]);
      return { rows: [] };
    }
    if (/SELECT term, ROUND/.test(sql) || /SELECT COUNT\(\*\) FILTER/.test(sql)) {
      return { rows: [{}] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const res = {
      statusCode: 200,
      json(body) {
        this.body = body;
        return this;
      },
    };
    await getReportCard(
      { user: { school_id: 1 }, params: { studentId: '4' }, query: { term: 'Term 1' } },
      res,
      assert.fail
    );

    assert.deepEqual(rankingClassIds, [null, null]);
    assert.equal(res.body.student.class_name, 'Historical class not recorded');
    assert.equal(res.body.student.historical_context_missing, true);
  } finally {
    pool.query = originalQuery;
  }
});
