(async function(){
  'use strict';
  const $=id=>document.getElementById(id),fmt=n=>Number(n).toLocaleString('ru-RU');
  let data,project='',limit=24,pinned=new URLSearchParams(location.search).get('flat');
  function render(){
    $('intro').hidden=!!project;$('projects').hidden=!!project;$('selection').hidden=!project;
    if(!project)return;
    $('title').textContent=project;
    const room=Number($('rooms').value),sort=$('sort').value;
    const key=a=>sort==='floor'?(a.f??Infinity):sort==='floorDesc'?(a.f==null?Infinity:-a.f):sort==='area'?-a.a:a.usd;
    const list=data.apartments.filter(a=>a.project===project&&(!room||a.r===room)).sort((a,b)=>(b.id===pinned)-(a.id===pinned)||key(a)-key(b)||a.usd-b.usd);
    $('status').textContent=list.length?'Предложения выбранного комплекса':'Нет предложений с таким количеством комнат.';
    $('checked').textContent='Сверено с таблицей Кут Инвест: '+data.checked.split('-').reverse().join('.')+'. Наличие уточняется перед предложением клиенту.';
    $('results').replaceChildren();
    for(const a of list.slice(0,limit)){
      const card=document.createElement('article');card.className='flat';if(a.id===pinned)card.style.outline='3px solid #358264';
      const details=[a.sector&&`Сектор ${a.sector}`,a.b&&`Блок ${a.b}`,a.p&&`Подъезд ${a.p}`,a.f&&`Этаж ${a.f}`,a.n&&`Кв. ${a.n}`].filter(Boolean).join(' · ');
      card.innerHTML='<div class="tag"></div><h2></h2><p class="muted"></p><div class="price"></div><p class="muted som"></p><dl></dl><p class="note">Рассрочка — по согласованию</p><div class="actions"><a target="_blank" rel="noopener">Уточнить наличие</a><button type="button">Копировать</button></div>';
      card.querySelector('.tag').textContent=a.project+' · перепродажа';card.querySelector('h2').textContent=`${a.r}-комнатная · ${fmt(a.a)} м²`;card.querySelector('.muted').textContent=details;
      card.querySelector('.price').textContent='$'+fmt(a.usd);card.querySelector('.som').textContent=fmt(a.usd*data.usdRate)+' сом · полная стоимость';
      if(a.finish){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent='Состояние';dd.textContent=a.finish;card.querySelector('dl').append(dt,dd);}
      const link=new URL('resale.html',location.href);link.searchParams.set('flat',a.id);
      const description=`Кут Инвест · перепродажа\n${a.project}\n${a.r}-комнатная, ${a.a} м²\n${details}\nЦена: $${fmt(a.usd)} (${fmt(a.usd*data.usdRate)} сом по курсу 88).\nНаличие и условия оплаты уточняются у Ажибека.\n${link}`;
      card.querySelector('a').href='https://wa.me/996508890202?text='+encodeURIComponent('Здравствуйте, Ажибек! Интересует квартира:\n'+description);
      card.querySelector('button').onclick=async e=>{try{await navigator.clipboard.writeText(description);e.target.textContent='Скопировано';}catch{e.target.textContent='Не удалось скопировать';}};
      $('results').append(card);
    }
    $('more').hidden=list.length<=limit;
  }
  try{
    const res=await fetch('data/resale.json',{cache:'no-store'});if(!res.ok)throw Error();data=await res.json();
    for(const name of [...new Set(data.apartments.map(a=>a.project))]){
      const b=document.createElement('button');b.type='button';b.className='project';const strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=name;span.textContent='Посмотреть предложения';b.append(strong,span);b.onclick=()=>{project=name;pinned=null;limit=24;$('filters').reset();render();$('title').focus();};$('projects').append(b);
    }
    const selected=data.apartments.find(a=>a.id===pinned);if(selected)project=selected.project;
    else if(pinned){$('loading').textContent='Предложение из ссылки больше не доступно. Выберите другой вариант.';}
    $('loading').hidden=!pinned||!!selected;
    $('filters').onsubmit=e=>e.preventDefault();$('filters').onchange=()=>{pinned=null;limit=24;render();};$('filters').onreset=()=>setTimeout(()=>{pinned=null;limit=24;render();},0);
    $('back').onclick=()=>{project='';pinned=null;render();$('projects').querySelector('button')?.focus();};$('more').onclick=()=>{limit+=24;render();};render();
  }catch{$('loading').hidden=false;$('loading').textContent='Не удалось загрузить предложения. Свяжитесь с Ажибеком: +996 508 890 202.';}
})();
