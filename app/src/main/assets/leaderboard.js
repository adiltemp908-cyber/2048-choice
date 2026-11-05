import { firebaseConfig } from './firebase-config.js';
import { exact, integerField, fieldInteger } from './numbers.js';

export class Leaderboard {
  constructor(storage) { this.storage = storage; this.syncing = null; }
  async init() {
    this.config = await this.storage.read('firebase') || firebaseConfig;
    this.auth = await this.storage.read('auth');
    return this;
  }
  get configured() { return Boolean(this.config?.apiKey && this.config?.projectId); }
  async configure(projectId, apiKey) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || !/^AIza[\w-]{20,}$/.test(apiKey)) throw new Error('Check the project ID and Web API key.');
    const prior = { config: this.config, auth: this.auth };
    const changed = projectId !== this.config?.projectId;
    this.config = { projectId, apiKey };
    if (changed) this.auth = null;
    try {
      await this.token();
      await this.storage.write('firebase', this.config);
    } catch (error) {
      this.config = prior.config; this.auth = prior.auth;
      await this.storage.write('auth', this.auth || null);
      throw error;
    }
  }
  async request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      const data = await r.json();
      if (!r.ok) {
        const error = new Error(data.error?.message || 'Could not connect to the leaderboard.');
        error.status = r.status;
        throw error;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Connection timed out. Your scores are saved on this phone.');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  async token() {
    if (!this.configured) throw new Error('The shared leaderboard has not been connected yet.');
    if (this.auth?.expires > Date.now() + 60000) return this.auth.idToken;
    if (this.tokenTask) return this.tokenTask;
    this.tokenTask = this.refreshAuth();
    try { return await this.tokenTask; } finally { this.tokenTask = null; }
  }
  async refreshAuth() {
    let data;
    if (this.auth?.refreshToken) {
      data = await this.request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.config.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.auth.refreshToken }).toString()
      });
      this.auth = { idToken: data.id_token, refreshToken: data.refresh_token, uid: data.user_id, expires: Date.now() + Number(data.expires_in) * 1000 };
    } else {
      data = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.config.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
      });
      this.auth = { idToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId, expires: Date.now() + Number(data.expiresIn) * 1000 };
    }
    await this.storage.write('auth', this.auth);
    return this.auth.idToken;
  }
  get base() { return `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)/documents`; }
  async authorized(path, options = {}) {
    const token = await this.token();
    return this.request(this.base + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  }
  async sync(records, nickname) {
    if (!this.configured || !nickname || !navigator.onLine) return;
    if (this.syncing) return this.syncing;
    this.syncing = this.upload(records, nickname);
    try { return await this.syncing; } finally { this.syncing = null; }
  }
  async upload(records, nickname) {
    await this.token();
    const sentKey = 'sent-' + this.config.projectId + '-' + this.auth.uid;
    const sent = await this.storage.read(sentKey) || {};
    for (const [board, best] of Object.entries(records)) {
      const marker = `${best.score}:${nickname}`;
      if (!best.score || sent[board] === marker) continue;
      const fields = { nickname: { stringValue: nickname }, score: integerField(best.score), maxTile: integerField(best.maxTile), updatedAt: { timestampValue: new Date(best.at).toISOString() } };
      const path = `/boards/${board}/scores/${this.auth.uid}`;
      // Preserve the larger score when the same installation has already synced.
      let remote;
      try { remote = await this.authorized(path); } catch (e) { if (e.status !== 404) throw e; }
      if (exact(fieldInteger(remote?.fields?.score)) > exact(best.score)) {
        fields.score = remote.fields.score;
        fields.maxTile = remote.fields.maxTile;
        fields.updatedAt = remote.fields.updatedAt;
      }
      await this.authorized(path, { method: 'PATCH', body: JSON.stringify({ fields }) });
      sent[board] = marker;
      await this.storage.write(sentKey, sent);
    }
  }
  async fetchBoard(board) {
    const rows = await this.authorized(`/boards/${board}:runQuery`, {
      method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'scores' }], orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit: 100 } })
    });
    return rows.filter(r => r.document).map(r => ({ uid: r.document.name.split('/').pop(), nickname: r.document.fields.nickname.stringValue, score: fieldInteger(r.document.fields.score), maxTile: fieldInteger(r.document.fields.maxTile) }));
  }
}
