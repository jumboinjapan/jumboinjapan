import assert from 'node:assert/strict'
import {packFactStorage,unpackFactStorage,FACT_STORAGE_SPEC} from '../src/lib/poi-facts-storage.ts'
import {storePoiFacts,readPoiFacts,FACTS_START,FACTS_END} from '../src/lib/poi-facts.ts'
import {factsFixture} from './fixtures/japan-guide-facts.mjs'
let count=0
const test=(name,fn)=>{try{fn();console.log('✓ '+name);count++}catch(e){throw new Error(name+': '+e.message,{cause:e})}}
const wire=v=>JSON.parse(JSON.stringify(v))
const small=factsFixture().dossier
const large=factsFixture('japan-guide:e70001',Array.from({length:300},(_,i)=>`<p>Additional synthetic source block ${i}: the long locator and repeated structural fields must be retained in full.</p>`).join('')).dossier
test('DICTIONARY_ROUNDTRIP_TYPES_AND_UNICODE',()=>{const value=JSON.parse('{"__proto__":{"polluted":true},"a":[null,true,false,0,-1,3.5,"😀😃日本語ё\\n",[],{}],"b":"a/b"}');assert.deepEqual(unpackFactStorage(wire(packFactStorage(value))),value);assert.equal({}.polluted,undefined)})
test('DETERMINISTIC_LOSSLESS_DOSSIER',()=>{const p=packFactStorage(large);assert.deepEqual(packFactStorage(large),p);assert.deepEqual(unpackFactStorage(wire(p)),large);assert(JSON.stringify(p).length<JSON.stringify(large).length)})
test('SMALL_AND_LEGACY_NOTES_STAY_READABLE',()=>{const notes=storePoiFacts('Owner notes',small);assert(!notes.includes(FACT_STORAGE_SPEC));assert.deepEqual(readPoiFacts(notes).dossier,small)})
test('LARGE_DOSSIER_COMMON_STORAGE_ROUNDTRIP',()=>{assert(JSON.stringify(large).length>90000);const notes=storePoiFacts('Owner notes',large);assert(notes.includes(FACT_STORAGE_SPEC));assert(notes.length<=90000);assert.deepEqual(readPoiFacts(notes).dossier,large);assert.equal(storePoiFacts(notes,large),notes);const replaced=storePoiFacts(notes,small);assert(replaced.startsWith('Owner notes'));assert.deepEqual(readPoiFacts(replaced).dossier,small)})
test('READ_VALIDATES_DECODED_DOSSIER',()=>{const invalid=structuredClone(small);invalid.copy.ru[0].factIds=['not-a-fact'];const notes=FACTS_START+JSON.stringify(packFactStorage(invalid))+FACTS_END;assert.match(readPoiFacts(notes).error,/unknown\/missing fact reference/)})
test('CORRUPT_PACKED_NOTES_CANNOT_BE_OVERWRITTEN',()=>{const p=packFactStorage(small);p.value=[-1,999999];const notes=FACTS_START+JSON.stringify(p)+FACTS_END;assert.match(readPoiFacts(notes).error,/string reference/);assert.throws(()=>storePoiFacts(notes,small),/cannot replace corrupt/)})
test('NOTES_TRANSPORT_LIMIT_REMAINS',()=>assert.throws(()=>storePoiFacts('x'.repeat(90001),small),/storage capacity exceeded/))
test('ALL_STRINGS_AND_LOCATORS_SURVIVE',()=>{for(let i=0;i<50;i++){const value={['field'+i]:Array.from({length:20},(_,j)=>({locator:`main > section:nth-child(${i}) > p:nth-child(${j})`,text:`日本語😀😃ё\n${i}-${j}`,n:j,empty:''}))};assert.deepEqual(unpackFactStorage(wire(packFactStorage(value))),value)}})
for(const[name,mutate,pattern]of[
 ['REJECT_UNKNOWN_ENVELOPE',p=>p.spec='poi-facts-storage/v99',/envelope version/],
 ['REJECT_PREFIX_PAST_PREVIOUS_STRING',p=>p.strings[0][0]=1,/dictionary prefix/],
 ['REJECT_STRING_REFERENCE',p=>p.value=[-1,-1],/string reference/],
 ['REJECT_UNKNOWN_NODE',p=>p.value=[-4],/object node/],
 ['REJECT_OBJECT_ARITY',p=>p.value.pop(),/object arity/],
 ['REJECT_DUPLICATE_OBJECT_KEYS',p=>p.shapes[0][1]=p.shapes[0][0],/duplicate object key/],
 ['REJECT_EXTRA_ENVELOPE_FIELD',p=>p.secret='hidden',/envelope version/],
])test(name,()=>{const p=wire(packFactStorage(small));mutate(p);assert.throws(()=>unpackFactStorage(p),pattern)})
test('EXPANSION_LIMIT_BEFORE_RENDER',()=>{const p={spec:FACT_STORAGE_SPEC,strings:[[0,'x'.repeat(1000)]],shapes:[],value:[-2,...Array.from({length:2500},()=>[-1,0])]};assert.throws(()=>unpackFactStorage(p),/expanded text limit/)})
test('DEPTH_LIMIT_BEFORE_RENDER',()=>{const p=packFactStorage(small);p.value=0;for(let i=0;i<100;i++)p.value=[-2,p.value];assert.throws(()=>unpackFactStorage(p),/structure limit/)})
test('CYCLIC_INPUT_FAILS_WITH_BOUND',()=>{const a={};a.self=a;assert.throws(()=>packFactStorage(a),/structure limit/)})
console.log(`${count} storage checks passed`)
