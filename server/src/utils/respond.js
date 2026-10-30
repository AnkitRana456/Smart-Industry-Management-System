export const ok = (res, data = null, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, data, message, errors: null });
