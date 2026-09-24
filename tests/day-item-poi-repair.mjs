import assert from 'node:assert/strict'
import { repairDayItemPois } from '../src/lib/day-item-poi-repair.ts'
const id=n=>'rec'+String(n).padStart(14,'0')
const before={ 'Day Item ID':'a', 'Route Slug':'multi-day/test', 'Item Type':'poi', 'Internal Notes':'keep this note', 'Display Title':'Place' }
const row=n=>({id:id(n),before:{...before,'Day Item ID':String(n)},fields:{'POI ID':'POI-000001'}})
function fixture(rows){let db=new Map(rows.map(r=>[r.id,structuredClone(r.before)])),writes=[];return {db,writes,store:{read:async id=>({id,fields:structuredClone(db.get(id))}),patch:async(id,fields)=>{writes.push(id);db.set(id,{...db.get(id),...fields})},preflight:async()=>{}}}}
let rows=[row(1),row(2)],f=fixture(rows);await repairDayItemPois(rows,f.store);assert.equal(f.writes.length,2);assert.deepEqual(f.db.get(id(1)),{...rows[0].before,...rows[0].fields})
for(const corrupt of [r=>r[1].before['Display Title']='drift',r=>r[1].fields={'POI ID':''},r=>r[1].fields={'Route Slug':'other'},r=>r[1].id=r[0].id]){rows=[row(1),row(2)];f=fixture(rows);corrupt(rows);await assert.rejects(()=>repairDayItemPois(rows,f.store));assert.equal(f.writes.length,0)}
rows=[row(1),row(2)];f=fixture(rows);f.store.preflight=async()=>{throw Error('unready POI')};await assert.rejects(()=>repairDayItemPois(rows,f.store));assert.equal(f.writes.length,0)
f=fixture(rows);f.store.patch=async()=>{throw Error('unknown write outcome')};await assert.rejects(()=>repairDayItemPois(rows,f.store));assert.equal(f.writes.length,0)
f=fixture(rows);let calls=0;const read=f.store.read;f.store.read=async id=>{const r=await read(id);if(++calls===3)r.fields['Internal Notes']='concurrent edit';return r};await assert.rejects(()=>repairDayItemPois(rows,f.store));assert.equal(f.writes.length,0)
f=fixture(rows);f.store.patch=async id=>{f.writes.push(id)};await assert.rejects(()=>repairDayItemPois(rows,f.store),/verification/);assert.deepEqual(f.writes,[id(1)])
rows=[{...row(1),fields:{'Item Type':'note'}}];f=fixture(rows);await repairDayItemPois(rows,f.store);assert.equal(f.db.get(id(1))['Item Type'],'note')
rows[0].before['POI ID']='POI-000001';f=fixture(rows);await assert.rejects(()=>repairDayItemPois(rows,f.store));assert.equal(f.writes.length,0)
console.log('Day item repair: preservation, admission, drift, partial failure, service classification passed')

rows=[row(1),row(2),row(3)];f=fixture(rows);const patch=f.store.patch;f.store.patch=async (id,fields)=>{await patch(id,fields);if(id===rows[1].id)throw Error('socket closed after effect')};
await assert.rejects(()=>repairDayItemPois(rows,f.store),e=>{assert.deepEqual(e.applied,[id(1)]);assert.equal(e.uncertainId,id(2));assert.equal(e.phase,'patch');assert.equal(e.recoveryRequired,true);return true});
assert.deepEqual(f.writes,[id(1),id(2)]);assert.equal(f.db.get(id(2))['POI ID'],'POI-000001');
console.log('Partial effect retains confirmed prefix and uncertain identity; suffix untouched')
