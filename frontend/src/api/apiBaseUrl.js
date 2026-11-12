export const getApiBaseUrl = (apiUrl, isDevelopment) => {
  const fallback = isDevelopment ? 'http://localhost:5000/api' : '/api';
  const baseUrl = (apiUrl || fallback).trim().replace(/\/+$/, '');
  const baseWithoutApiSuffix = baseUrl.replace(/(?:\/api)+$/i, '');

  return `${baseWithoutApiSuffix}/api`;
};
