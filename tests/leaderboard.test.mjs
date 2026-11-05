import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../app/src/main/assets/leaderboard.js';
import { firebaseConfig } from '../app/src/main/assets/firebase-config.js';
import { integerField, maximumScore, exact } from '../app/src/main/assets/numbers.js';

class MemoryStorage {
  data = new Map();
  async read(key) { return structuredClone(this.data.get(key)); }
  async write(key, value) { this.data.set(key, structuredClone(value)); }
}
const config = { projectId: 'test-project', apiKey: 'AIza' + 'x'.repeat(30) };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('fresh installs use the shared Firebase project without configuration entry', async () => {
  const service = await new Leaderboard(new MemoryStorage()).init();
  assert.equal(service.configured, true);
  assert.equal(service.config.projectId, 'choice-54ecd');
  assert.deepEqual(service.config, firebaseConfig);
});

test('guest authentication, score upload, top 100 query and refresh-token reuse', async () => {
  const originalFetch = globalThis.fetch;
  const online = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  const storage = new MemoryStorage(); await storage.write('firebase', config);
  const calls = [], remote = new Map();
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('accounts:signUp')) return json({ idToken: 'token', refreshToken: 'refresh', localId: 'player-a', expiresIn: '3600' });
    if (url.includes('securetoken')) return json({ id_token: 'new-token', refresh_token: 'refresh', user_id: 'player-a', expires_in: '3600' });
    assert.match(options.headers.Authorization, /^Bearer /);
    if (url.endsWith(':runQuery')) return json([{ document: { name: 'boards/v1_4_standard/scores/player-a', fields: remote.values().next().value } }]);
    if (options.method === 'PATCH') { remote.set(url, JSON.parse(options.body).fields); return json({}); }
    return remote.has(url) ? json({ fields: remote.get(url) }) : json({ error: { message: 'Not found' } }, 404);
  };
  try {
    const service = await new Leaderboard(storage).init();
    const records = { v1_4_standard: { score: 128, maxTile: 32, at: 1000 }, v1_4_unlimited: { score: 256, maxTile: 64, at: 2000 } };
    await service.sync(records, 'A Friend');
    assert.equal(remote.size, 2);
    const sentCount = calls.length;
    await service.sync(records, 'A Friend');
    assert.equal(calls.length, sentCount, 'unchanged scores are not written again');
    await service.sync(records, 'New Name');
    assert.equal([...remote.values()][0].nickname.stringValue, 'New Name');
    const rows = await service.fetchBoard('v1_4_standard');
    assert.equal(rows[0].score, 128); assert.equal(rows[0].uid, 'player-a');
    const query = JSON.parse(calls.at(-1).options.body).structuredQuery;
    assert.equal(query.limit, 100); assert.equal(query.orderBy[0].direction, 'DESCENDING');
    service.auth.expires = 0; await service.token();
    assert.equal(service.auth.idToken, 'new-token');
    assert.ok(calls.at(-1).options.body.includes('grant_type=refresh_token'));
    const remoteValue = [...remote.values()][0]; remoteValue.score.integerValue = '512';
    records.v1_4_standard.score = 132; await service.sync(records, 'New Name');
    assert.equal([...remote.values()][0].score.integerValue, '512', 'cloud best is never reduced');
  } finally { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', online); }
});
test('offline scores stay pending and failed connection preserves existing identity', async () => {
  const originalFetch = globalThis.fetch;
  const online = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const storage = new MemoryStorage(); await storage.write('firebase', config);
  const auth = { uid: 'old-player', idToken: 'old-token', refreshToken: 'old-refresh', expires: Date.now() + 3600000 };
  await storage.write('auth', auth);
  const service = await new Leaderboard(storage).init();
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; return json({ error: { message: 'API_KEY_INVALID' } }, 400); };
  try {
    await service.sync({ v1_4_standard: { score: 4, maxTile: 4, at: 1000 } }, 'Friend');
    assert.equal(networkCalls, 0);
    await assert.rejects(service.configure('other-project', config.apiKey), /API_KEY_INVALID/);
    assert.deepEqual(service.config, config); assert.deepEqual(service.auth, auth);
    assert.deepEqual(await storage.read('auth'), auth);
  } finally { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', online); }
});

test('huge leaderboard scores round-trip exactly and a higher remote best is preserved', async () => {
  const originalFetch=globalThis.fetch;
  const online=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  const storage=new MemoryStorage();await storage.write('firebase',config);
  await storage.write('auth',{uid:'large-player',idToken:'token',refreshToken:'refresh',expires:Date.now()+3600000});
  const max=maximumScore(8);
  const remote={nickname:{stringValue:'Large player'},score:integerField(max),maxTile:integerField(2n**65n),updatedAt:{timestampValue:'2026-10-29T00:00:00Z'}};
  let written;
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith(':runQuery'))return json([{document:{name:'boards/v1_8_standard/scores/large-player',fields:remote}}]);
    if(options.method==='PATCH'){written=JSON.parse(options.body).fields;return json({});}
    return json({fields:remote});
  };
  try{
    const service=await new Leaderboard(storage).init();
    await service.sync({v1_8_standard:{score:(max-4n).toString(),maxTile:2**65,at:1000}},'Large player');
    assert.deepEqual(written.score,integerField(max));
    const rows=await service.fetchBoard('v1_8_standard');
    assert.equal(exact(rows[0].score),max);assert.equal(exact(rows[0].maxTile),2n**65n);
  }finally{globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'navigator',online);}
});
