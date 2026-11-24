(async function(){
  'use strict';
  const $=id=>document.getElementById(id),fmt=n=>Math.round(n).toLocaleString('ru-RU');
  let data,visible=[],limit=24,selectedFlat=new URLSearchParams(location.search).get('flat');
  const ids=['project','sector','block','rooms','year','mode','down','budget','sort'];
  function openProject(id){
    $('filters').reset();$('project').value=id;selectedFlat=null;limit=24;render();
    $('projectTitle').focus();
  }
  function render(){
    const v=Object.fromEntries(ids.map(id=>[id,$(id).value]));
    const chosen=!!data.projects[v.project];
    document.querySelector('.intro').hidden=chosen;
    $('selection').hidden=!chosen;$('projects').hidden=chosen;$('chooserStatus').hidden=true;
    if(!chosen){$('results').replaceChildren();$('more').hidden=true;return;}
    $('projectTitle').textContent=data.projects[v.project].name;
    $('sector').closest('label').hidden=!data.projects[v.project].sectors;
    visible=data.apartments.filter(a=>(!v.project||a.project===v.project)&&(!v.sector||+a.sector===+v.sector)&&(!v.block||a.b===v.block.trim())&&(!v.rooms||a.r===+v.rooms)).map(a=>({a,t:data.projects[a.project],q:ProjectCalc.quote(a,data.projects[a.project],v.down,v.mode)})).filter(x=>(!v.year||(x.q?.year||x.t.sectors?.[x.a.sector]?.handoverYear||x.t.handoverYear)===+v.year)&&(!v.budget||x.q&&!x.q.cash&&x.q.monthly<=+v.budget)&&(v.mode!=='installment'||!x.q?.cash)&&(v.mode!=='cash'||x.q?.cash));
    const key=x=>v.sort==='floor'?x.a.f:v.sort==='floorDesc'?-x.a.f:v.sort==='area'?x.a.a:!x.q?Infinity:v.sort==='price'?x.q.total:v.sort==='year'?x.q.year:x.q.cash?1e12+x.q.total:x.q.monthly;
    visible.sort((a,b)=>(b.a.id===selectedFlat)-(a.a.id===selectedFlat)||key(a)-key(b)||a.a.f-b.a.f||a.a.p-b.a.p||a.a.n-b.a.n);
    $('status').textContent=visible.length?'Доступные варианты по выбранным условиям':'По выбранным условиям вариантов нет. Попробуйте изменить фильтры.';
    if(v.project&&!data.apartments.some(a=>a.project===v.project))$('status').textContent='В базе пока нет подтверждённых свободных 1–2–3-комнатных квартир этого комплекса. Снятые с продажи варианты не показываются.';
    $('results').replaceChildren();
    visible.slice(0,limit).forEach(({a,t,q})=>{
      const card=document.createElement('article');card.className='flat';if(a.id===selectedFlat)card.style.outline='3px solid #358264';
      const where=`${t.name}${a.sector?' · сектор '+a.sector:''} · блок ${a.b}`;
      const detail=`Подъезд ${a.p} · этаж ${a.f} · кв. ${a.n}`;
      const year=q?.year||t.sectors?.[a.sector]?.handoverYear||t.handoverYear;
      card.innerHTML='<div class="tag"></div><h2></h2><p class="muted"></p><div class="price"></div><dl></dl><div class="actions"><a target="_blank" rel="noopener">WhatsApp</a><button type="button">Копировать</button></div>';
      card.querySelector('.tag').textContent=where;card.querySelector('h2').textContent=`${a.r}-комнатная · ${a.a} м²`;card.querySelector('.muted').textContent=detail;
      card.querySelector('.price').textContent=!q?'Условия уточняются':q.cash?`${fmt(q.total)} сом`:`${fmt(q.monthly)} сом/мес`;
      const pairs=q?[['Цена за м²',fmt(q.ppm)+' сом'],['Стоимость',fmt(q.total)+' сом'],['Первый взнос',fmt(q.down)+' сом'],['Оплата',q.cash?'Наличные':q.months+' месяцев'],['Сдача',year+' год']]:[['Сдача',year+' год']];
      for(const [label,value] of pairs){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;card.querySelector('dl').append(dt,dd);}
      const link=new URL('catalog.html',location.href);link.searchParams.set('flat',a.id);
      if(q){link.searchParams.set('down',q.down);link.searchParams.set('mode',q.cash?'cash':'installment');}
      const text=`${where}\n${a.r}-комнатная, ${a.a} м²\n${detail}\nСдача: ${year} г.\n`+(q?`Цена: ${fmt(q.total)} сом. ${q.cash?'Наличные':`Взнос: ${fmt(q.down)} сом. Рассрочка ${q.months} мес., ${fmt(q.monthly)} сом/мес., последний платёж ${fmt(q.last)} сом.`}`:'Условия оплаты уточняются у Ажибека.')+`\n${link}`;
      card.querySelector('a').href='https://wa.me/?text='+encodeURIComponent(text);
      card.querySelector('button').onclick=async e=>{try{await navigator.clipboard.writeText(text);e.target.textContent='Скопировано';}catch{e.target.textContent='Откройте WhatsApp';}};
      $('results').append(card);
    });
    $('more').hidden=visible.length<=limit;
  }
  try{
    const response=await fetch('data/projects.json',{cache:'no-store'});if(!response.ok)throw Error();data=await response.json();
    for(const [id,t]of Object.entries(data.projects)){
      const option=document.createElement('option');option.value=id;option.textContent=t.name;$('project').append(option);
      const b=document.createElement('button');b.type='button';b.className='project';
      const strong=document.createElement('strong');strong.textContent=t.name;const span=document.createElement('span');span.textContent=!data.apartments.some(a=>a.project===id)?'Свободные квартиры пока не подтверждены':t.sectors?'Сдача 2028 / 2030 · рассрочка 60 мес.':`Сдача ${t.handoverYear} · рассрочка ${t.months} мес.`;b.append(strong,span);b.onclick=()=>openProject(id);$('projects').append(b);
    }
    const flat=new URLSearchParams(location.search).get('flat');
    if(flat){const a=data.apartments.find(a=>a.id===flat);if(a){$('project').value=a.project;$('block').value=a.b;$('rooms').value=a.r;const params=new URLSearchParams(location.search);$('mode').value=['cash','installment'].includes(params.get('mode'))?params.get('mode'):'any';$('down').value=Math.max(0,Number(params.get('down'))||0)||'';}else $('updated').textContent='Квартира из ссылки больше не доступна. Выберите другой вариант. ';}
    $('updated').textContent+=`Обновлено: ${data.updated} · время Кыргызстана. Курс: 88 сом за доллар.`;
    $('filters').oninput=()=>{selectedFlat=null;limit=24;render();};$('filters').onchange=()=>{selectedFlat=null;limit=24;render();};$('filters').onsubmit=e=>e.preventDefault();
    $('filters').onreset=e=>{e.preventDefault();for(const id of ids.filter(id=>id!=='project')){const el=$(id);el.value=id==='mode'?'installment':id==='sort'?'price':'';}selectedFlat=null;limit=24;render();};
    $('changeProject').onclick=()=>{$('filters').reset();$('project').value='';selectedFlat=null;render();$('projects').querySelector('button')?.focus();};
    $('more').onclick=()=>{limit+=24;render();};render();
  }catch{$('chooserStatus').hidden=false;$('chooserStatus').textContent='Не удалось загрузить квартиры Бишкека. Обновите страницу позже или свяжитесь с Ажибеком: +996 508 890 202.';}
})();
