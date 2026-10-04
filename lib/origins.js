// Only serialized HTTP(S) origins are accepted, without paths or credentials.
export function isOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return !url.hostname.includes('*') && ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch { return false; }
}

export function originPolicy(env = process.env) {
  const configured = env.PUBLIC_ORIGINS?.trim() || env.PUBLIC_ORIGIN || 'http://localhost:8080';
  const origins = configured.split(',').map(value => value.trim());
  if (origins.some(value => !isOrigin(value))) throw new Error('Configure exact HTTP(S) origins in PUBLIC_ORIGINS or PUBLIC_ORIGIN (no paths, wildcards or credentials)');
  const trusted = new Set(origins);
  return value => isOrigin(value) && trusted.has(value);
}
