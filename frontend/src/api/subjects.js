import axios from 'axios';

const API_URL = 'http://localhost:5000/api/subjects';

const getAuthHeaders = () => {
  const token = localStorage.getItem('sms_token');
  return { headers: { Authorization: `Bearer ${token}` } };
};

export const getSubjects = () => axios.get(API_URL, getAuthHeaders());
export const createSubject = (data) => axios.post(API_URL, data, getAuthHeaders());
export const updateSubject = (id, data) => axios.put(`${API_URL}/${id}`, data, getAuthHeaders());
export const deleteSubject = (id) => axios.delete(`${API_URL}/${id}`, getAuthHeaders());