/** Lossless JSON storage for large fact dossiers; usable by server and browser.
 * Repeated strings, locator prefixes and object shapes are stored once. This
 * envelope changes neither the logical dossier nor its editorial digest. */
export const FACT_STORAGE_SPEC = 'poi-facts-storage/v1'
export const COMPACT_FACT_STORAGE_SPEC = 'poi-facts-storage/v2'
const MAX_CHARS = 2_000_000
const MAX_NODES = 200_000
const MAX_DEPTH = 64
function need(ok: unknown, why: string): asserts ok { if (!ok) throw new Error(`poiFactsStorage: ${why}`) }
function budget() {
  let nodes = 0, chars = 0
  return (depth: number, text = '') => {
    need(depth <= MAX_DEPTH && ++nodes <= MAX_NODES, 'structure limit')
    chars += text.length; need(chars <= MAX_CHARS, 'expanded text limit')
  }
}
export function packFactStorage(value: unknown, version: string = FACT_STORAGE_SPEC): unknown {
  need(version === FACT_STORAGE_SPEC || version === COMPACT_FACT_STORAGE_SPEC, 'envelope version')
  const compact = version === COMPACT_FACT_STORAGE_SPEC
  const values = new Set<string>(), check = budget()
  function collect(v: unknown, depth: number) {
    check(depth, typeof v === 'string' ? v : '')
    if (typeof v === 'string') values.add(v)
    else if (Array.isArray(v)) v.forEach(x => collect(x, depth + 1))
    else if (v !== null && typeof v === 'object') {
      need(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, 'plain JSON object required')
      for (const [key, x] of Object.entries(v)) { check(depth, key); values.add(key); collect(x, depth + 1) }
    } else need(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)), 'JSON value required')
  }
  collect(value, 0)
  const strings = [...values].sort(), ids = new Map(strings.map((s, i) => [s, i]))
  let previous = ''
  const dictionary = strings.map(s => {
    let prefix = 0
    while (prefix < previous.length && prefix < s.length && previous[prefix] === s[prefix]) prefix++
    const entry = [prefix, s.slice(prefix)]; previous = s; return entry
  })
  const shapes: number[][] = [], shapeIds = new Map<string, number>()
  function encode(v: unknown): unknown {
    if (typeof v === 'string') return compact ? -ids.get(v)! - 1 : [-1, ids.get(v)]
    if (Array.isArray(v)) return [-2, ...v.map(encode)]
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v).map(k => ids.get(k)!), key = keys.join(',')
      if (!shapeIds.has(key)) { shapeIds.set(key, shapes.length); shapes.push(keys) }
      return [-3, shapeIds.get(key), ...Object.values(v).map(encode)]
    }
    // V2 reserves negative integers for strings; actual negative numeric facts
    // retain their type in an explicit node.
    return compact && typeof v === 'number' && v < 0 ? [-4, v] : v
  }
  const tree = encode(value)
  return { spec: version, strings: dictionary, shapes, value: tree }
}
export function unpackFactStorage(value: unknown): unknown {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'envelope required')
  const p = value as Record<string, unknown>
  need(Object.keys(p).sort().join('|') === 'shapes|spec|strings|value' &&
    (p.spec === FACT_STORAGE_SPEC || p.spec === COMPACT_FACT_STORAGE_SPEC), 'envelope version or fields')
  const compact = p.spec === COMPACT_FACT_STORAGE_SPEC
  need(Array.isArray(p.strings) && p.strings.length <= MAX_NODES, 'dictionary required')
  const strings: string[] = []; let previous = '', dictionaryChars = 0
  for (const entry of p.strings) {
    need(Array.isArray(entry) && entry.length === 2 && Number.isSafeInteger(entry[0]) && entry[0] >= 0 && entry[0] <= previous.length && typeof entry[1] === 'string', 'dictionary prefix')
    previous = previous.slice(0, entry[0]) + entry[1]
    dictionaryChars += previous.length; need(dictionaryChars <= MAX_CHARS, 'dictionary text limit')
    strings.push(previous)
  }
  const stringAt = (id: unknown): string => {
    need(typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 && id < strings.length, 'string reference')
    return strings[id]
  }
  need(Array.isArray(p.shapes) && p.shapes.length <= MAX_NODES, 'object shapes required')
  let shapeKeys = 0
  const shapes = p.shapes.map(shape => {
    need(Array.isArray(shape), 'object shape')
    shapeKeys += shape.length; need(shapeKeys <= MAX_NODES, 'object shape limit')
    const keys = shape.map(stringAt)
    need(new Set(keys).size === keys.length, 'duplicate object key')
    return keys
  })
  const check = budget()
  function decode(v: unknown, depth: number): unknown {
    check(depth)
    if (compact && typeof v === 'number' && v < 0) {
      const text = stringAt(-v - 1); check(depth, text); return text
    }
    if (!Array.isArray(v)) {
      need(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)), 'encoded JSON value')
      return v
    }
    if (!compact && v[0] === -1) { need(v.length === 2, 'string node'); const text = stringAt(v[1]); check(depth, text); return text }
    if (compact && v[0] === -4) {
      need(v.length === 2 && typeof v[1] === 'number' && Number.isFinite(v[1]) && v[1] < 0, 'negative number node')
      return v[1]
    }
    if (v[0] === -2) return v.slice(1).map(x => decode(x, depth + 1))
    need(v[0] === -3 && Number.isSafeInteger(v[1]) && v[1] >= 0 && v[1] < shapes.length, 'object node')
    const keys = shapes[v[1]]
    need(v.length === keys.length + 2, 'object arity')
    // fromEntries defines own properties, including __proto__, without invoking
    // inherited setters. The normal dossier validator still checks every key.
    return Object.fromEntries(keys.map((key, i) => { check(depth, key); return [key, decode(v[i + 2], depth + 1)] }))
  }
  return decode(p.value, 0)
}
