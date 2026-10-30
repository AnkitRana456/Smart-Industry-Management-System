/**
 * Empty in development (Vite proxies /api and /socket.io to the server).
 * In production set VITE_API_URL to the API's origin, e.g. https://sims-api.onrender.com
 */
export const API_ORIGIN: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
