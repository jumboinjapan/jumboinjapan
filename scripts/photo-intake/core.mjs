import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { canonicalJsonBytes } from '../lib/canonical-contract.mjs'

export const LIBRARY = '/GS/Проекты/Jumboinjapan/photo-library'
export const REGISTRY = `${LIBRARY}/catalog/registry.json`
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const fingerprint = value => sha256(canonicalJsonBytes(value, 'jumbo-photo-intake/v1'))
const idPattern = /^IMG-\d{6}$/
const hashPattern = /^[a-f0-9]{64}$/
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const id = n => { assert(n > 0 && n <= 999999, 'IMG ID range exhausted'); return `IMG-${String(n).padStart(6, '0')}` }
export function text(value, name, max = 500) {
  assert(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value), `${name}: invalid text`)
}
export function keys(value, required, optional = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'object required')
  assert(required.every(k => Object.hasOwn(value, k)), `missing keys: ${required.join(', ')}`)
  assert(Object.keys(value).every(k => [...required, ...optional].includes(k)), 'unknown keys')
}
export function validateInput(input) {
  canonicalJsonBytes(input, 'photo-input/v1')
  keys(input, ['version', 'items']); assert.equal(input.version, 1, 'unsupported input version')
  assert(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 20, '1..20 input items required')
  for (const x of input.items) {
    keys(x, ['file', 'titleRu', 'subjectSlug', 'collectionTag', 'rights'], ['assetId', 'poiId'])
    text(x.file, 'file', 4096); text(x.titleRu, 'titleRu'); text(x.subjectSlug, 'subjectSlug', 80); text(x.collectionTag, 'collectionTag', 80)
    assert(slugPattern.test(x.subjectSlug) && slugPattern.test(x.collectionTag), 'invalid slug')
    text(x.rights, 'rights', 2000)
    if (Object.hasOwn(x, 'assetId')) assert(idPattern.test(x.assetId), 'invalid assetId')
    if (Object.hasOwn(x, 'poiId')) assert(/^POI-\d{6}$/.test(x.poiId), 'invalid poiId')
  }
  return input
}
export function validateBatch(batch) {
  canonicalJsonBytes(batch, 'photo-batch/v1')
  keys(batch, ['version', 'batchId', 'items']); assert.equal(batch.version, 1, 'unsupported batch version')
  const inputs = batch.items?.map(x => x.input)
  validateInput({ version: 1, items: inputs })
  for (const item of batch.items) {
    keys(item, ['input', 'files']); assert(Array.isArray(item.files) && item.files.length === 2, 'original and web required')
    assert.deepEqual(item.files.map(f => f.role), ['original', 'web'])
    for (const f of item.files) {
      keys(f, ['role', 'file', 'sha256', 'bytes', 'width', 'height', 'extension'])
      assert(hashPattern.test(f.sha256), 'invalid SHA-256')
      assert(['jpg', 'png', 'webp', 'avif', 'tiff', 'heif'].includes(f.extension), 'unsupported image format')
      if (f.role === 'web') assert.equal(f.extension, 'webp', 'web variant must be WebP')
      assert.equal(f.file, `${f.sha256}.${f.extension}`, 'unsafe or unbound file path')
      for (const k of ['bytes', 'width', 'height']) assert(Number.isSafeInteger(f[k]) && f[k] > 0, `invalid ${k}`)
      assert(f.bytes <= 100 * 1024 * 1024 && f.width * f.height <= 80_000_000, 'image exceeds bounds')
    }
  }
  assert.equal(batch.batchId, fingerprint({ version: batch.version, items: batch.items }), 'batch fingerprint mismatch')
  return batch
}
export function validateRegistry(registry) {
  canonicalJsonBytes(registry, 'photo-registry/v1')
  assert.equal(registry.schemaVersion, 1, 'unsupported registry version')
  assert(Array.isArray(registry.assets) && registry.aliasMap && typeof registry.aliasMap === 'object', 'invalid registry')
  assert(Number.isSafeInteger(registry.nextId) && registry.nextId > 0 && registry.nextId <= 999999, 'invalid nextId')
  if (registry.reservedDraftIds !== undefined) {
    const reserved = /^IMG-000001\.\.IMG-(\d{6}); never reuse retired aliases$/.exec(registry.reservedDraftIds)
    assert(reserved && registry.nextId > Number(reserved[1]), 'nextId would reuse a reserved draft ID')
  }
  const assets = new Set(), variants = new Set(), hashes = new Set(), paths = new Set()
  for (const a of registry.assets) {
    assert(idPattern.test(a.assetId) && !assets.has(a.assetId), 'duplicate/invalid asset ID'); assets.add(a.assetId)
    assert(Array.isArray(a.variants) && a.variants.length > 0, 'asset without variants')
    assert(typeof a.subjectSlug === 'string' && slugPattern.test(a.subjectSlug), 'invalid registry slug')
    text(a.titleRu, 'registry titleRu'); text(a.collectionTag, 'registry collectionTag', 80); text(a.rightsStatus, 'registry rightsStatus', 2000)
    for (const v of a.variants) {
      assert(idPattern.test(v.variantId) && !variants.has(v.variantId), 'duplicate/invalid variant ID'); variants.add(v.variantId)
      assert(hashPattern.test(v.sha256) && !hashes.has(v.sha256), 'duplicate/invalid variant hash'); hashes.add(v.sha256)
      assert.equal(registry.aliasMap[v.variantId], a.assetId, 'variant alias mismatch')
      assert(typeof v.relativePath === 'string' && /^assets\/IMG-\d{6}\/[a-zA-Z0-9_.-]+$/.test(v.relativePath), 'unsafe registry path')
      assert(v.relativePath.startsWith(`assets/${a.assetId}/`), 'wrong asset folder')
      assert(!paths.has(v.relativePath.toLowerCase()), 'duplicate destination'); paths.add(v.relativePath.toLowerCase())
      for (const k of ['bytes', 'width', 'height']) assert(Number.isSafeInteger(v[k]) && v[k] > 0, `invalid variant ${k}`)
    }
  }
  for (const [alias, target] of Object.entries(registry.aliasMap)) {
    assert(idPattern.test(alias) && assets.has(target), 'invalid alias target')
    assert(Number(alias.slice(4)) < registry.nextId, 'nextId would reuse an alias')
  }
  for (const value of [...assets, ...variants]) assert(Number(value.slice(4)) < registry.nextId, 'nextId would reuse an ID')
  if (registry.intakeBatches !== undefined) assert(registry.intakeBatches && !Array.isArray(registry.intakeBatches), 'invalid intakeBatches')
  return registry
}
export function findVariant(registry, hash) {
  for (const asset of registry.assets) {
    const variant = asset.variants.find(v => v.sha256 === hash)
    if (variant) return { asset, variant }
  }
  return null
}
export function planBatch(registry, batch) {
  validateBatch(batch); validateRegistry(registry)
  const next = structuredClone(registry)
  const prior = next.intakeBatches?.[batch.batchId]
  if (prior) {
    assert.equal(prior.batchId, batch.batchId, 'corrupt batch reservation')
    assert.deepEqual(prior.hashes, [...new Set(batch.items.flatMap(x => x.files.map(f => f.sha256)))], 'reservation hash mismatch')
    for (const item of batch.items) {
      const original = findVariant(next, item.files[0].sha256)
      assert(original, 'reservation missing original')
      if (item.input.assetId) assert.equal(original.asset.assetId, next.aliasMap[item.input.assetId] || item.input.assetId, 'reservation asset mismatch')
      for (const file of item.files) {
        const found = findVariant(next, file.sha256); assert(found, 'reservation missing variant')
        assert.equal(found.asset.assetId, original.asset.assetId, 'reservation variant mismatch')
        for (const key of ['bytes','width','height']) assert.equal(found.variant[key], file[key], 'reservation metadata mismatch')
      }
    }
    return { registry: next, batchId: batch.batchId, newAssets: 0, newVariants: 0, resumed: true }
  }
  let newAssets = 0, newVariants = 0
  for (const item of batch.items) {
    const existing = findVariant(next, item.files[0].sha256)
    const selected = item.input.assetId ? next.assets.find(a => a.assetId === (next.aliasMap[item.input.assetId] || item.input.assetId)) : null
    if (item.input.assetId) assert(selected, 'requested asset does not exist')
    if (existing && selected) assert.equal(existing.asset.assetId, selected.assetId, 'same bytes assigned to another asset')
    let asset = existing?.asset || selected
    if (!asset) {
      const assetId = id(next.nextId++)
      asset = { assetId, titleRu: item.input.titleRu, subjectSlug: item.input.subjectSlug, collectionTag: item.input.collectionTag, kind: 'photo', locationStatus: 'user-context-not-geolocation-proof', rightsStatus: item.input.rights, status: 'intake-reserved', variants: [], usages: [], poiUsageEvidence: [] }
      next.assets.push(asset); newAssets++
    }
    for (const file of item.files) {
      const duplicate = findVariant(next, file.sha256)
      if (duplicate) {
        assert.equal(duplicate.asset.assetId, asset.assetId, 'variant hash belongs to another asset')
        for (const key of ['bytes','width','height']) assert.equal(duplicate.variant[key], file[key], 'hash metadata conflict')
        duplicate.variant.sources ??= []
        if (!duplicate.variant.sources.some(s => s.batchId === batch.batchId && s.logicalPath === item.input.file)) duplicate.variant.sources.push({ collection:'chat-intake', logicalPath:item.input.file, batchId:batch.batchId })
        continue
      }
      const variantId = asset.variants.length === 0 ? asset.assetId : id(next.nextId++)
      const relativePath = `assets/${asset.assetId}/${asset.assetId}__${asset.subjectSlug}__${file.width}x${file.height}__${file.sha256.slice(0,12)}.${file.extension}`
      const variant = { variantId, sha256: file.sha256, bytes: file.bytes, width: file.width, height: file.height, relativePath, role: file.role === 'original' ? 'intake-original' : 'intake-web', sources: [{ collection: 'chat-intake', logicalPath: item.input.file, batchId: batch.batchId }], intakeBatchId: batch.batchId }
      asset.variants.push(variant); next.aliasMap[variantId] = asset.assetId; newVariants++
    }
  }
  next.intakeBatches ??= {}
  next.intakeBatches[batch.batchId] = { batchId: batch.batchId, status: 'reserved', hashes: [...new Set(batch.items.flatMap(x => x.files.map(f => f.sha256)))] }
  validateRegistry(next)
  return { registry: next, batchId: batch.batchId, newAssets, newVariants, resumed: false }
}

