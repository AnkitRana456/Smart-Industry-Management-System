const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Hosts named in a MongoDB connection string, without credentials or ports. */
export function mongoHosts(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri ?? '');
  if (!m) return [];
  return m[1].split(',').map((h) => h.trim().replace(/:\d+$/, '').toLowerCase());
}

export const isLocalMongo = (uri) => {
  const hosts = mongoHosts(uri);
  return hosts.length > 0 && hosts.every((h) => LOCAL.has(h));
};

/**
 * The seed script deletes every collection it touches. Returns a reason to refuse, or null when it is safe
 * to proceed: a local database in development, or anything else only with SEED_CONFIRM=yes.
 */
export function seedRefusal({ uri, nodeEnv, confirm }) {
  if (confirm === 'yes') return null;
  const hosts = mongoHosts(uri).join(', ') || 'an unrecognised address';
  if (nodeEnv === 'production') return `NODE_ENV is production (database: ${hosts}).`;
  if (!isLocalMongo(uri)) return `The database is not local (${hosts}).`;
  return null;
}
