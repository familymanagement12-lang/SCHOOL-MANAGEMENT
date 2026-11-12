import assert from 'node:assert/strict';
import test from 'node:test';
import { getApiBaseUrl } from './apiBaseUrl.js';

test('adds the API prefix to a production backend origin', () => {
  assert.equal(
    `${getApiBaseUrl('https://school-management-zkm3.onrender.com', false)}/auth/login`,
    'https://school-management-zkm3.onrender.com/api/auth/login',
  );
});

test('keeps a configured API prefix and removes duplicate prefixes', () => {
  assert.equal(getApiBaseUrl('https://api.example.com/api/', false), 'https://api.example.com/api');
  assert.equal(getApiBaseUrl('https://api.example.com/api/api', false), 'https://api.example.com/api');
});

test('uses environment-appropriate defaults when VITE_API_URL is empty', () => {
  assert.equal(getApiBaseUrl('', true), 'http://localhost:5000/api');
  assert.equal(getApiBaseUrl('', false), '/api');
});
