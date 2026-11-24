"""Additional projects: allowlisted public unit fields only, no customer data."""
import json
from pathlib import Path

SCRAPE = r"""async ({project, seed, sector}) => {
  const rows = new Map();
  let matched=0,withdrawn=0;
  for (let r=1;r<=3;r++) {
    const response = await fetch(`${seed}?fname=&fstatus=1&fcurator=0&fetaj=0&froom=${r}&blokradio=1${project==='41'&&sector?'&fsectors='+sector:''}`);
    if (!response.ok) throw Error('Project fetch failed');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.querySelector('input[name="password"]')) throw Error('Login expired');
    const text=doc.body.textContent.replace(/\s+/g,' ');
    const matches=[...text.matchAll(/([\d/\\-]+)-б,\s*(\d+)-под,\s*(-?\d+)-этаж,\s*(\d+)-кв,\s*\(?\s*([\d.]+)\s*м(?:2|²)\)?/g)];
    matched+=matches.length;
    for (let i=0;i<matches.length;i++) {
      const m=matches[i];
      if (!m || +m[3]<=0) continue;
      const status=text.slice(m.index+m[0].length,Math.min(matches[i+1]?.index||text.length,m.index+m[0].length+300));
      if (/Квартира снята с продажи|Квартира продана|Забронировано/i.test(status)) {withdrawn++;continue;}
      const b=m[1].replace('\\','/');
      const a={project,sector,b,p:+m[2],f:+m[3],n:+m[4],a:+m[5],r};
      if (!(a.a>0)) throw Error('Invalid area');
      a.id=[project,sector||0,b.replace('/','_'),a.p,a.f,a.n].join('-');
      rows.set(a.id,a);
    }
  }
  return {rows:[...rows.values()],matched,withdrawn};
}"""

def export_projects(page, root, updated):
    root=Path(root)
    terms=json.loads((root/'export/project-terms.json').read_text(encoding='utf-8'))
    all_rows=[]
    verified_empty=set()
    for project in terms['projects']:
        sectors=[1,2,3,4] if project=='41' else [None]
        for sector in sectors:
            url=f'https://dbbase.kutstroy.kg/object/{project}'
            if sector:
                url+='?kvartal=1'
            page.goto(url,wait_until='networkidle',timeout=60000)
            if '/login' in page.url:
                raise RuntimeError('Project login expired')
            links=page.locator(f'a[href*="/object/{project}/"]').evaluate_all("els => els.map(e=>({href:e.getAttribute('href'),text:e.textContent.trim()}))")
            blocks={x['text']:x['href'] for x in links if x['text'].replace('/','').isdigit()}
            if not blocks:
                raise RuntimeError(f'No residential blocks for project {project}, sector {sector}')
            # Search each sector from its block page. Restrict results to its visible blocks.
            seed=next(iter(blocks.values())).split('?')[0]
            page.goto('https://dbbase.kutstroy.kg'+seed if seed.startswith('/') else seed,wait_until='networkidle',timeout=60000)
            if project=='41' and sector==1:
                unfiltered=page.evaluate(SCRAPE,dict(project=project,seed=seed,sector=None))
                print(f'::notice::Altai all sectors: matched={unfiltered["matched"]}, withdrawn={unfiltered["withdrawn"]}, without_mark={len(unfiltered["rows"])}',flush=True)
            result=page.evaluate(SCRAPE,dict(project=project,seed=seed,sector=sector))
            rows=result['rows']
            retained=rows if project=='41' else [a for a in rows if a['b'] in blocks]
            print(f'::notice::Project {project}, sector {sector}: matched={result["matched"]}, withdrawn={result["withdrawn"]}, retained={len(retained)}',flush=True)
            if result['matched'] and not rows and result['withdrawn']:
                verified_empty.add(project)
            all_rows.extend(retained)
    output=root/'site/data/projects.json'
    previous=json.loads(output.read_text(encoding='utf-8')) if output.exists() else {}
    for project in terms['projects']:
        before=sum(a['project']==project for a in previous.get('apartments',[]))
        after=sum(a['project']==project for a in all_rows)
        if (after==0 and project not in verified_empty) or (before and after<before*.5):
            raise RuntimeError(f'Suspicious project export {project}: {after}, was {before}; previous data preserved')
    output.write_text(json.dumps(dict(updated=updated,usdRate=terms['usdRate'],projects=terms['projects'],apartments=all_rows),ensure_ascii=False,separators=(',',':')),encoding='utf-8')
