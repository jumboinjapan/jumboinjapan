#!/usr/bin/env node
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { connect } from './photo-intake/oauth.mjs'
const {values}=parseArgs({options:{'app-key':{type:'string'},write:{type:'boolean'},help:{type:'boolean'}}})
if(values.help) console.log('npm run photo:connect -- --app-key APP_KEY --write\nSet Dropbox redirect URI to http://localhost:8768/dropbox/callback first. Saves a private .env.photo-intake.local after owner OAuth approval. No tokens are printed.')
else {
  try {
    assert(values.write,'connect requires --write')
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
    await connect(values['app-key'],path.join(root,'.env.photo-intake.local'))
    console.log('Dropbox connection saved. Run npm run photo:intake -- doctor.')
  }catch(e){console.error(`Photo connection: ${e.message}`);process.exitCode=1}
}
