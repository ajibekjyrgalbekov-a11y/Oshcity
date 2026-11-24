const assert=require('node:assert/strict');
const {quote}=require('../site/js/project-calc.js');
const {projects}=require('../export/project-terms.json');
const a={b:'1',f:3,r:2,a:54.23,sector:1};
for(const id of ['42','34','24']){
 const q=quote(a,projects[id]);
 assert.ok(q&&q.months===59);
 assert.equal(q.down+q.monthly*(q.months-1)+q.last,q.total);
 assert.equal(quote(a,projects[id],1).down,q.minDown);
 assert.equal(quote(a,projects[id],1e9).down,q.total);
}
assert.equal(quote(a,projects['42']).ppm,96800);
assert.equal(quote({...a,b:'4'},projects['42']).ppm,92400);
assert.equal(quote(a,projects['41'],0,'cash').ppm,71200);
assert.equal(quote(a,projects['41']).months,60);
assert.equal(quote({...a,r:1,f:1},projects['41']),null);
assert.equal(quote({...a,sector:3},projects['41']).minDown,500000);
assert.equal(quote({...a,sector:3},projects['41']).year,2030);
console.log('Project calculations passed');
