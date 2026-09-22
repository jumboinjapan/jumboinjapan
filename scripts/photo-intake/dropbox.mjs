import assert from 'node:assert/strict'
import { LIBRARY, REGISTRY, sha256, validateRegistry } from './core.mjs'

const asciiJson = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`)
export class DropboxStore {
  constructor({ env = process.env, fetchImpl = fetch } = {}) { this.env = env; this.fetch = fetchImpl; this.token = null; this.expires = 0 }
  async accessToken() {
    if (this.env.DROPBOX_ACCESS_TOKEN) return this.env.DROPBOX_ACCESS_TOKEN
    if (this.token && Date.now() < this.expires) return this.token
    assert(this.env.DROPBOX_APP_KEY && this.env.DROPBOX_REFRESH_TOKEN, 'Dropbox connection missing: configure DROPBOX_APP_KEY + DROPBOX_REFRESH_TOKEN (or temporary DROPBOX_ACCESS_TOKEN)')
    const body = new URLSearchParams({ grant_type:'refresh_token', refresh_token:this.env.DROPBOX_REFRESH_TOKEN, client_id:this.env.DROPBOX_APP_KEY })
    if (this.env.DROPBOX_APP_SECRET) body.set('client_secret', this.env.DROPBOX_APP_SECRET)
    const r = await this.fetch('https://api.dropboxapi.com/oauth2/token', { method:'POST', body, signal:AbortSignal.timeout(30000) })
    const d = await r.json(); assert(r.ok && d.access_token, `Dropbox authentication failed (${r.status})`)
    this.token = d.access_token; this.expires = Date.now() + Math.max(0, d.expires_in - 60) * 1000
    return this.token
  }
  async request(route, args, bytes) {
    const content = route === 'files/download' || route === 'files/upload'
    const headers = { Authorization:`Bearer ${await this.accessToken()}` }
    if (content) headers['Dropbox-API-Arg'] = asciiJson(args)
    headers['Content-Type'] = content ? 'application/octet-stream' : 'application/json'
    const r = await this.fetch(`https://${content ? 'content' : 'api'}.dropboxapi.com/2/${route}`, {
      method:'POST', headers, body:content ? bytes : JSON.stringify(args), signal:AbortSignal.timeout(60000), redirect:'error',
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({})); const summary = String(d.error_summary || '')
      const error = new Error(`Dropbox ${route}: HTTP ${r.status}${summary.includes('not_found') ? ' not found' : summary.includes('conflict') ? ' conflict' : ''}`)
      error.code = r.status === 409 && summary.includes('not_found') ? 'NOT_FOUND' : r.status === 409 && summary.includes('conflict') ? 'CONFLICT' : 'DROPBOX_ERROR'
      throw error
    }
    if (route === 'files/download') {
      const metadata = JSON.parse(r.headers.get('Dropbox-API-Result') || 'null')
      const bytes = Buffer.from(await r.arrayBuffer()); assert(metadata?.id && metadata?.rev && bytes.length === metadata.size, 'invalid Dropbox download')
      return { bytes, metadata }
    }
    return r.json()
  }
  assertPath(path) { assert(typeof path === 'string' && path.startsWith(`${LIBRARY}/`) && !path.split('/').some(p=>p==='..'||p==='.') && !/[\\\u0000-\u001f]/.test(path) && path.normalize('NFC') === path, 'path outside photo library') }
  async readFile(path) { this.assertPath(path); return this.request('files/download', { path }) }
  async readRegistry() {
    const r = await this.readFile(REGISTRY)
    const value = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(r.bytes)); validateRegistry(value)
    return { value, revision:r.metadata.rev }
  }
  async compareAndSwap(revision, registry) {
    validateRegistry(registry); assert(typeof revision === 'string' && /^[a-f0-9]+$/.test(revision), 'invalid registry revision')
    try {
      return await this.request('files/upload', { path:REGISTRY, mode:{ '.tag':'update', update:revision }, autorename:false, strict_conflict:true, mute:true }, Buffer.from(JSON.stringify(registry, null, 2)+'\n'))
    } catch (e) { if (e.code === 'CONFLICT') e.code = 'REVISION_CONFLICT'; throw e }
  }
  async ensureFile(path, bytes) {
    this.assertPath(path)
    assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 100*1024*1024, 'invalid upload bytes')
    try {
      const existing = await this.readFile(path)
      assert.equal(sha256(existing.bytes), sha256(bytes), 'existing Dropbox destination has different bytes')
      return existing.metadata
    } catch (e) { if (e.code !== 'NOT_FOUND') throw e }
    // Dropbox files/upload creates missing ancestor folders. Add-only avoids lost updates.
    try { await this.request('files/upload', { path, mode:'add', autorename:false, strict_conflict:true, mute:true }, bytes) }
    catch (e) {
      if (e.code !== 'CONFLICT') throw e // Unknown/timeout outcome is reconciled by next run.
    }
    const readback = await this.readFile(path)
    assert.equal(sha256(readback.bytes), sha256(bytes), 'Dropbox upload hash mismatch')
    return readback.metadata
  }
}
