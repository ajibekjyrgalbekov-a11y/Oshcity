const assert=require('node:assert/strict');
const data=require('../site/data/resale.json');
const byId=new Map(data.apartments.map(a=>[a.id,a]));
assert.equal(byId.size,data.apartments.length,'Source row IDs must stay unique');
for(const a of data.apartments){
  assert.ok(a.a>=15&&a.usd>0&&a.usd/a.a<5000);
  assert.ok([1,2,3].includes(a.r));
  assert.ok(a.f===null||Number.isInteger(a.f)&&a.f>0);
  assert.ok(!/Умут.?2|Үмүт.?2|Урпак/i.test(a.project));
  assert.deepEqual(Object.keys(a).sort(),['id','sourceRow','project','b','p','f','n','a','r','usd','sector','finish'].sort());
}
for(const row of [8,21,30,32,36,40,41,42,44,46,47,52,100,123,126,129,139,140,45,197])assert.ok(!byId.has('ki-'+row),'Reserved or malformed source row '+row);
assert.equal(byId.get('ki-69').a,64.4);
assert.equal(byId.get('ki-69').b,16);
assert.equal(byId.get('ki-24').usd,44500);
assert.equal(byId.get('ki-102').f,null,'Missing floor must not inherit apartment number');
assert.equal(byId.get('ki-91').a,68.35);
assert.equal(data.usdRate,88);
const tunduk=data.apartments.filter(a=>a.project==='Тундук-1');
assert.equal(tunduk.length,31);
assert.equal(byId.get('ki-146').usd,71500);
assert.equal(byId.get('ki-177').usd,83076);
for(const row of [150,162,163,164,167,168,178,183,184])assert.ok(!byId.has('ki-'+row));
console.log('Resale data checks passed:',data.apartments.length);
