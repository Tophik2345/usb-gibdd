import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGitHubIdentity } from '../supabase/functions/sync-law-references/github-identity.mjs';

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'local-test-key', alg: 'RS256', use: 'sig' };
const now = 1800000000;
const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'usb-gibdd-law-sync', repository: 'Tophik2345/usb-gibdd', ref: 'refs/heads/main', sub: 'repo:Tophik2345/usb-gibdd:ref:refs/heads/main', workflow_ref: 'Tophik2345/usb-gibdd/.github/workflows/laws-sync.yml@refs/heads/main', iat: now - 30, exp: now + 300, sha: 'a'.repeat(40) };
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const sign = async value => { const message = encode({ alg: 'RS256', kid: jwk.kid }) + '.' + encode(value); return message + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(message))).toString('base64url'); };
const request = async (url, options) => { assert.equal(url, 'https://token.actions.githubusercontent.com/.well-known/jwks'); assert.equal(options.redirect, 'error'); assert(!options.headers); return Response.json({ keys: [jwk] }); };

await test('only the signed main-branch law workflow identity can update bookmark references', async () => {
  const identity = await verifyGitHubIdentity(await sign(claims), request, now);
  assert.equal(identity.repository, 'Tophik2345/usb-gibdd'); assert.equal(identity.sha, claims.sha);
});
await test('forks, pull requests, other workflows, wrong audiences and expired identities are denied', async () => {
  for (const change of [{ repository: 'other/usb-gibdd' }, { ref: 'refs/pull/1/merge' }, { ref: 'refs/pull/1/merge', sub: 'repo:Tophik2345/usb-gibdd:pull_request' }, { sub: '' }, { workflow_ref: 'Tophik2345/usb-gibdd/.github/workflows/pages.yml@refs/heads/main' }, { aud: 'other' }, { iss: 'https://other.test' }, { exp: now - 1 }, { iat: now + 120 }, { nbf: now + 120 }]) await assert.rejects(verifyGitHubIdentity(await sign({ ...claims, ...change }), request, now));
});
await test('custom subject templates still require the signed repository, exact main ref and exact law workflow', async () => {
  const custom = { ...claims, sub: 'repository_id:123:workflow_ref:custom-subject-template' };
  assert.equal((await verifyGitHubIdentity(await sign(custom), request, now)).repository, claims.repository);
  await assert.rejects(verifyGitHubIdentity(await sign({ ...custom, ref: 'refs/heads/untrusted' }), request, now));
});
await test('a tampered signature, unsigned JWT and unknown signing key cannot authenticate', async () => {
  const token = await sign(claims), parts = token.split('.');
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  await assert.rejects(verifyGitHubIdentity(parts[0] + '.' + parts[1] + '.' + signature.toString('base64url'), request, now));
  await assert.rejects(verifyGitHubIdentity(encode({ alg: 'none' }) + '.' + encode(claims) + '.x', request, now));
  await assert.rejects(verifyGitHubIdentity(token, async () => Response.json({ keys: [] }), now));
});
