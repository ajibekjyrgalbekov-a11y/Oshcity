(function(root){
  'use strict';
  function options(a,t){
    if(t.prices) return t.prices.filter(p=>(!p.blocks||p.blocks.includes(+a.b))&&(!p.sectors||p.sectors.includes(+a.sector))&&(!p.rooms||p.rooms.includes(a.r))&&(!p.minFloor||a.f>=p.minFloor)&&(!p.maxFloor||a.f<=p.maxFloor)).map(p=>Object.assign({},t,p));
    return [t];
  }
  function quote(a,t,down,mode){
    const choices=options(a,t);
    const rule=choices.find(p=>mode==='cash'?p.payment==='cash':p.payment!=='cash')||choices.find(p=>p.payment==='cash');
    if(!rule) return null;
    const total=Math.round(Math.round(a.a*100)*rule.somPerM2/100);
    const cash=rule.payment==='cash';
    const minDown=cash?total:Math.min(rule.downSom,total);
    const paid=cash?total:Math.min(total,Math.max(minDown,Number(down)||0));
    const months=cash?0:rule.months;
    if(!Number.isFinite(total)||!cash&&!(months>0)) return null;
    const monthly=cash?0:Math.floor((total-paid)/months);
    return {total,down:paid,minDown,months,monthly,last:cash?0:total-paid-monthly*(months-1),cash,ppm:rule.somPerM2,year:t.sectors?t.sectors[a.sector]?.handoverYear:t.handoverYear};
  }
  const api={options,quote};
  if(typeof module!=='undefined')module.exports=api;else root.ProjectCalc=api;
})(typeof window!=='undefined'?window:globalThis);
