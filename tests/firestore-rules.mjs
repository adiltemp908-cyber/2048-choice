import assert from 'node:assert/strict';
import { integerField, maximumScore, maximumTile } from '../app/src/main/assets/numbers.js';

// Deliberately fixed to a local demo project: never run these writes against production.
const project = 'demo-2048-tests';
const base = `http://127.0.0.1:8185/v1/projects/${project}/databases/(default)/documents`;
const token = uid => {
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'none',typ:'JWT'})}.${encode({sub:uid,user_id:uid,aud:project,iss:`https://securetoken.google.com/${project}`,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'anonymous',identities:{}}})}.`;
};
async function request(path, method='GET', body, uid) {
  const r = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(uid?{Authorization:`Bearer ${token(uid)}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const result = await r.json(); return {status:r.status,body:result};
}
const document = (score=128,maxTile=32) => ({fields:{nickname:{stringValue:'Test player'},score:integerField(score),maxTile:integerField(maxTile),updatedAt:{timestampValue:'2026-10-29T00:00:00Z'}}});
const own = '/boards/v1_4_standard/scores/alice';
assert.equal((await request(own)).status,403,'signed-out read denied');
assert.equal((await request(own,'PATCH',document())).status,403,'signed-out write denied');
let result = await request(own,'PATCH',document(), 'alice');
assert.equal(result.status,200,JSON.stringify(result.body));
assert.equal((await request(own,'GET',undefined,'bob')).status,200,'signed-in leaderboard read allowed');
assert.equal((await request(own,'PATCH',document(256,64),'bob')).status,403,'other player cannot edit');
assert.equal((await request(own,'DELETE',undefined,'alice')).status,403,'deletion denied');
assert.equal((await request(own,'PATCH',document(124),'alice')).status,403,'score cannot decrease');
assert.equal((await request(own,'PATCH',document(132,6),'alice')).status,403,'non-power-of-two tile denied');
assert.equal((await request(own,'PATCH',document(maximumScore(4)+4n),'alice')).status,403,'above mathematical limit denied');
assert.equal((await request('/boards/v1_9_standard/scores/alice','PATCH',document(),'alice')).status,403,'invalid board denied');
const extra = document(132); extra.fields.admin={booleanValue:true};
assert.equal((await request(own,'PATCH',extra,'alice')).status,403,'unexpected fields denied');
for (let n=3;n<=8;n++) {
  const path=`/boards/v1_${n}_unlimited/scores/alice`;
  result=await request(path,'PATCH',document(maximumScore(n),maximumTile(n)),'alice');
  assert.equal(result.status,200,`${n}: ${JSON.stringify(result.body)}`);
  assert.equal((await request(path,'PATCH',document(maximumScore(n)-4n,maximumTile(n)),'alice')).status,403,'exact huge score cannot decrease');
}
const large='/boards/v1_8_standard/scores/alice';
assert.equal((await request(large,'PATCH',document(128),'alice')).status,200);
assert.equal((await request(large,'PATCH',document(maximumScore(8)-4n,maximumTile(8)),'alice')).status,200,'promotion to exact string allowed');
assert.equal((await request(large,'PATCH',document(256),'alice')).status,403,'cannot replace huge score with smaller numeric score');
assert.equal((await request('/boards/v1_8_standard/scores/bob','PATCH',document(maximumScore(8),maximumTile(8)),'bob')).status,200);
assert.equal((await request('/boards/v1_8_standard/scores/carol','PATCH',document(128),'carol')).status,200);
const query={structuredQuery:{from:[{collectionId:'scores'}],orderBy:[{field:{fieldPath:'score'},direction:'DESCENDING'}],limit:100}};
const rows=(await request('/boards/v1_8_standard:runQuery','POST',query,'alice')).body.filter(r=>r.document);
assert.deepEqual(rows.map(r=>r.document.name.split('/').at(-1)),['bob','alice','carol'],'mixed numeric/string leaderboard sorts exactly');
const invalid=document(maximumScore(8)); invalid.fields.score.stringValue='000000000000000000000128';
assert.equal((await request('/boards/v1_8_standard/scores/dave','PATCH',invalid,'dave')).status,403,'small scores cannot masquerade as high-sorting strings');
console.log('Firestore rules passed: authentication, ownership, deletion, nondecreasing scores, valid shapes, per-grid limits, huge exact scores and leaderboard sorting. Local demo data only.');