/** Whole registry CAS; mutations are deterministic and safe to recompute after conflict. */
export async function updateRegistry(store, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await store.readRegistry(); validateRegistry(before.value)
    const after = change(structuredClone(before.value)); validateRegistry(after)
    if (fingerprint(before.value) === fingerprint(after)) return after
    try { await store.compareAndSwap(before.revision, after) }
    catch (error) { if (error.code === 'REVISION_CONFLICT') continue; throw error }
    const readback = await store.readRegistry(); validateRegistry(readback.value)
    // Another writer may have progressed the registry; caller proves its own postconditions.
    return readback.value
  }
  throw new Error('Registry changed repeatedly; retry the same batch after other writer finishes')
}

export async function applyBatch({ batch, buffers, archive, metadata, journal }) {
  validateBatch(batch)
  for (const f of batch.items.flatMap(x => x.files)) {
    const bytes = buffers.get(f.sha256)
    assert(Buffer.isBuffer(bytes) && sha256(bytes) === f.sha256 && bytes.length === f.bytes, 'prepared bytes changed')
  }
  const initial = await archive.readRegistry(); planBatch(initial.value, batch)
  await metadata.preflight(batch) // Full external chain before first write.
  const completed = initial.value.intakeBatches?.[batch.batchId]
  if (completed?.status === 'complete') {
    for (const file of new Map(batch.items.flatMap(x => x.files).map(f => [f.sha256,f])).values()) {
      const v = findVariant(initial.value,file.sha256).variant
      const actual = await archive.readFile(`${LIBRARY}/${v.relativePath}`)
      assert.equal(sha256(actual.bytes),file.sha256,'completed archive bytes changed')
      assert.equal(actual.metadata.id,v.dropbox?.fileId,'completed file identity changed')
    }
    await metadata.verify(completed.airtable)
    const result = { status:'complete',batchId:batch.batchId,resumed:true,website:'not-published',records:completed.airtable }
    await journal({ event:'complete-readback',...result }); return result
  }
  await journal({ event: 'preflight', batchId: batch.batchId, registryRevision: initial.revision, registrySha256: fingerprint(initial.value), registryBefore:initial.value })
  let registry = await updateRegistry(archive, r => planBatch(r, batch).registry)
  assert(registry.intakeBatches?.[batch.batchId], 'reservation not visible')
  await journal({ event: 'reserved', batchId: batch.batchId })
  const files = new Map(batch.items.flatMap(x => x.files).map(f => [f.sha256, f]))
  for (const [hash] of files) {
    const found = findVariant(registry, hash); assert(found, 'reserved variant missing')
    const path = `${LIBRARY}/${found.variant.relativePath}`
    await journal({ event: 'file-start', hash, path })
    const result = await archive.ensureFile(path, buffers.get(hash))
    const actual = await archive.readFile(path)
    assert.equal(sha256(actual.bytes), hash, 'Dropbox readback hash mismatch')
    assert(actual.metadata.id === result.id && actual.metadata.size === buffers.get(hash).length, 'Dropbox file identity mismatch')
    assert.equal(actual.metadata.path_display.toLowerCase(), path.toLowerCase(), 'Dropbox path mismatch')
    registry = await updateRegistry(archive, r => {
      const v = findVariant(r, hash)?.variant; assert(v && v.relativePath === found.variant.relativePath, 'variant changed')
      v.dropbox = { fileId: actual.metadata.id, path: actual.metadata.path_display, status: 'completed', sha256VerifiedAfterDownload: true }
      return r
    })
    assert.equal(findVariant(registry, hash)?.variant.dropbox?.fileId, actual.metadata.id, 'archive commit not visible')
    await journal({ event: 'file-verified', hash, fileId: actual.metadata.id })
  }
  registry = await updateRegistry(archive, r => {
    for (const hash of files.keys()) {
      const { asset, variant } = findVariant(r, hash)
      assert.equal(variant.dropbox?.status, 'completed')
      if (asset.variants.every(v => v.dropbox?.status === 'completed')) asset.status = 'archived-verified'
    }
    r.intakeBatches[batch.batchId].status = 'archive-verified'; return r
  })
  await journal({ event: 'archive-verified', batchId: batch.batchId })
  const records = await metadata.upsertVerified(registry, batch, journal)
  await metadata.verify(records)
  registry = await updateRegistry(archive, r => {
    r.intakeBatches[batch.batchId].status = 'complete'; r.intakeBatches[batch.batchId].airtable = records; return r
  })
  assert.equal(registry.intakeBatches[batch.batchId].status, 'complete', 'completion not visible')
  const result = { status: 'complete', batchId: batch.batchId, inputItems: batch.items.length, verifiedFiles: files.size, website: 'not-published', records }
  await journal({ event: 'complete', ...result })
  return result
}
