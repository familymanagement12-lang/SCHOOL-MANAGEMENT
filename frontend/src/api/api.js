import axios from 'axios';
import { getApiBaseUrl } from './apiBaseUrl';

const api = axios.create({
  baseURL: getApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.DEV),
});

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Token is invalid/expired. Clear storage and redirect to login.
      localStorage.removeItem('sms_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
