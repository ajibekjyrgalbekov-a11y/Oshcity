(async function(){
  'use strict';
  const $=id=>document.getElementById(id),fmt=n=>Math.round(n).toLocaleString('ru-RU');
  let data,visible=[],limit=24;
  const ids=['project','sector','block','rooms','year','mode','down','budget','sort'];
  function render(){
    const v=Object.fromEntries(ids.map(id=>[id,$(id).value]));
    visible=data.apartments.filter(a=>(!v.project||a.project===v.project)&&(!v.sector||+a.sector===+v.sector)&&(!v.block||a.b===v.block.trim())&&(!v.rooms||a.r===+v.rooms)).map(a=>({a,t:data.projects[a.project],q:ProjectCalc.quote(a,data.projects[a.project],v.down,v.mode)})).filter(x=>(!v.year||(x.q?.year||x.t.sectors?.[x.a.sector]?.handoverYear||x.t.handoverYear)===+v.year)&&(!v.budget||x.q&&!x.q.cash&&x.q.monthly<=+v.budget)&&(v.mode!=='installment'||!x.q?.cash)&&(v.mode!=='cash'||x.q?.cash));
    const key=x=>!x.q?Infinity:v.sort==='price'?x.q.total:v.sort==='area'?x.a.a:v.sort==='year'?x.q.year:x.q.cash?1e12+x.q.total:x.q.monthly;
    visible.sort((a,b)=>key(a)-key(b));
    $('status').textContent=visible.length?'Доступные варианты по выбранным условиям':'По выбранным условиям вариантов нет. Попробуйте изменить фильтры.';
    $('results').replaceChildren();
    visible.slice(0,limit).forEach(({a,t,q})=>{
      const card=document.createElement('article');card.className='flat';
      const where=`${t.name}${a.sector?' · сектор '+a.sector:''} · блок ${a.b}`;
      const detail=`Подъезд ${a.p} · этаж ${a.f} · кв. ${a.n}`;
      const year=q?.year||t.sectors?.[a.sector]?.handoverYear||t.handoverYear;
      card.innerHTML='<div class="tag"></div><h2></h2><p class="muted"></p><div class="price"></div><dl></dl><div class="actions"><a target="_blank" rel="noopener">WhatsApp</a><button type="button">Копировать</button></div>';
      card.querySelector('.tag').textContent=where;card.querySelector('h2').textContent=`${a.r}-комнатная · ${a.a} м²`;card.querySelector('.muted').textContent=detail;
      card.querySelector('.price').textContent=!q?'Условия уточняются':q.cash?`${fmt(q.total)} сом`:`${fmt(q.monthly)} сом/мес`;
      const pairs=q?[['Цена за м²',fmt(q.ppm)+' сом'],['Стоимость',fmt(q.total)+' сом'],['Первый взнос',fmt(q.down)+' сом'],['Оплата',q.cash?'Наличные':q.months+' месяцев'],['Сдача',year+' год']]:[['Сдача',year+' год']];
      for(const [label,value] of pairs){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;card.querySelector('dl').append(dt,dd);}
      const link=new URL('catalog.html',location.href);link.searchParams.set('flat',a.id);
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
      const strong=document.createElement('strong');strong.textContent=t.name;const span=document.createElement('span');span.textContent=t.sectors?'Сдача 2028 / 2030 · рассрочка 60 мес.':`Сдача ${t.handoverYear} · рассрочка ${t.months} мес.`;b.append(strong,span);b.onclick=()=>{$('project').value=id;limit=24;render();$('filters').scrollIntoView({behavior:'smooth',block:'start'});};$('projects').append(b);
    }
    const flat=new URLSearchParams(location.search).get('flat');
    if(flat){const a=data.apartments.find(a=>a.id===flat);if(a){$('project').value=a.project;$('block').value=a.b;$('rooms').value=a.r;$('mode').value='any';}else $('updated').textContent='Квартира из ссылки больше не доступна. Выберите другой вариант. ';}
    $('updated').textContent+=`Обновлено: ${data.updated} · время Кыргызстана. Курс: 88 сом за доллар.`;
    $('filters').oninput=()=>{limit=24;render();};$('filters').onchange=()=>{limit=24;render();};$('filters').onsubmit=e=>e.preventDefault();$('filters').onreset=()=>setTimeout(()=>{limit=24;render();},0);$('more').onclick=()=>{limit+=24;render();};render();
  }catch{$('status').textContent='Не удалось загрузить квартиры Бишкека. Обновите страницу позже или свяжитесь с Ажибеком: +996 508 890 202.';}
})();
