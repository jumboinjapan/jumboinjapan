import assert from 'node:assert/strict'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import { safePath } from './local.mjs'

export const REDIRECT = 'http://localhost:8768/dropbox/callback'
export const SCOPES = 'files.metadata.read files.content.read files.content.write'
export function authorization(appKey) {
  assert(typeof appKey==='string' && /^[a-zA-Z0-9]{8,100}$/.test(appKey),'invalid Dropbox app key')
  const verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('hex')
  const query=new URLSearchParams({client_id:appKey,response_type:'code',token_access_type:'offline',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state,redirect_uri:REDIRECT,scope:SCOPES})
  return {appKey,verifier,state,url:`https://www.dropbox.com/oauth2/authorize?${query}`}
}
export function callbackCode(requestUrl,session) {
  const u=new URL(requestUrl,'http://localhost:8768')
  assert(u.pathname==='/dropbox/callback' && u.origin==='http://localhost:8768','unexpected callback')
  const supplied=u.searchParams.get('state') || ''
  assert(supplied.length===session.state.length && timingSafeEqual(Buffer.from(supplied),Buffer.from(session.state)),'OAuth state mismatch')
  assert(!u.searchParams.has('error'),'Dropbox permission declined')
  const code=u.searchParams.get('code');assert(code && /^[a-zA-Z0-9_-]+$/.test(code),'invalid authorization code');return code
}
export async function exchange(session,code,fetchImpl=fetch) {
  const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:session.appKey,code_verifier:session.verifier,redirect_uri:REDIRECT})
  const response=await fetchImpl('https://api.dropboxapi.com/oauth2/token',{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(30000)})
  const result=await response.json();assert(response.ok && typeof result.refresh_token==='string','Dropbox token exchange failed')
  assert(/^[a-zA-Z0-9_.~-]+$/.test(result.refresh_token),'invalid refresh token format')
  assert(SCOPES.split(' ').every(scope=>String(result.scope || '').split(' ').includes(scope)),'Dropbox granted insufficient scopes')
  return result.refresh_token
}
export async function connect(appKey,output,onReady=console.log) {
  await safePath(output)
  try {await fs.lstat(output);throw new Error('Connection file already exists; keep it and use doctor')}catch(e){if(e.code!=='ENOENT')throw e}
  const session=authorization(appKey)
  await new Promise((resolve,reject)=>{
    let busy=false,timer
    const server=http.createServer(async(req,res)=>{
      if(req.url==='/favicon.ico'){res.writeHead(404);res.end();return}
      if(busy){res.writeHead(409);res.end('Authorization already in progress');return}
      let code
      try {assert(req.method==='GET' && req.headers.host==='localhost:8768','unexpected callback request');code=callbackCode(req.url,session)}
      catch {res.writeHead(400);res.end('Invalid authorization callback. Use the original authorization link.');return}
      busy=true
      try {
        const token=await exchange(session,code)
        await fs.writeFile(output,`# Private Dropbox Photo Intake connection; never commit.\nDROPBOX_APP_KEY=${session.appKey}\nDROPBOX_REFRESH_TOKEN=${token}\n`,{flag:'wx',mode:0o600})
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});res.end('Dropbox connected. You can close this tab.');clearTimeout(timer);server.close();resolve()
      } catch(e){res.writeHead(500);res.end('Connection could not be saved. Check the local terminal.');clearTimeout(timer);server.close();reject(e)}
    })
    server.on('error',e=>{clearTimeout(timer);reject(e)})
    server.listen(8768,'127.0.0.1',()=>{onReady(session.url);timer=setTimeout(()=>{server.close();reject(new Error('Authorization timed out after 5 minutes; run connect again'))},300000)})
  })
}
