"""Check source formats and withdrawn status using synthetic, non-personal fixtures."""
import importlib.util
import json
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('projects',root/'export/projects.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixture=''.join([
    '1-б, 1-под, 5-этаж, 1-кв, (40.19 м2)',
    '2-б, 1-под, 5-этаж, 2-кв, 56.29 м²',
    '3-б, 1-под, 5-этаж, 3-кв, 56.29 м²',
    'Квартира снята с продажи',
    '4-б, 1-под, -1-этаж, 1-кв, 20 м²',
])
script='''global.DOMParser=class {parseFromString(s){return {body:{textContent:s},querySelector(){return null}}}};
global.fetch=async url=>{if(!url.includes('fsectors=1'))throw Error('Missing authoritative sector filter');return {ok:true,text:async()=>url.includes('froom=1')?FIXTURE:''}};
const fn=SCRAPER;
fn({project:'41',seed:'/object/41/1',sector:1}).then(rows=>process.stdout.write(JSON.stringify(rows)));
'''.replace('FIXTURE',json.dumps(fixture)).replace('SCRAPER',module.SCRAPE)
result=subprocess.run(['node','-e',script],capture_output=True,text=True,check=True,encoding='utf-8')
parsed=json.loads(result.stdout)
rows=parsed['rows']
assert parsed['withdrawn']==1
assert [a['b'] for a in rows]==['1','2'], rows
assert all(set(a)=={'project','sector','b','p','f','n','a','r','id'} for a in rows)
print('Project exporter formats and withdrawn filtering passed')
