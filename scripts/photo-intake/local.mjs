import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { fingerprint, sha256, validateInput, validateBatch, findVariant } from './core.mjs'

/** Follow no symlink in a write destination, including dangling links and parents. */
export async function safePath(file, { mustExist = false } = {}) {
  assert(path.isAbsolute(file), 'absolute path required')
  let cursor = path.parse(file).root
  for (const part of path.relative(cursor, file).split(path.sep)) {
    cursor = path.join(cursor, part)
    try { const s = await fs.lstat(cursor); assert(!s.isSymbolicLink(), `symlink forbidden: ${cursor}`) }
    catch (e) { if (e.code !== 'ENOENT' || mustExist) throw e }
  }
  return file
}
export async function readImage(file) {
  await safePath(file, { mustExist:true }); const stat = await fs.stat(file)
  assert(stat.isFile() && stat.size > 0 && stat.size <= 100*1024*1024, 'image size outside bounds')
  const bytes = await fs.readFile(file)
  assert.equal(bytes.length, stat.size, 'source image changed during read')
  const image = sharp(bytes, { limitInputPixels:80_000_000, failOn:'warning' })
  const m = await image.metadata(); assert((m.pages || 1) === 1, 'animated/multipage files need separate review')
  const extension = ({ jpeg:'jpg', png:'png', webp:'webp', avif:'avif', tiff:'tiff', heif:'heif' })[m.format]
  assert(extension, 'unsupported image format')
  // Decode the full image, preserve source bytes, orient only the derived web file.
  const web = await image.rotate().resize({ width:1800, height:1800, fit:'inside', withoutEnlargement:true }).toColourspace('srgb').webp({ quality:88 }).toBuffer({ resolveWithObject:true })
  const original = { bytes, extension, width:m.width, height:m.height }
  return [original, { bytes:web.data, extension:'webp', width:web.info.width, height:web.info.height }]
}
export async function prepare(input, output) {
  validateInput(input); await safePath(output)
  try { await fs.lstat(output); throw new Error('output already exists') } catch (e) { if (e.code !== 'ENOENT') throw e }
  const images = []
  // Validate/decode the entire input before creating any output.
  for (const item of input.items) images.push(await readImage(path.resolve(item.file)))
  const items = input.items.map((item, n) => ({ input:item, files:images[n].map((f,i) => ({ role:i ? 'web' : 'original', file:`${sha256(f.bytes)}.${f.extension}`, sha256:sha256(f.bytes), bytes:f.bytes.length, width:f.width, height:f.height, extension:f.extension })) }))
  const batch = { version:1, batchId:fingerprint({ version:1, items }), items }; validateBatch(batch)
  await fs.mkdir(output) // exclusive destination, no recursive creation
  const written = new Set()
  for (let n = 0; n < items.length; n++) for (let i = 0; i < 2; i++) {
    const file = items[n].files[i].file
    if (!written.has(file)) await fs.writeFile(path.join(output,file), images[n][i].bytes, { flag:'wx', mode:0o600 })
    written.add(file)
  }
  await fs.writeFile(path.join(output,'batch.json'), JSON.stringify(batch,null,2)+'\n', { flag:'wx', mode:0o600 })
  await loadBatch(output)
  return batch
}
export async function loadBatch(root) {
  await safePath(root, { mustExist:true }); await safePath(path.join(root,'batch.json'), { mustExist:true })
  const batch = JSON.parse(await fs.readFile(path.join(root,'batch.json'),'utf8')); validateBatch(batch)
  const buffers = new Map()
  for (const f of batch.items.flatMap(x => x.files)) {
    const file = path.join(root,f.file); await safePath(file, { mustExist:true })
    const s = await fs.stat(file); assert(s.isFile() && s.size === f.bytes, 'prepared file size changed')
    const bytes = await fs.readFile(file); assert.equal(sha256(bytes),f.sha256,'prepared file hash changed')
    const m = await sharp(bytes, { limitInputPixels:80_000_000, failOn:'warning' }).metadata()
    const format = ({ jpg:'jpeg',png:'png',webp:'webp',avif:'heif',tiff:'tiff',heif:'heif' })[f.extension]
    assert.equal(m.format,format,'prepared image format mismatch')
    assert((m.pages || 1) === 1, 'prepared image must have one frame')
    assert.equal(m.width,f.width,'prepared dimensions changed'); assert.equal(m.height,f.height,'prepared dimensions changed')
    await sharp(bytes, { limitInputPixels:80_000_000, failOn:'warning' }).stats()
    buffers.set(f.sha256,bytes)
  }
  return { batch, buffers }
}
export async function appendJournal(root, entry) {
  const file = path.join(root,'journal.ndjson'); await safePath(file)
  const handle = await fs.open(file,constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,0o600)
  try { await handle.write(JSON.stringify({ at:new Date().toISOString(), ...entry })+'\n'); await handle.sync() }
  finally { await handle.close() }
}
export async function exportWeb(registry, batch, buffers, checkout) {
  const publicDir = path.join(checkout,'public'); await safePath(publicDir, { mustExist:true })
  const dir = path.join(publicDir,'tours','photo-library'); await safePath(dir)
  const exports = batch.items.map(item => {
    const f = item.files[1]; const found = findVariant(registry,f.sha256)
    assert(found?.variant.dropbox?.status === 'completed', 'archive variant must be verified before export')
    const name = path.basename(found.variant.relativePath)
    return { assetId:found.asset.assetId, variantId:found.variant.variantId, file:path.join(dir,name), publicPath:`/tours/photo-library/${name}`, sha256:f.sha256, bytes:buffers.get(f.sha256), poiId:item.input.poiId || null }
  })
  for (const x of exports) {
    assert(Buffer.isBuffer(x.bytes) && sha256(x.bytes) === x.sha256, 'export bytes mismatch')
    await safePath(x.file)
    try { assert.equal(sha256(await fs.readFile(x.file)),x.sha256,'public path occupied by different bytes') } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  await fs.mkdir(dir,{ recursive:true })
  for (const x of exports) {
    try { await fs.writeFile(x.file,x.bytes,{ flag:'wx' }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    assert.equal(sha256(await fs.readFile(x.file)),x.sha256,'public export readback mismatch')
  }
  return exports.map(x => {
    const result = { ...x, status:'exported-not-published' }
    delete result.bytes
    return result
  })
}
