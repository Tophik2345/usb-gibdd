const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'usb-gibdd-law-sync';
const repository = 'Tophik2345/usb-gibdd';
const workflow = `${repository}/.github/workflows/laws-sync.yml@refs/heads/main`;
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));

export async function verifyGitHubIdentity(token, request = fetch, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 20000) throw new Error('Invalid identity.');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid identity.');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== issuer || claims.aud !== audience ||
      claims.repository !== repository || claims.ref !== 'refs/heads/main' ||
      claims.sub !== `repo:${repository}:ref:refs/heads/main` || claims.workflow_ref !== workflow ||
      !Number.isFinite(claims.exp) || claims.exp <= now || claims.exp > now + 3600 ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.iat < now - 3600 ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60))) throw new Error('Invalid identity.');
  const response = await request(`${issuer}/.well-known/jwks`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Identity verification is unavailable.');
  const keys = await response.json();
  const jwk = keys.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  if (!jwk) throw new Error('Invalid identity.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))) throw new Error('Invalid identity.');
  return { repository, workflow, sha: claims.sha };
}
