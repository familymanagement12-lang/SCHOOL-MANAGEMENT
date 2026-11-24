const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidPathway,
  isValidPathwayStage,
  isInitialSelectionEligible,
  matchesApprovedDestination,
} = require('./curriculumSelectionPolicy');

test('only Year 6 students assigned to the Common curriculum can make an initial selection', () => {
  assert.equal(isInitialSelectionEligible({
    class_id: 12, year_level: 6, curriculum: 'COMMON', class_curriculum: 'COMMON',
  }), true);
  assert.equal(isInitialSelectionEligible({
    class_id: null, year_level: 6, curriculum: 'COMMON', class_curriculum: 'COMMON',
  }), false);
  assert.equal(isInitialSelectionEligible({
    class_id: 12, year_level: 7, curriculum: 'GES', class_curriculum: 'GES',
  }), false);
});

test('pathway classes use JHS 1–3 for GES and Year 7–11 for Pearson', () => {
  assert.equal(isValidPathway('ges'), true);
  assert.equal(isValidPathway('Pearson'), true);
  assert.equal(isValidPathwayStage(7, 'GES'), true);
  assert.equal(isValidPathwayStage(9, 'GES'), true);
  assert.equal(isValidPathwayStage(10, 'GES'), false);
  assert.equal(isValidPathwayStage(7, 'PEARSON'), true);
  assert.equal(isValidPathwayStage(11, 'PEARSON'), true);
  assert.equal(isValidPathwayStage(12, 'PEARSON'), false);
});

test('approved initial selections and change requests require a matching destination stage', () => {
  const initial = { request_type: 'initial_selection', selected_curriculum: 'GES' };
  const yearSix = { year_level: 6 };
  assert.equal(matchesApprovedDestination(initial, yearSix, { year_level: 7, curriculum: 'GES' }), true);
  assert.equal(matchesApprovedDestination(initial, yearSix, { year_level: 7, curriculum: 'PEARSON' }), false);

  const change = { request_type: 'change_request', selected_curriculum: 'PEARSON' };
  assert.equal(matchesApprovedDestination(change, { year_level: 8 }, { year_level: 8, curriculum: 'PEARSON' }), true);
  assert.equal(matchesApprovedDestination(change, { year_level: 8 }, { year_level: 7, curriculum: 'PEARSON' }), false);
  assert.equal(matchesApprovedDestination(change, { year_level: 10 }, { year_level: 10, curriculum: 'GES' }), false);
});
