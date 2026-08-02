import axios from 'axios';
import { getToken } from './auth';

export const BACKEND_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://vertex-backend-e68u.onrender.com' : 'http://localhost:5000');
const API_BASE = `${BACKEND_URL}/api`;

/** Returns Authorization header with stored JWT, or empty object if not logged in. */
function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Submit a new civic issue (multipart form with image + location).
 * Requires Citizen role — JWT is sent automatically.
 * Returns 202: issue saved, AI analysis running in the background.
 */
export async function submitIssue(formData) {
  const response = await axios.post(`${API_BASE}/issues`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...authHeader(),
    },
  });
  return response.data;
}

/**
 * Fetch all issues with optional filters (public — no auth required).
 * @param {{ search?: string, priority?: string, status?: string }} params
 */
export async function fetchIssues(params = {}) {
  const response = await axios.get(`${API_BASE}/issues`, { params, headers: authHeader() });
  return response.data;
}

/**
 * Poll the AI analysis status of a submitted issue.
 * Resolves when analysisStatus is 'completed'/'failed'; returns duplicate info too.
 * @param {string} id - Issue MongoDB _id
 */
export async function getIssueStatus(id) {
  const response = await axios.get(`${API_BASE}/issues/${id}/status`, { headers: authHeader() });
  return response.data;
}

/**
 * Update issue status — GOV role only. JWT is sent automatically.
 * @param {string} id - Issue MongoDB _id
 * @param {'Pending'|'In Progress'|'Resolved'} status
 */
export async function updateIssueStatus(id, status) {
  const response = await axios.put(
    `${API_BASE}/issues/${id}`,
    { status },
    { headers: authHeader() }
  );
  return response.data;
}

/**
 * GOV only — override the AI workforce estimate for an issue.
 * @param {string} id - Issue MongoDB _id
 * @param {{ workerCount: number, estimatedHours: number, overrideReason?: string }} body
 */
export async function overrideWorkforce(id, body) {
  const response = await axios.put(`${API_BASE}/issues/${id}/workforce`, body, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return response.data;
}

/**
 * GOV only — record actual resolution data (trains the historical model).
 * @param {string} id - Issue MongoDB _id
 * @param {{ actualWorkerCount: number, actualHours: number, notes?: string }} body
 */
export async function recordResolution(id, body) {
  const response = await axios.put(`${API_BASE}/issues/${id}/resolution`, body, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return response.data;
}

/**
 * Fetch heatmap coordinate data (public).
 */
export async function fetchHeatmapData() {
  const response = await axios.get(`${API_BASE}/issues/heatmap`);
  return response.data;
}

/**
 * GOV only — generate optimized routes for a date.
 * @param {string} date - 'YYYY-MM-DD'
 */
export async function generateRoutes(date) {
  const response = await axios.post(`${API_BASE}/routes/generate`, { date }, {
    headers: { 'Content-Type': 'application/json', ...authHeader() },
  });
  return response.data;
}

/**
 * GOV only — list routes for a date/status.
 * @param {{ date?: string, status?: string }} params
 */
export async function getRoutes(params = {}) {
  const response = await axios.get(`${API_BASE}/routes`, { params, headers: authHeader() });
  return response.data;
}

/**
 * GOV only — mark a route stop complete.
 * @param {string} routeId
 * @param {string} stopId
 */
export async function completeStop(routeId, stopId) {
  const response = await axios.put(`${API_BASE}/routes/${routeId}/stop/${stopId}`, {}, {
    headers: authHeader(),
  });
  return response.data;
}

/**
 * GOV only — list active work teams.
 */
export async function getTeams() {
  const response = await axios.get(`${API_BASE}/routes/teams`, { headers: authHeader() });
  return response.data;
}
