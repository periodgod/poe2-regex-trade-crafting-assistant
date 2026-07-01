"use strict";

window.__POE2_ARBITRAGE_CONTROLLER_VERSION__="1.7.7";
window.__POE2_ARBITRAGE_CONTROLLER_LOADED_AT__=new Date().toISOString();

const desktopApi=window.desktopApi||null;
let desktopSaveTimer=null;
let persistenceHydrated=false;
let actionButtonsBound=false;
let appInitialized=false;
let liveCalculationTimer=null;
let actionStatusTimer=null;
let bootDiagnostics=null;

function showPageError(context,error){
  const message=String(error?.message||error||"未知错误");
  const banner=document.getElementById("pageErrorBanner");
  if(banner){
    banner.hidden=false;
    banner.textContent=`${context}：${message}`;
  }
  console.error(context,error);
}

function clearPageError(){
  const banner=document.getElementById("pageErrorBanner");
  if(banner){
    banner.hidden=true;
    banner.textContent="";
  }
}

function setRuntimeStatus(state,title,detail=""){
  if(typeof window.__setArbitrageRuntimeStatus==="function"){
    window.__setArbitrageRuntimeStatus(state,title,detail);
    return;
  }
  const box=document.getElementById("runtimeStatus");
  if(box)box.dataset.state=state;
  const titleNode=document.getElementById("runtimeStatusTitle");
  const detailNode=document.getElementById("runtimeStatusDetail");
  if(titleNode)titleNode.textContent=title;
  if(detailNode)detailNode.textContent=detail;
}

function setActionStatus(state,title,detail="",hideAfter=0){
  const box=document.getElementById("actionStatus");
  const titleNode=document.getElementById("actionStatusTitle");
  const detailNode=document.getElementById("actionStatusDetail");
  if(!box)return;
  clearTimeout(actionStatusTimer);
  box.hidden=false;
  box.dataset.state=state;
  if(titleNode)titleNode.textContent=title;
  if(detailNode)detailNode.textContent=detail;
  if(hideAfter>0){
    actionStatusTimer=setTimeout(()=>{ box.hidden=true; },hideAfter);
  }
}

function nextPaint(){
  return new Promise(resolve=>requestAnimationFrame(()=>resolve()));
}

function requiredElement(id){
  const element=document.getElementById(id);
  if(!element)throw new Error(`页面结构缺少必需元素 #${id}`);
  return element;
}

function safeStorageGet(key){
  try{
    return window.localStorage?.getItem(key)??null;
  }catch(error){
    console.warn("无法读取本地存储",key,error);
    return null;
  }
}

function safeStorageSet(key,value){
  try{
    window.localStorage?.setItem(key,value);
    return true;
  }catch(error){
    console.warn("无法写入本地存储",key,error);
    return false;
  }
}
const nodes=["d","e","c","E","C"];

const pairs=[
  ["e","c"],["e","d"],["c","d"],["e","E"],["c","E"],
  ["d","E"],["e","C"],["c","C"],["d","C"],["E","C"]
];

const defs=[];
pairs.forEach(([a,b])=>{
  defs.push([a,b,`${a}_to_${b}`]);
  defs.push([b,a,`${b}_to_${a}`]);
});

function validateRequiredDom(){
  const requiredIds=[
    "edgeGrid","capital","rankMode","topN","jsonInput",
    "fastMatrix","slowMatrix","spreadArea","rankingArea","summaryArea",
    "nextActionArea","shareJsonOutput","shareStatus",
    "runtimeStatus","actionStatus","pageErrorBanner","holding_gold"
  ];
  requiredIds.forEach(requiredElement);

  defs.forEach(([, , key])=>{
    requiredElement(`${key}_target`);
    requiredElement(`${key}_source`);
    requiredElement(`${key}_calc`);
  });

  ["c","d","e","E","C"].forEach(symbol=>{
    requiredElement(`holding_${symbol}`);
    requiredElement(`gold_per_${symbol}`);
  });

  const cards=document.querySelectorAll("#edgeGrid .edge-card");
  if(cards.length!==pairs.length){
    throw new Error(`兑换比例卡片数量错误：应为 ${pairs.length}，实际为 ${cards.length}`);
  }

  const fixedButtons=document.querySelectorAll("button[data-action]");
  if(fixedButtons.length<10){
    throw new Error(`页面固定按钮数量不足：应至少为 10，实际为 ${fixedButtons.length}`);
  }

  return {
    directionCount:defs.length,
    cardCount:cards.length,
    staticButtonCount:fixedButtons.length
  };
}

function positiveValue(id){
  const value=Number(requiredElement(id).value);
  return Number.isFinite(value)&&value>0?value:null;
}

function readDirection(key){
  const target=positiveValue(`${key}_target`);
  const source=positiveValue(`${key}_source`);
  if(target===null||source===null)return null;
  return {target,source,rate:target/source};
}

function blankGraph(){
  const g={};
  nodes.forEach(a=>{
    g[a]={};
    nodes.forEach(b=>g[a][b]=(a===b?1:null));
  });
  return g;
}

function buildGraphs(){
  const fast=blankGraph();

  defs.forEach(([a,b,key])=>{
    const item=readDirection(key);
    fast[a][b]=item?item.rate:null;
  });

  const slow=blankGraph();
  const mixed=blankGraph();
  const mixedMode=blankGraph();

  nodes.forEach(a=>nodes.forEach(b=>{
    if(a===b){
      mixedMode[a][b]="";
      return;
    }

    const fastRate=fast[a][b];
    const reverseFast=fast[b][a];
    const slowRate=reverseFast&&reverseFast>0?1/reverseFast:null;

    slow[a][b]=slowRate;

    if(fastRate===null&&slowRate===null){
      mixed[a][b]=null;
      mixedMode[a][b]="";
    }else if(slowRate===null||(fastRate!==null&&fastRate>=slowRate)){
      mixed[a][b]=fastRate;
      mixedMode[a][b]="秒出";
    }else{
      mixed[a][b]=slowRate;
      mixedMode[a][b]="慢挂";
    }
  }));

  return {fast,slow,mixed,mixedMode};
}

function fmt(x,d=6){
  if(x===null||x===undefined)return "断路";
  if(!Number.isFinite(x))return "—";
  const ax=Math.abs(x);
  if(ax!==0&&(ax>=100000||ax<0.000001))return x.toExponential(6);
  return x.toFixed(d);
}

function fmtCompact(x){
  if(x===null||x===undefined||!Number.isFinite(x))return "—";
  return Number(x).toLocaleString("zh-CN",{maximumFractionDigits:8});
}

function fmtAmount(x){
  return Number(x).toLocaleString("zh-CN",{maximumFractionDigits:4});
}

function updateDirectionCalculators(){
  defs.forEach(([a,b,key])=>{
    const box=document.getElementById(`${key}_calc`);
    const item=readDirection(key);

    if(!item){
      box.className="calc-result invalid";
      box.innerHTML="请填写两个大于0的数量";
      return;
    }

    const per100=item.rate*100;
    box.className="calc-result";
    box.innerHTML=
      `<b>${fmtCompact(item.target)} ${b} ÷ ${fmtCompact(item.source)} ${a}</b>
       = <b>${fmt(item.rate,8)}</b><br>
       即：1 ${a} → <b>${fmtCompact(item.rate)} ${b}</b>；
       100 ${a} → <b>${fmtCompact(per100)} ${b}</b>`;
  });
}

function permutations(arr,k){
  const out=[];
  function dfs(path,used){
    if(path.length===k){
      out.push([...path]);
      return;
    }
    for(let i=0;i<arr.length;i++){
      if(used.has(i))continue;
      used.add(i);
      path.push(arr[i]);
      dfs(path,used);
      path.pop();
      used.delete(i);
    }
  }
  dfs([],new Set());
  return out;
}

function metricForPath(path,g){
  let multiplier=1;
  const rates=[];

  for(let i=0;i<path.length-1;i++){
    const rate=g[path[i]][path[i+1]];
    if(rate===null||!Number.isFinite(rate)||rate<=0)return null;
    multiplier*=rate;
    rates.push(rate);
  }

  return {
    mult:multiplier,
    rates,
    profit:(multiplier-1)*100
  };
}

function enumerateCycles(graphs){
  const others=["e","c","E","C"];
  const result=[];

  for(const innerCount of [1,2,3,4]){
    for(const perm of permutations(others,innerCount)){
      const path=["d",...perm,"d"];
      const fast=metricForPath(path,graphs.fast);
      const slow=metricForPath(path,graphs.slow);
      const mixed=metricForPath(path,graphs.mixed);
      const modes=[];

      if(mixed){
        for(let i=0;i<path.length-1;i++){
          modes.push(graphs.mixedMode[path[i]][path[i+1]]);
        }
      }

      result.push({
        path,
        length:path.length-1,
        fast,
        slow,
        mixed,
        modes
      });
    }
  }

  return result;
}

function renderMatrix(g,id){
  let html='<table><thead><tr><th>行资源 → 列资源</th>';
  nodes.forEach(n=>html+=`<th>${n}</th>`);
  html+='</tr></thead><tbody>';

  nodes.forEach(a=>{
    html+=`<tr><th>${a}</th>`;
    nodes.forEach(b=>{
      html+=`<td>${g[a][b]===null?"断路":fmt(g[a][b],8)}</td>`;
    });
    html+='</tr>';
  });

  html+='</tbody></table>';
  document.getElementById(id).innerHTML=html;
}

function pctClass(value){
  return value>1?"pos":value<-1?"neg":"neu";
}

function renderSpreads(graphs){
  const rows=[];

  pairs.forEach(([a,b])=>{
    const ab=graphs.fast[a][b];
    const ba=graphs.fast[b][a];

    if(ab===null&&ba===null)return;

    const slowAB=ba?1/ba:null;
    const slowBA=ab?1/ab:null;
    const premiumAB=(ab&&slowAB)?(slowAB/ab-1)*100:null;
    const premiumBA=(ba&&slowBA)?(slowBA/ba-1)*100:null;
    const roundTrip=(ab&&ba)?ab*ba:null;

    rows.push({
      pair:`${a} ⇄ ${b}`,
      a,b,ab,ba,slowAB,slowBA,premiumAB,premiumBA,roundTrip
    });
  });

  if(!rows.length){
    document.getElementById("spreadArea").innerHTML=
      '<div class="empty">尚未填写有效兑换比例。</div>';
    return;
  }

  let html=
    '<div class="table-wrap"><table><thead><tr>'+
    '<th>资源对</th><th>出售方向</th><th>秒出比例</th>'+
    '<th>反向盘口推算慢挂比例</th><th>慢挂相对秒出溢价</th>'+
    '<th>两边秒出一圈乘数</th><th>判断</th>'+
    '</tr></thead><tbody>';

  rows.forEach(r=>{
    const directions=[
      {
        label:`${r.a}→${r.b}`,
        fast:r.ab,
        slow:r.slowAB,
        premium:r.premiumAB
      },
      {
        label:`${r.b}→${r.a}`,
        fast:r.ba,
        slow:r.slowBA,
        premium:r.premiumBA
      }
    ];

    directions.forEach((d,index)=>{
      let judge;
      if(d.premium===null){
        judge='<span class="badge yellow">数据不完整</span>';
      }else if(d.premium>1){
        judge='<span class="badge green">慢挂收益更高</span>';
      }else if(d.premium<-1){
        judge='<span class="badge red">秒出价格更高</span>';
      }else{
        judge='<span class="badge yellow">快慢差价很小</span>';
      }

      html+='<tr>';
      if(index===0){
        html+=`<td rowspan="2"><b>${r.pair}</b></td>`;
      }
      html+=`
        <td>${d.label}</td>
        <td>${fmt(d.fast,8)}</td>
        <td>${fmt(d.slow,8)}</td>
        <td class="${d.premium===null?"neu":pctClass(d.premium)}">
          ${d.premium===null?"—":(d.premium>=0?"+":"")+fmt(d.premium,4)+"%"}
        </td>`;

      if(index===0){
        html+=`
          <td rowspan="2">${fmt(r.roundTrip,8)}</td>
          <td rowspan="2">
            ${r.roundTrip===null
              ?'<span class="badge yellow">缺少一侧价格</span>'
              :r.roundTrip>1
                ?'<span class="badge green">两步秒出存在利润</span>'
                :'<span class="badge yellow">两步秒出无利润</span>'}
          </td>`;
      }
      html+='</tr>';
    });
  });

  html+='</tbody></table></div>';
  document.getElementById("spreadArea").innerHTML=html;
}

function routeProcess(path,metric,capital){
  if(!metric)return "不可执行";

  let amount=capital;
  const parts=[`${fmtAmount(amount)} ${path[0]}`];

  for(let i=0;i<metric.rates.length;i++){
    amount*=metric.rates[i];
    parts.push(`${fmtAmount(amount)} ${path[i+1]}`);
  }

  return parts.join(" → ");
}

function selectedMetric(row,mode){
  return row[mode];
}

function modeName(mode){
  if(mode==="fast")return "全程秒出";
  if(mode==="slow")return "全程慢挂";
  return "逐步择优";
}

function advice(profit,mode){
  if(profit>1){
    return `<span class="badge ${mode==="slow"?"purple":"green"}">
      ${mode==="slow"?"🟣 慢挂有利润":"🟢 可套利"}
    </span>`;
  }
  if(profit<-1)return '<span class="badge red">🔴 亏损</span>';
  return '<span class="badge yellow">🟡 接近持平</span>';
}

function profitText(metric){
  if(!metric)return "断路";
  return `${metric.profit>=0?"+":""}${fmt(metric.profit,4)}%`;
}

function renderRanking(cycles,capital,topN,mode){
  const valid=cycles
    .filter(row=>selectedMetric(row,mode)!==null)
    .sort((a,b)=>selectedMetric(b,mode).profit-selectedMetric(a,mode).profit);

  const area=document.getElementById("rankingArea");

  if(!valid.length){
    area.innerHTML='<div class="empty">当前数据不足，所选模式没有可执行闭环。</div>';
    return;
  }

  const best=valid.slice(0,Math.min(topN,valid.length));

  let html=
    `<div class="hint">当前按 <b>${modeName(mode)}</b> 排名；
    有效路线 <b>${valid.length}</b>/64 条。</div>`;

  html+=
    '<div class="table-wrap section-gap"><table><thead><tr>'+
    '<th>排名</th><th>路径</th><th>长度</th>'+
    '<th>秒出利润率</th><th>慢挂利润率</th><th>逐步择优利润率</th>'+
    '<th>排名模式乘数</th><th>最终 d</th><th>净利润 d</th>'+
    '<th>完整兑换过程</th><th>建议</th>'+
    '</tr></thead><tbody>';

  best.forEach((row,index)=>{
    const metric=selectedMetric(row,mode);
    const finalD=capital*metric.mult;
    const net=finalD-capital;
    let modeDetail="";

    if(mode==="mixed"){
      modeDetail=` [${row.modes.join(" / ")}]`;
    }

    html+=`
      <tr>
        <td>${index+1}</td>
        <td class="path">${row.path.join("→")}</td>
        <td>${row.length}</td>
        <td class="${row.fast?pctClass(row.fast.profit):"neu"}">${profitText(row.fast)}</td>
        <td class="${row.slow?pctClass(row.slow.profit):"neu"}">${profitText(row.slow)}</td>
        <td class="${row.mixed?pctClass(row.mixed.profit):"neu"}">${profitText(row.mixed)}</td>
        <td>${fmt(metric.mult,8)}</td>
        <td>${fmtAmount(finalD)}</td>
        <td class="${net>=0?"pos":"neg"}">${net>=0?"+":""}${fmtAmount(net)}</td>
        <td>${routeProcess(row.path,metric,capital)}${modeDetail}</td>
        <td>${advice(metric.profit,mode)}</td>
      </tr>`;
  });

  html+='</tbody></table></div>';
  area.innerHTML=html;
}

function bestBy(cycles,mode){
  return cycles
    .filter(row=>row[mode])
    .sort((a,b)=>b[mode].profit-a[mode].profit)[0]||null;
}

function summaryBox(title,row,mode,capital){
  if(!row){
    return `
      <div class="summary-box">
        <div class="summary-title">${title}</div>
        <div class="summary-detail">当前没有可执行路线。</div>
      </div>`;
  }

  const metric=row[mode];
  const finalD=capital*metric.mult;
  const net=finalD-capital;

  return `
    <div class="summary-box">
      <div class="summary-title">${title}</div>
      <div class="summary-main path">${row.path.join("→")}</div>
      <div class="summary-detail">
        最终乘数 <b>${fmt(metric.mult,8)}</b>，收益率
        <span class="${pctClass(metric.profit)}">
          ${metric.profit>=0?"+":""}${fmt(metric.profit,4)}%
        </span>。<br>
        ${fmtAmount(capital)} d → <b>${fmtAmount(finalD)} d</b>，
        净利润
        <b class="${net>=0?"pos":"neg"}">
          ${net>=0?"+":""}${fmtAmount(net)} d
        </b>。<br>
        ${routeProcess(row.path,metric,capital)}
      </div>
    </div>`;
}

function renderSummary(cycles,capital){
  const bestFast=bestBy(cycles,"fast");
  const bestSlow=bestBy(cycles,"slow");
  const bestMixed=bestBy(cycles,"mixed");

  let comparison="数据不足";

  if(bestFast&&bestFast.slow){
    const fastFinal=capital*bestFast.fast.mult;
    const slowFinal=capital*bestFast.slow.mult;
    const difference=slowFinal-fastFinal;

    comparison=
      `秒出最优路径 <b>${bestFast.path.join("→")}</b> 若改为全程慢挂：<br>
       秒出 ${fmtAmount(fastFinal)} d；慢挂 ${fmtAmount(slowFinal)} d；<br>
       差额
       <b class="${difference>=0?"pos":"neg"}">
         ${difference>=0?"+":""}${fmtAmount(difference)} d
       </b>。`;
  }

  document.getElementById("summaryArea").innerHTML=`
    <div class="summary-grid">
      ${summaryBox("最优立即成交路线",bestFast,"fast",capital)}
      ${summaryBox("最优全程慢挂路线",bestSlow,"slow",capital)}
      ${summaryBox("最优快慢混合路线",bestMixed,"mixed",capital)}
      <div class="summary-box">
        <div class="summary-title">同一路线快慢收益差</div>
        <div class="summary-detail">${comparison}</div>
        <div class="small" style="margin-top:8px">
          慢挂利润需要等待成交，并受价格变化和挂单深度影响。
        </div>
      </div>
    </div>`;
}


function currentHoldings(){
  const result={};
  ["c","d","e","E","C"].forEach(symbol=>{
    const value=Number(document.getElementById(`holding_${symbol}`).value);
    result[symbol]=Number.isFinite(value)&&value>0?value:0;
  });
  return result;
}

function enumeratePathsToD(start,graph){
  const results=[];

  function dfs(current,visited,path,multiplier,rates){
    if(current==="d"&&path.length>1){
      results.push({
        path:[...path],
        mult:multiplier,
        rates:[...rates],
        profit:(multiplier-1)*100
      });
      return;
    }

    for(const next of nodes){
      if(next===current||visited.has(next))continue;
      const rate=graph[current][next];
      if(rate===null||!Number.isFinite(rate)||rate<=0)continue;

      visited.add(next);
      path.push(next);
      rates.push(rate);

      dfs(next,visited,path,multiplier*rate,rates);

      rates.pop();
      path.pop();
      visited.delete(next);
    }
  }

  dfs(start,new Set([start]),[start],1,[]);
  return results;
}

function edgeExecutionMode(a,b,mode,graphs){
  if(mode==="fast")return "秒出";
  if(mode==="slow")return "慢挂";
  return graphs.mixedMode[a][b]||"";
}


function currentGoldRules(){
  const perTarget={};

  ["c","d","e","E","C"].forEach(symbol=>{
    const value=Number(document.getElementById(`gold_per_${symbol}`).value);
    perTarget[symbol]=Number.isFinite(value)&&value>=0?value:0;
  });

  const availableValue=Number(document.getElementById("holding_gold").value);

  return {
    available:Number.isFinite(availableValue)&&availableValue>=0
      ?availableValue
      :0,
    valueD:0,
    perTarget
  };
}

function simulatePathWithGold(path,rates,inputAmount,goldRules){
  let amount=inputAmount;
  let totalGold=0;
  const steps=[];

  for(let i=0;i<rates.length;i++){
    const from=path[i];
    const to=path[i+1];
    const rate=rates[i];
    const output=amount*rate;
    const goldPerTarget=goldRules.perTarget[to]||0;
    const goldCost=output*goldPerTarget;

    totalGold+=goldCost;

    steps.push({
      index:i+1,
      from,
      to,
      input:amount,
      output,
      rate,
      goldPerTarget,
      goldCost,
      cumulativeGold:totalGold
    });

    amount=output;
  }

  return {
    inputAmount,
    finalAmount:amount,
    totalGold,
    steps
  };
}

function pathModes(path,mode,graphs){
  const result=[];
  for(let i=0;i<path.length-1;i++){
    result.push(edgeExecutionMode(path[i],path[i+1],mode,graphs));
  }
  return result;
}

function createRouteAction(source,path,rates,modes,goldRules){
  const unit=simulatePathWithGold(path,rates,1,goldRules);
  const finalDPerSource=unit.finalAmount;
  const grossDPerSource=source==="d"
    ?finalDPerSource-1
    :finalDPerSource;
  const objectivePerSource=
    grossDPerSource-unit.totalGold*goldRules.valueD;

  return {
    source,
    path:[...path],
    rates:[...rates],
    modes:[...modes],
    finalDPerSource,
    grossDPerSource,
    goldPerSource:unit.totalGold,
    objectivePerSource
  };
}

function buildCandidateActions(graphs,cycles,mode,goldRules,holdings){
  const graph=graphs[mode];
  const actions=[];
  const eps=1e-10;

  ["c","e","E","C"].forEach(source=>{
    if((holdings[source]||0)<=0)return;

    const paths=enumeratePathsToD(source,graph);
    paths.forEach(item=>{
      const action=createRouteAction(
        source,
        item.path,
        item.rates,
        pathModes(item.path,mode,graphs),
        goldRules
      );

      if(action.objectivePerSource>eps){
        actions.push(action);
      }
    });
  });

  if((holdings.d||0)>0){
    cycles.forEach(row=>{
      const metric=row[mode];
      if(!metric)return;

      const action=createRouteAction(
        "d",
        row.path,
        metric.rates,
        pathModes(row.path,mode,graphs),
        goldRules
      );

      if(action.objectivePerSource>eps){
        actions.push(action);
      }
    });
  }

  return actions;
}

class LinearProgramSolver{
  constructor(A,b,c){
    this.EPS=1e-9;
    this.INF=1e100;
    this.m=b.length;
    this.n=c.length;
    this.B=Array(this.m);
    this.N=Array(this.n+1);
    this.D=Array.from(
      {length:this.m+2},
      ()=>Array(this.n+2).fill(0)
    );

    for(let i=0;i<this.m;i++){
      for(let j=0;j<this.n;j++){
        this.D[i][j]=A[i][j];
      }
    }

    for(let i=0;i<this.m;i++){
      this.B[i]=this.n+i;
      this.D[i][this.n]=-1;
      this.D[i][this.n+1]=b[i];
    }

    for(let j=0;j<this.n;j++){
      this.N[j]=j;
      this.D[this.m][j]=-c[j];
    }

    this.N[this.n]=-1;
    this.D[this.m+1][this.n]=1;
  }

  pivot(r,s){
    const inv=1/this.D[r][s];

    for(let i=0;i<this.m+2;i++){
      if(i===r)continue;
      for(let j=0;j<this.n+2;j++){
        if(j===s)continue;
        this.D[i][j]-=
          this.D[r][j]*this.D[i][s]*inv;
      }
    }

    for(let j=0;j<this.n+2;j++){
      if(j!==s)this.D[r][j]*=inv;
    }

    for(let i=0;i<this.m+2;i++){
      if(i!==r)this.D[i][s]*=-inv;
    }

    this.D[r][s]=inv;

    const temp=this.B[r];
    this.B[r]=this.N[s];
    this.N[s]=temp;
  }

  simplex(phase){
    const objectiveRow=phase===1?this.m+1:this.m;

    while(true){
      let s=-1;

      for(let j=0;j<=this.n;j++){
        if(phase===2&&this.N[j]===-1)continue;

        if(
          s===-1||
          this.D[objectiveRow][j]<this.D[objectiveRow][s]-this.EPS||
          (
            Math.abs(
              this.D[objectiveRow][j]-this.D[objectiveRow][s]
            )<=this.EPS&&
            this.N[j]<this.N[s]
          )
        ){
          s=j;
        }
      }

      if(this.D[objectiveRow][s]>=-this.EPS)return true;

      let r=-1;

      for(let i=0;i<this.m;i++){
        if(this.D[i][s]<=this.EPS)continue;

        if(r===-1){
          r=i;
          continue;
        }

        const left=this.D[i][this.n+1]/this.D[i][s];
        const right=this.D[r][this.n+1]/this.D[r][s];

        if(
          left<right-this.EPS||
          (
            Math.abs(left-right)<=this.EPS&&
            this.B[i]<this.B[r]
          )
        ){
          r=i;
        }
      }

      if(r===-1)return false;
      this.pivot(r,s);
    }
  }

  solve(){
    const x=Array(this.n).fill(0);

    if(this.n===0){
      return {status:"optimal",value:0,x};
    }

    let r=0;
    for(let i=1;i<this.m;i++){
      if(this.D[i][this.n+1]<this.D[r][this.n+1]){
        r=i;
      }
    }

    if(this.D[r][this.n+1]<-this.EPS){
      this.pivot(r,this.n);

      if(
        !this.simplex(1)||
        this.D[this.m+1][this.n+1]<-this.EPS
      ){
        return {status:"infeasible",value:null,x};
      }

      if(Math.abs(this.D[this.m+1][this.n+1])>this.EPS){
        return {status:"infeasible",value:null,x};
      }

      for(let i=0;i<this.m;i++){
        if(this.B[i]!==-1)continue;

        let s=0;
        for(let j=1;j<=this.n;j++){
          if(
            this.D[i][j]<this.D[i][s]-this.EPS||
            (
              Math.abs(this.D[i][j]-this.D[i][s])<=this.EPS&&
              this.N[j]<this.N[s]
            )
          ){
            s=j;
          }
        }

        this.pivot(i,s);
      }
    }

    if(!this.simplex(2)){
      return {status:"unbounded",value:null,x};
    }

    for(let i=0;i<this.m;i++){
      if(this.B[i]<this.n){
        x[this.B[i]]=this.D[i][this.n+1];
      }
    }

    return {
      status:"optimal",
      value:this.D[this.m][this.n+1],
      x
    };
  }
}

function optimizePortfolio(graphs,cycles,mode){
  const holdings=currentHoldings();
  const goldRules=currentGoldRules();
  const actions=buildCandidateActions(
    graphs,
    cycles,
    mode,
    goldRules,
    holdings
  );

  const symbols=["c","d","e","E","C"];
  const constraints=symbols.length+1;
  const A=Array.from(
    {length:constraints},
    ()=>Array(actions.length).fill(0)
  );
  const b=symbols.map(symbol=>holdings[symbol]||0);
  b.push(goldRules.available);

  actions.forEach((action,j)=>{
    const sourceRow=symbols.indexOf(action.source);
    A[sourceRow][j]=1;
    A[constraints-1][j]=action.goldPerSource;
  });

  const c=actions.map(action=>action.objectivePerSource);

  let result={status:"optimal",value:0,x:[]};
  if(actions.length){
    result=new LinearProgramSolver(A,b,c).solve();
  }

  const allocations=[];
  const usedBySource={c:0,d:0,e:0,E:0,C:0};
  let totalGold=0;
  let grossFinalD=holdings.d||0;

  if(result.status==="optimal"){
    actions.forEach((action,index)=>{
      const value=Math.max(0,result.x[index]||0);
      const tolerance=1e-7*Math.max(1,holdings[action.source]||0);

      if(value<=tolerance)return;

      const simulation=simulatePathWithGold(
        action.path,
        action.rates,
        value,
        goldRules
      );

      const grossContributionD=action.source==="d"
        ?value*(action.finalDPerSource-1)
        :value*action.finalDPerSource;

      const objectiveContribution=
        value*action.objectivePerSource;

      usedBySource[action.source]+=value;
      totalGold+=simulation.totalGold;
      grossFinalD+=grossContributionD;

      allocations.push({
        ...action,
        sourceAmount:value,
        simulation,
        grossContributionD,
        objectiveContribution
      });
    });
  }

  allocations.sort(
    (a,b)=>b.objectiveContribution-a.objectiveContribution
  );

  const remainingBySource={};
  symbols.forEach(symbol=>{
    remainingBySource[symbol]=Math.max(
      0,
      (holdings[symbol]||0)-(usedBySource[symbol]||0)
    );
  });

  totalGold=Math.max(0,totalGold);
  const goldRemaining=Math.max(0,goldRules.available-totalGold);
  const netFinalD=
    grossFinalD-totalGold*goldRules.valueD;

  const hasUnconverted=actions.some(action=>
    remainingBySource[action.source]>
      1e-7*Math.max(1,holdings[action.source]||0)
  );

  const constrainedByGold=
    goldRules.available>=0&&
    totalGold>=goldRules.available-
      1e-7*Math.max(1,goldRules.available)&&
    hasUnconverted&&
    actions.some(action=>action.goldPerSource>0);

  const cheapestAction=[...actions]
    .filter(action=>action.goldPerSource>0)
    .sort((a,b)=>
      a.goldPerSource-b.goldPerSource||
      b.objectivePerSource-a.objectivePerSource
    )[0]||null;

  return {
    holdings,
    goldRules,
    actions,
    allocations,
    usedBySource,
    remainingBySource,
    totalGold,
    goldRemaining,
    grossFinalD,
    netFinalD,
    constrainedByGold,
    cheapestAction,
    solverStatus:result.status
  };
}

let currentSuggestedSteps=[];
let stepUpdateNotice=null;

function directionKey(from,to){
  return `${from}_to_${to}`;
}

function rawDirectionAmounts(from,to){
  const key=directionKey(from,to);
  const targetInput=document.getElementById(`${key}_target`);
  const sourceInput=document.getElementById(`${key}_source`);

  if(!targetInput||!sourceInput)return null;

  const target=Number(targetInput.value);
  const source=Number(sourceInput.value);

  if(!Number.isFinite(target)||!Number.isFinite(source)||
     target<=0||source<=0){
    return null;
  }

  return {target,source,rate:target/source};
}

function displayAmountsForStep(step){
  if(step.mode==="慢挂"){
    const reverse=rawDirectionAmounts(step.to,step.from);

    if(reverse){
      return {
        target:reverse.source,
        source:reverse.target
      };
    }
  }else{
    const direct=rawDirectionAmounts(step.from,step.to);

    if(direct){
      return {
        target:direct.target,
        source:direct.source
      };
    }
  }

  return {
    target:step.rate,
    source:1
  };
}

function ratesNearlyEqual(a,b){
  if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  const scale=Math.max(1,Math.abs(a),Math.abs(b));
  return Math.abs(a-b)<=1e-9*scale;
}

function setStepUpdateNotice(type,message){
  stepUpdateNotice={type,message};
}

function verifySuggestedStepRate(stepIndex){
  const step=currentSuggestedSteps.find(item=>item.index===stepIndex);

  if(!step){
    setStepUpdateNotice("error","当前建议已经变化，请重新生成下一步操作。");
    calculate();
    return;
  }

  const targetInput=document.getElementById(`verify_step_${stepIndex}_target`);
  const sourceInput=document.getElementById(`verify_step_${stepIndex}_source`);
  const target=Number(targetInput?.value);
  const source=Number(sourceInput?.value);

  if(!Number.isFinite(target)||!Number.isFinite(source)||
     target<=0||source<=0){
    setStepUpdateNotice(
      "error",
      `第${stepIndex}步更新失败：目标数量和付出数量都必须大于0。`
    );
    calculate();
    return;
  }

  const newRate=target/source;
  const oldRate=step.rate;

  if(ratesNearlyEqual(newRate,oldRate)){
    setStepUpdateNotice(
      "info",
      `第${stepIndex}步 ${step.from}→${step.to} 的当前比例与上方数据一致，无需更新。`
    );
    calculate();
    return;
  }

  let updateFrom;
  let updateTo;
  let updateTarget;
  let updateSource;
  let explanation;

  if(step.mode==="慢挂"){
    updateFrom=step.to;
    updateTo=step.from;
    updateTarget=source;
    updateSource=target;
    explanation=
      `慢挂 ${step.from}→${step.to} 对应反向盘口 `+
      `${updateFrom}→${updateTo}`;
  }else{
    updateFrom=step.from;
    updateTo=step.to;
    updateTarget=target;
    updateSource=source;
    explanation=`秒出盘口 ${updateFrom}→${updateTo}`;
  }

  const key=directionKey(updateFrom,updateTo);
  const topTarget=document.getElementById(`${key}_target`);
  const topSource=document.getElementById(`${key}_source`);

  if(!topTarget||!topSource){
    setStepUpdateNotice(
      "error",
      `找不到 ${updateFrom}→${updateTo} 的上方盘口输入框。`
    );
    calculate();
    return;
  }

  topTarget.value=updateTarget;
  topSource.value=updateSource;

  const changePct=oldRate===0?null:(newRate/oldRate-1)*100;
  const changeText=changePct===null
    ?""
    :`，相对原比例${changePct>=0?"+":""}${fmt(changePct,4)}%`;

  setStepUpdateNotice(
    "success",
    `已更新${explanation}：${fmtCompact(target)} ${step.to} ÷ `+
    `${fmtCompact(source)} ${step.from} = ${fmt(newRate,8)}`+
    `${changeText}。金币约束下的全局策略已重新计算。`
  );

  calculate();
}

function verifySuggestedStepGold(stepIndex){
  const step=currentSuggestedSteps.find(item=>item.index===stepIndex);

  if(!step){
    setStepUpdateNotice("error","当前建议已经变化，请重新生成下一步操作。");
    calculate();
    return;
  }

  const availableInput=document.getElementById(
    `verify_step_${stepIndex}_gold_available`
  );
  const feeInput=document.getElementById(
    `verify_step_${stepIndex}_gold_fee`
  );

  const available=Number(availableInput?.value);
  const fee=Number(feeInput?.value);

  if(
    !Number.isFinite(available)||available<0||
    !Number.isFinite(fee)||fee<0
  ){
    setStepUpdateNotice(
      "error",
      `第${stepIndex}步金币更新失败：金币和固定费率不能小于0。`
    );
    calculate();
    return;
  }

  const oldRules=currentGoldRules();
  const sameAvailable=ratesNearlyEqual(available,oldRules.available);
  const sameFee=ratesNearlyEqual(fee,oldRules.perTarget[step.to]||0);

  if(sameAvailable&&sameFee){
    setStepUpdateNotice(
      "info",
      `第${stepIndex}步金币数据与当前设置一致，无需更新。`
    );
    calculate();
    return;
  }

  document.getElementById("holding_gold").value=available;
  document.getElementById(`gold_per_${step.to}`).value=fee;

  setStepUpdateNotice(
    "success",
    `已更新可用金币为 ${fmtAmount(available)}，并将“每得到1个 `+
    `${step.to} 的金币费率”更新为 ${fmtCompact(fee)}。`+
    `系统已重新选择最优路线与可兑换数量。`
  );

  calculate();
}

function stepRateCheckHtml(step){
  const amounts=displayAmountsForStep(step);
  const underlying=step.mode==="慢挂"
    ?`将更新反向盘口 ${step.to}→${step.from}`
    :`将更新上方盘口 ${step.from}→${step.to}`;

  return `
    <div class="step-rate-check">
      <div class="step-rate-title">
        <span>执行前核对本步当前兑换比例</span>
        <span class="small">${underlying}</span>
      </div>

      <div class="step-rate-grid">
        <div>
          <label>左：实际得到的 ${step.to}</label>
          <input id="verify_step_${step.index}_target"
            type="number" min="0" step="any"
            value="${amounts.target}">
        </div>

        <div class="divider">÷</div>

        <div>
          <label>右：实际付出的 ${step.from}</label>
          <input id="verify_step_${step.index}_source"
            type="number" min="0" step="any"
            value="${amounts.source}">
        </div>

        <button class="ghost" type="button"
          data-action="verify-step-rate"
          data-step-index="${step.index}">
          核对兑换比例
        </button>
      </div>

      <div class="step-rate-preview">
        当前用于计算：1 ${step.from} →
        <b>${fmtCompact(step.rate)} ${step.to}</b>。
        只比较“左 ÷ 右”的比例。
      </div>
    </div>`;
}

function stepGoldCheckHtml(step){
  return `
    <div class="gold-check">
      <div class="step-rate-title">
        <span>执行前核对金币</span>
        <span class="small">
          金币只按本步左侧目标 ${step.to} 的数量计算
        </span>
      </div>

      <div class="gold-check-grid">
        <div>
          <label>执行该步时实际可用金币</label>
          <input id="verify_step_${step.index}_gold_available"
            type="number" min="0" step="any"
            value="${step.goldBefore}">
        </div>

        <div>
          <label>每得到1个 ${step.to} 消耗金币</label>
          <input id="verify_step_${step.index}_gold_fee"
            type="number" min="0" step="any"
            value="${step.goldPerTarget}">
        </div>

        <button class="ghost" type="button"
          data-action="verify-step-gold"
          data-step-index="${step.index}">
          核对金币并重算
        </button>
      </div>

      <div class="step-rate-preview">
        本步预计得到 ${fmtAmount(step.output)} ${step.to}，
        需要 <b>${fmtAmount(step.goldCost)} 金币</b>；
        预计完成后剩余 <b>${fmtAmount(step.goldAfter)} 金币</b>。
      </div>
    </div>`;
}

function buildStepObjects(allocation,goldRules){
  const steps=[];
  let goldUsedBefore=0;

  allocation.simulation.steps.forEach((base,index)=>{
    const goldBefore=Math.max(
      0,
      goldRules.available-goldUsedBefore
    );
    goldUsedBefore+=base.goldCost;

    steps.push({
      ...base,
      index:index+1,
      mode:allocation.modes[index],
      goldBefore,
      goldAfter:Math.max(
        0,
        goldRules.available-goldUsedBefore
      )
    });
  });

  return steps;
}

function actionModeLabel(mode){
  if(mode==="秒出")return '<span class="mode-chip">秒出·立即成交</span>';
  if(mode==="慢挂")return '<span class="mode-chip">慢挂·等待成交</span>';
  return `<span class="mode-chip">${mode}</span>`;
}


function safeRatio(numerator,denominator){
  if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||
     denominator<=0){
    return null;
  }
  return numerator/denominator;
}

function automaticGoldMetrics(portfolio){
  let dPrincipalUsed=0;
  let dCycleFinal=0;
  let dCycleProfit=0;
  let dCycleGold=0;

  let inventoryProceedsD=0;
  let inventoryGold=0;

  portfolio.allocations.forEach(allocation=>{
    if(allocation.source==="d"){
      dPrincipalUsed+=allocation.sourceAmount;
      const finalD=
        allocation.sourceAmount*allocation.finalDPerSource;
      dCycleFinal+=finalD;
      dCycleProfit+=finalD-allocation.sourceAmount;
      dCycleGold+=allocation.simulation.totalGold;
    }else{
      inventoryProceedsD+=
        allocation.sourceAmount*allocation.finalDPerSource;
      inventoryGold+=allocation.simulation.totalGold;
    }
  });

  const dRoi=safeRatio(dCycleProfit,dPrincipalUsed);
  const dProfitPerGold=safeRatio(dCycleProfit,dCycleGold);
  const goldPer10000D=safeRatio(dCycleGold,dPrincipalUsed);
  const inventoryDPerGold=safeRatio(
    inventoryProceedsD,
    inventoryGold
  );

  const allDIncrease=
    portfolio.grossFinalD-(portfolio.holdings.d||0);
  const allDPerGold=safeRatio(
    allDIncrease,
    portfolio.totalGold
  );

  return {
    dPrincipalUsed,
    dCycleFinal,
    dCycleProfit,
    dCycleGold,
    dRoiPct:dRoi===null?null:dRoi*100,
    dProfitPerGold,
    breakEvenGoldValueD:dProfitPerGold,
    goldPer10000D:
      goldPer10000D===null?null:goldPer10000D*10000,
    inventoryProceedsD,
    inventoryGold,
    inventoryDPerGold,
    allDIncrease,
    allDPerGold
  };
}

function metricDisplay(value,suffix="",digits=4){
  if(value===null||value===undefined||!Number.isFinite(value)){
    return "暂无";
  }
  return `${fmt(value,digits)}${suffix}`;
}

function automaticGoldPanelHtml(portfolio){
  const m=automaticGoldMetrics(portfolio);

  const dArbitrageItems=m.dPrincipalUsed>0
    ?`
      <div class="gold-value-item">
        <div class="gold-value-label">本次投入的 d 本金</div>
        <div class="gold-value-number">
          ${fmtAmount(m.dPrincipalUsed)} d
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">d 本金路线最终得到</div>
        <div class="gold-value-number">
          ${fmtAmount(m.dCycleFinal)} d
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">d 本金套利净利润</div>
        <div class="gold-value-number ${m.dCycleProfit>=0?"pos":"neg"}">
          ${m.dCycleProfit>=0?"+":""}${fmtAmount(m.dCycleProfit)} d
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">d 本金套利收益率</div>
        <div class="gold-value-number ${m.dRoiPct>=0?"pos":"neg"}">
          ${metricDisplay(m.dRoiPct,"%",4)}
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">d 本金路线消耗金币</div>
        <div class="gold-value-number">
          ${fmtAmount(m.dCycleGold)}
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">每1金币带来的 d 净利润</div>
        <div class="gold-value-number">
          ${metricDisplay(m.dProfitPerGold," d",6)}
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">每1万 d 本金平均需要金币</div>
        <div class="gold-value-number">
          ${metricDisplay(m.goldPer10000D,"",2)}
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">1金币的盈亏平衡价值</div>
        <div class="gold-value-number">
          ${metricDisplay(m.breakEvenGoldValueD," d",6)}
        </div>
      </div>`
    :`
      <div class="gold-value-item">
        <div class="gold-value-label">d 本金套利</div>
        <div class="gold-value-number">本次未投入 d 本金</div>
      </div>`;

  const inventoryItems=m.inventoryProceedsD>0
    ?`
      <div class="gold-value-item">
        <div class="gold-value-label">其他资源变现所得</div>
        <div class="gold-value-number">
          ${fmtAmount(m.inventoryProceedsD)} d
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">其他资源变现金币消耗</div>
        <div class="gold-value-number">
          ${fmtAmount(m.inventoryGold)}
        </div>
      </div>
      <div class="gold-value-item">
        <div class="gold-value-label">其他资源每金币换回的 d</div>
        <div class="gold-value-number">
          ${metricDisplay(m.inventoryDPerGold," d",6)}
        </div>
      </div>`
    :"";

  return `
    <div class="gold-value-panel">
      <div class="gold-value-title">系统自动计算的金币价值与平均效率</div>

      <div class="gold-value-grid">
        ${dArbitrageItems}
        ${inventoryItems}

        <div class="gold-value-item">
          <div class="gold-value-label">
            全部操作相对当前 d 余额新增
          </div>
          <div class="gold-value-number">
            ${fmtAmount(m.allDIncrease)} d
          </div>
        </div>

        <div class="gold-value-item">
          <div class="gold-value-label">
            全部操作平均每金币增加的 d
          </div>
          <div class="gold-value-number">
            ${metricDisplay(m.allDPerGold," d",6)}
          </div>
        </div>
      </div>

      <div class="gold-value-explain">
        <b>1金币的盈亏平衡价值</b> =
        d本金套利净利润 ÷ 该套利消耗的金币。
        例如结果为0.25 d，表示只要你认为1金币的实际成本低于0.25 d，
        这组d本金套利在计入金币后仍有正收益。
        其他资源原本就是你的库存，因此单独显示“变现所得/金币”，
        不把全部变现所得错误地称为套利利润。
      </div>
    </div>`;
}


function renderNextAction(graphs,cycles,mode){
  const area=document.getElementById("nextActionArea");
  const portfolio=optimizePortfolio(graphs,cycles,mode);
  const holdings=portfolio.holdings;
  const hasHoldings=["c","d","e","E","C"].some(
    symbol=>(holdings[symbol]||0)>0
  );

  if(!hasHoldings){
    currentSuggestedSteps=[];
    area.innerHTML=
      '<div class="empty">请先填写至少一种当前持仓数量。</div>';
    return;
  }

  if(portfolio.solverStatus!=="optimal"){
    currentSuggestedSteps=[];
    area.innerHTML=
      '<div class="empty">优化计算失败，请检查输入数值是否过大或存在异常。</div>';
    return;
  }

  if(!portfolio.allocations.length){
    currentSuggestedSteps=[];

    let reason=
      "当前没有在金币预算和收益条件下值得执行的兑换。";

    if(
      portfolio.goldRules.available<=0&&
      portfolio.actions.some(action=>action.goldPerSource>0)
    ){
      reason=
        "当前金币为0，而可行路线需要金币，因此暂时无法兑换。";
    }

    let cheapest="";
    if(portfolio.cheapestAction){
      cheapest=
        `<div class="plan-row">
          金币最省的候选路线是
          <b>${portfolio.cheapestAction.path.join(" → ")}</b>：
          每投入1个 ${portfolio.cheapestAction.source}，
          需要约 ${fmtCompact(portfolio.cheapestAction.goldPerSource)} 金币。
        </div>`;
    }

    area.innerHTML=`
      <div class="next-action-title">当前建议</div>
      <div class="next-action-main">暂不兑换</div>
      <div class="step-sub" style="margin-top:7px">${reason}</div>
      <div class="plan-list">${cheapest}</div>`;
    return;
  }

  const primary=portfolio.allocations[0];
  const steps=buildStepObjects(primary,portfolio.goldRules);
  currentSuggestedSteps=steps.map(step=>({...step}));
  const first=steps[0];

  const partial=
    primary.sourceAmount<
      (holdings[primary.source]||0)-
      1e-7*Math.max(1,holdings[primary.source]||0);

  let stepsHtml="";
  steps.forEach(step=>{
    stepsHtml+=`
      <div class="step-item">
        <div class="step-number">${step.index}</div>
        <div>
          <div class="step-main">
            ${actionModeLabel(step.mode)}
            用 <b>${fmtAmount(step.input)} ${step.from}</b>
            兑换成约 <b>${fmtAmount(step.output)} ${step.to}</b>
          </div>

          <div class="step-sub">
            兑换方向：${step.from} → ${step.to}；
            本步比例：1 ${step.from} →
            ${fmtCompact(step.rate)} ${step.to}
          </div>

          <div class="gold-cost-line">
            金币：${fmtAmount(step.output)} ${step.to}
            × ${fmtCompact(step.goldPerTarget)}
            = <b>${fmtAmount(step.goldCost)} 金币</b>
          </div>

          ${stepRateCheckHtml(step)}
          ${stepGoldCheckHtml(step)}
        </div>
      </div>`;
  });

  let allocationHtml="";
  portfolio.allocations.forEach((allocation,index)=>{
    allocationHtml+=`
      <div class="allocation-row">
        <b>${index+1}. ${allocation.path.join(" → ")}</b>：
        分配 ${fmtAmount(allocation.sourceAmount)}
        ${allocation.source}，
        消耗 ${fmtAmount(allocation.simulation.totalGold)} 金币，
        对最终d的毛贡献为
        <b>${fmtAmount(allocation.grossContributionD)} d</b>。
      </div>`;
  });

  let remainingHtml="";
  ["c","d","e","E","C"].forEach(symbol=>{
    const amount=portfolio.remainingBySource[symbol];
    if(amount<=1e-7*Math.max(1,holdings[symbol]||0))return;

    remainingHtml+=`
      <div class="plan-row">
        保留 <b>${fmtAmount(amount)} ${symbol}</b> 暂不兑换。
        ${
          portfolio.constrainedByGold
            ?"原因：金币预算已优先分配给收益更高的操作。"
            :"原因：继续兑换不能提高当前优化目标。"
        }
      </div>`;
  });

  const noticeHtml=stepUpdateNotice
    ?`<div class="step-update-message ${stepUpdateNotice.type}">
       ${stepUpdateNotice.message}
     </div>`
    :"";

  const firstRouteGold=primary.simulation.totalGold;
  const requiredForAllSameRoute=
    primary.goldPerSource*(holdings[primary.source]||0);
  const shortfall=Math.max(
    0,
    requiredForAllSameRoute-portfolio.goldRules.available
  );

  const goldValueAnalysis=automaticGoldPanelHtml(portfolio);

  area.innerHTML=`
    <div class="next-action-title">
      下一步建议 · 当前模式：${modeName(mode)} · 金币全局优化
    </div>

    ${noticeHtml}

    <div class="next-action-main">
      ${actionModeLabel(first.mode)}
      将 ${fmtAmount(first.input)} ${first.from}
      兑换为约 ${fmtAmount(first.output)} ${first.to}
    </div>

    <div class="step-sub" style="margin-top:7px">
      本条完整路线：<b>${primary.path.join(" → ")}</b>。
      本次分配 ${fmtAmount(primary.sourceAmount)}
      ${primary.source}，预计消耗
      <b>${fmtAmount(firstRouteGold)} 金币</b>。
      ${partial?'<span class="partial-badge">金币/收益约束下只兑换部分数量</span>':""}
    </div>

    <div class="strategy-panel">
      <div class="strategy-title">金币约束下的整体最优策略</div>
      <div class="strategy-stats">
        <div class="strategy-stat">
          <div class="strategy-stat-label">现有金币</div>
          <div class="strategy-stat-value">
            ${fmtAmount(portfolio.goldRules.available)}
          </div>
        </div>
        <div class="strategy-stat">
          <div class="strategy-stat-label">计划消耗金币</div>
          <div class="strategy-stat-value">
            ${fmtAmount(portfolio.totalGold)}
          </div>
        </div>
        <div class="strategy-stat">
          <div class="strategy-stat-label">计划剩余金币</div>
          <div class="strategy-stat-value">
            ${fmtAmount(portfolio.goldRemaining)}
          </div>
        </div>
        <div class="strategy-stat">
          <div class="strategy-stat-label">预计最终毛 d</div>
          <div class="strategy-stat-value">
            ${fmtAmount(portfolio.grossFinalD)}
          </div>
        </div>
      </div>

      ${goldValueAnalysis}

      <div class="summary-detail">
        策略目标：在当前金币预算内，使最终获得的 d 尽可能多。
        ${
          portfolio.constrainedByGold
            ?'<br><span class="gold-warning">当前策略受到金币不足限制，系统已自动选择更省金币的路线或缩小兑换数量。</span>'
            :'<br><span class="gold-ok">当前金币足以执行系统选择的全部操作。</span>'
        }
        ${
          partial&&shortfall>0
            ?`<br>若想把当前全部 ${primary.source} 都走同一路线，
               还需要约 <b>${fmtAmount(shortfall)} 金币</b>。`
            :""
        }
      </div>
    </div>

    <div class="step-list">${stepsHtml}</div>

    ${
      portfolio.allocations.length>1
        ?`<div class="summary-title" style="margin-top:17px">
           后续还应执行的金币分配
         </div>
         <div class="plan-list">${allocationHtml}</div>`
        :""
    }

    ${
      remainingHtml
        ?`<div class="summary-title" style="margin-top:17px">
           暂时不兑换的持仓
         </div>
         <div class="plan-list">${remainingHtml}</div>`
        :""
    }
  `;
}

function clearHoldings(){
  ["c","d","e","E","C"].forEach(symbol=>{
    document.getElementById(`holding_${symbol}`).value=0;
  });
  document.getElementById("holding_gold").value=0;
  calculate();
}



function numericFieldValue(id){
  const value=Number(document.getElementById(id).value);
  return Number.isFinite(value)&&value>=0?value:0;
}

function collectMarketJson(){
  const market={};

  defs.forEach(([a,b,key])=>{
    market[key]={
      target:numericFieldValue(`${key}_target`),
      source:numericFieldValue(`${key}_source`)
    };
  });

  return market;
}

function collectFullShareData(type="market"){
  const result={
    app:"five-resource-next-step-assistant",
    version:3,
    type,
    exportedAt:new Date().toISOString(),
    market:collectMarketJson(),
    goldRules:{
      perTarget:{
        c:numericFieldValue("gold_per_c"),
        d:numericFieldValue("gold_per_d"),
        e:numericFieldValue("gold_per_e"),
        E:numericFieldValue("gold_per_E"),
        C:numericFieldValue("gold_per_C")
      }
    }
  };

  if(type==="full"){
    result.holdings={};
    ["c","d","e","E","C"].forEach(symbol=>{
      result.holdings[symbol]=numericFieldValue(`holding_${symbol}`);
    });
    result.holdings.gold=numericFieldValue("holding_gold");

    result.settings={
      capital:numericFieldValue("capital"),
      rankMode:document.getElementById("rankMode").value,
      topN:Math.max(
        1,
        Math.min(
          64,
          parseInt(document.getElementById("topN").value,10)||10
        )
      )
    };
  }

  return result;
}

function setShareStatus(message,type=""){
  const box=document.getElementById("shareStatus");
  box.className=`share-status ${type}`.trim();
  box.textContent=message;
}

function generateShareJson(type="market"){
  const data=collectFullShareData(type);
  const json=JSON.stringify(data,null,2);
  document.getElementById("shareJsonOutput").value=json;

  setShareStatus(
    type==="full"
      ?"已生成完整 JSON：包含市场数据、当前持仓和页面设置。"
      :"已生成市场 JSON：仅包含兑换表，适合直接分享给其他人。",
    "success"
  );

  return json;
}

function fallbackCopyText(textarea){
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0,textarea.value.length);
  return document.execCommand("copy");
}

async function copyShareJson(){
  const textarea=document.getElementById("shareJsonOutput");

  if(!textarea.value.trim()){
    generateShareJson("market");
  }

  try{
    if(navigator.clipboard&&window.isSecureContext){
      await navigator.clipboard.writeText(textarea.value);
    }else{
      const copied=fallbackCopyText(textarea);
      if(!copied)throw new Error("copy failed");
    }

    setShareStatus("JSON 已复制到剪贴板，可以直接粘贴发给其他人。","success");
  }catch(error){
    textarea.focus();
    textarea.select();
    setShareStatus(
      "浏览器未允许自动复制，JSON 已选中，请按 Ctrl+C 复制。",
      "error"
    );
  }
}

function safeFileTimestamp(){
  const date=new Date();
  const pad=value=>String(value).padStart(2,"0");

  return [
    date.getFullYear(),
    pad(date.getMonth()+1),
    pad(date.getDate())
  ].join("-")+"_"+[
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("-");
}

function downloadShareJson(){
  const textarea=document.getElementById("shareJsonOutput");

  if(!textarea.value.trim()){
    generateShareJson("market");
  }

  const blob=new Blob(
    [textarea.value],
    {type:"application/json;charset=utf-8"}
  );
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");

  let type="market";
  try{
    type=JSON.parse(textarea.value).type||"market";
  }catch(error){}

  link.href=url;
  link.download=
    `五资源_${type==="full"?"完整数据":"市场兑换表"}_${safeFileTimestamp()}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setShareStatus("JSON 文件已保存到浏览器下载目录。","success");
}

function applyImportedData(obj){
  if(!obj||typeof obj!=="object"){
    throw new Error("JSON 顶层必须是对象");
  }

  // 支持：
  // 1. 新分享格式：{market:{...}, holdings:{...}, settings:{...}}
  // 2. 旧格式：{e_to_c:{target,source}, ...}
  // 3. 更早的小数格式：{e_to_c:0.048, ...}
  const market=
    obj.market&&typeof obj.market==="object"
      ?obj.market
      :obj.ratios&&typeof obj.ratios==="object"
        ?obj.ratios
        :obj;

  let importedDirections=0;

  defs.forEach(([a,b,key])=>{
    if(!(key in market))return;

    const value=market[key];

    if(value&&typeof value==="object"){
      const target=Number(value.target??0);
      const source=Number(value.source??0);

      document.getElementById(`${key}_target`).value=
        Number.isFinite(target)&&target>=0?target:0;

      document.getElementById(`${key}_source`).value=
        Number.isFinite(source)&&source>=0?source:0;
    }else{
      const rate=Number(value??0);

      if(Number.isFinite(rate)&&rate>0){
        document.getElementById(`${key}_target`).value=rate;
        document.getElementById(`${key}_source`).value=1;
      }else{
        document.getElementById(`${key}_target`).value=0;
        document.getElementById(`${key}_source`).value=0;
      }
    }

    importedDirections++;
  });

  if(obj.goldRules&&typeof obj.goldRules==="object"){
    const perTarget=
      obj.goldRules.perTarget&&typeof obj.goldRules.perTarget==="object"
        ?obj.goldRules.perTarget
        :obj.goldRules;

    ["c","d","e","E","C"].forEach(symbol=>{
      if(perTarget[symbol]===undefined)return;
      const value=Number(perTarget[symbol]);
      document.getElementById(`gold_per_${symbol}`).value=
        Number.isFinite(value)&&value>=0?value:0;
    });
  }

  if(obj.holdings&&typeof obj.holdings==="object"){
    ["c","d","e","E","C"].forEach(symbol=>{
      if(obj.holdings[symbol]===undefined)return;
      const value=Number(obj.holdings[symbol]);

      document.getElementById(`holding_${symbol}`).value=
        Number.isFinite(value)&&value>=0?value:0;
    });

    if(obj.holdings.gold!==undefined){
      const gold=Number(obj.holdings.gold);
      document.getElementById("holding_gold").value=
        Number.isFinite(gold)&&gold>=0?gold:0;
    }
  }

  if(obj.settings&&typeof obj.settings==="object"){
    const settings=obj.settings;

    if(settings.capital!==undefined){
      const capital=Number(settings.capital);
      document.getElementById("capital").value=
        Number.isFinite(capital)&&capital>=0?capital:10000;
    }

    if(["fast","slow","mixed"].includes(settings.rankMode)){
      document.getElementById("rankMode").value=settings.rankMode;
    }

    if(settings.topN!==undefined){
      const topN=parseInt(settings.topN,10);
      document.getElementById("topN").value=
        Number.isFinite(topN)?Math.max(1,Math.min(64,topN)):10;
    }

  }

  if(importedDirections===0){
    throw new Error("JSON 中没有找到可识别的兑换方向");
  }

  calculate();
  return importedDirections;
}

function importShareJson(){
  const text=document.getElementById("shareJsonOutput").value.trim();

  if(!text){
    setShareStatus("请先粘贴需要导入的 JSON。","error");
    return;
  }

  try{
    const obj=JSON.parse(text);
    const count=applyImportedData(obj);

    setShareStatus(
      `导入成功：已恢复 ${count} 个兑换方向。`,
      "success"
    );
  }catch(error){
    setShareStatus(`导入失败：${error.message}`,"error");
  }
}


function collectPersistentInputs(){
  const data={};

  defs.forEach(([a,b,key])=>{
    data[key]={
      target:document.getElementById(`${key}_target`).value,
      source:document.getElementById(`${key}_source`).value
    };
  });

  data.capital=document.getElementById("capital").value;
  data.topN=document.getElementById("topN").value;
  data.rankMode=document.getElementById("rankMode").value;
  data.holdings={};

  ["c","d","e","E","C"].forEach(symbol=>{
    data.holdings[symbol]=document.getElementById(`holding_${symbol}`).value;
  });

  data.holdings.gold=document.getElementById("holding_gold").value;
  data.goldRules={};
  ["c","d","e","E","C"].forEach(symbol=>{
    data.goldRules[symbol]=document.getElementById(`gold_per_${symbol}`).value;
  });

  return data;
}

function applySavedInputs(data){
  if(!data||typeof data!=="object")return false;

  defs.forEach(([a,b,key])=>{
    if(data[key]){
      document.getElementById(`${key}_target`).value=data[key].target??0;
      document.getElementById(`${key}_source`).value=data[key].source??0;
    }
  });

  if(data.capital!==undefined){
    document.getElementById("capital").value=data.capital;
  }
  if(data.topN!==undefined){
    document.getElementById("topN").value=data.topN;
  }
  if(data.rankMode!==undefined){
    document.getElementById("rankMode").value=data.rankMode;
  }

  if(data.holdings){
    ["c","d","e","E","C"].forEach(symbol=>{
      if(data.holdings[symbol]!==undefined){
        document.getElementById(`holding_${symbol}`).value=data.holdings[symbol];
      }
    });

    if(data.holdings.gold!==undefined){
      document.getElementById("holding_gold").value=data.holdings.gold;
    }
  }

  if(data.goldRules){
    ["c","d","e","E","C"].forEach(symbol=>{
      if(data.goldRules[symbol]!==undefined){
        document.getElementById(`gold_per_${symbol}`).value=data.goldRules[symbol];
      }
    });
  }

  return true;
}

function saveInputs(){
  if(!persistenceHydrated)return;
  const data=collectPersistentInputs();

  // V10 是桌面整合版键；同时保留 V9，保证用户原始网页版和旧版本可继续读取。
  safeStorageSet("fiveResourceRatioInputV10",JSON.stringify(data));
  safeStorageSet("fiveResourceRatioInputV9",JSON.stringify(data));

  if(desktopApi?.saveArbitrageState){
    clearTimeout(desktopSaveTimer);
    desktopSaveTimer=setTimeout(()=>{
      desktopApi.saveArbitrageState(data).catch(()=>undefined);
    },250);
  }
}

function loadInputs(){
  let loaded=false;

  try{
    const data=JSON.parse(
      safeStorageGet("fiveResourceRatioInputV10") ||
      safeStorageGet("fiveResourceRatioInputV9") ||
      safeStorageGet("fiveResourceRatioInputV8") ||
      safeStorageGet("fiveResourceRatioInputV7") ||
      safeStorageGet("fiveResourceRatioInputV6") ||
      safeStorageGet("fiveResourceRatioInputV5") ||
      "null"
    );
    loaded=applySavedInputs(data);
  }catch(error){}

  // 自动兼容上一版：旧版输入的是“1个源物品可换多少目标物品”
  if(!loaded){
    try{
      const oldData=JSON.parse(safeStorageGet("fiveResourceFastSlowV4")||"null");

      if(oldData){
        defs.forEach(([a,b,key])=>{
          const oldRate=Number(oldData[key]);
          if(Number.isFinite(oldRate)&&oldRate>0){
            document.getElementById(`${key}_target`).value=oldRate;
            document.getElementById(`${key}_source`).value=1;
          }
        });

        if(oldData.capital!==undefined){
          document.getElementById("capital").value=oldData.capital;
        }
        if(oldData.topN!==undefined){
          document.getElementById("topN").value=oldData.topN;
        }
        if(oldData.rankMode!==undefined){
          document.getElementById("rankMode").value=oldData.rankMode;
        }
        loaded=true;
      }
    }catch(error){}
  }

  return loaded;
}

async function restoreDesktopStateWhenLocalEmpty(localLoaded){
  if(localLoaded||!desktopApi?.getArbitrageState){
    persistenceHydrated=true;
    return;
  }
  try{
    const persisted=await desktopApi.getArbitrageState();
    applySavedInputs(persisted?.data);
  }catch(error){}
  persistenceHydrated=true;
  calculate();
}

function calculate(options={}){
  try{
    clearPageError();
    updateDirectionCalculators();

    const graphs=buildGraphs();
    renderMatrix(graphs.fast,"fastMatrix");
    renderMatrix(graphs.slow,"slowMatrix");
    renderSpreads(graphs);

    const capitalValue=Number(document.getElementById("capital").value);
    const capital=
      Number.isFinite(capitalValue)&&capitalValue>=0?capitalValue:10000;

    const topValue=parseInt(document.getElementById("topN").value,10);
    const topN=
      Number.isFinite(topValue)?Math.max(1,Math.min(64,topValue)):10;

    const mode=document.getElementById("rankMode").value;
    const cycles=enumerateCycles(graphs);

    renderNextAction(graphs,cycles,mode);
    renderRanking(cycles,capital,topN,mode);
    renderSummary(cycles,capital);
    saveInputs();
    return {
      ok:true,
      enabledDirections:defs.filter(([, , key])=>readDirection(key)!==null).length,
      source:options.source||"manual"
    };
  }catch(error){
    showPageError("计算失败",error);
    setActionStatus("error","计算失败",String(error?.message||error));
    return {ok:false,error};
  }
}

function importJson(){
  try{
    const obj=JSON.parse(document.getElementById("jsonInput").value);
    const count=applyImportedData(obj);
    alert(`导入成功：已恢复 ${count} 个兑换方向。`);
  }catch(error){
    alert(`导入失败：${error.message}`);
  }
}

function clearAll(){
  defs.forEach(([a,b,key])=>{
    document.getElementById(`${key}_target`).value=0;
    document.getElementById(`${key}_source`).value=0;
  });
  calculate();
}

function scheduleLiveCalculation(){
  clearTimeout(liveCalculationTimer);
  liveCalculationTimer=setTimeout(()=>{
    calculate({source:"live"});
  },120);
}

function enableLiveCalculation(){
  document.querySelectorAll("input,select").forEach(element=>{
    if(element.dataset.liveCalculationBound==="1")return;
    element.dataset.liveCalculationBound="1";
    element.addEventListener("input",scheduleLiveCalculation);
    element.addEventListener("change",scheduleLiveCalculation);
  });
}

async function handleActionButton(button){
  const action=button.dataset.action;
  const originalText=button.textContent;
  button.type="button";
  button.disabled=true;
  button.setAttribute("aria-busy","true");
  setActionStatus("working","正在执行",`${originalText.trim()}……`);

  try{
    clearPageError();
    await nextPaint();

    switch(action){
      case "calculate":{
        const result=calculate({source:"button"});
        if(!result.ok)throw result.error;
        setActionStatus(
          "success",
          "计算完成",
          `已按当前盘口重新计算；启用 ${result.enabledDirections}/20 个兑换方向。`,
          4500
        );
        break;
      }
      case "clear-all":
        clearAll();
        setActionStatus("success","已清空兑换比例","20 个兑换方向均已重置为 0。",3500);
        break;
      case "clear-holdings":
        clearHoldings();
        setActionStatus("success","已清空持仓与金币","市场兑换比例保持不变。",3500);
        break;
      case "import-json":
        importJson();
        setActionStatus("success","JSON 导入完成","页面已根据导入内容重新计算。",4000);
        break;
      case "generate-share":{
        const json=generateShareJson(button.dataset.shareType||"market");
        setActionStatus("success","JSON 已生成",`输出 ${json.length} 个字符，可复制、保存或继续编辑。`,4500);
        break;
      }
      case "copy-share":
        await copyShareJson();
        setActionStatus("success","复制操作已完成",document.getElementById("shareStatus").textContent,4500);
        break;
      case "download-share":
        downloadShareJson();
        setActionStatus("success","JSON 文件已生成","浏览器下载流程已经触发。",4500);
        break;
      case "import-share":
        importShareJson();
        setActionStatus("success","下方 JSON 已处理",document.getElementById("shareStatus").textContent,4500);
        break;
      case "verify-step-rate":
        verifySuggestedStepRate(Number(button.dataset.stepIndex));
        setActionStatus("success","步骤比例已核对","策略已经按最新比例重新计算。",4000);
        break;
      case "verify-step-gold":
        verifySuggestedStepGold(Number(button.dataset.stepIndex));
        setActionStatus("success","步骤金币已核对","策略已经按最新金币条件重新计算。",4000);
        break;
      default:
        throw new Error(`未知按钮动作：${action||"(空)"}`);
    }
  }catch(error){
    showPageError("按钮执行失败",error);
    setActionStatus("error","按钮执行失败",String(error?.message||error));
    if(action?.includes("share")){
      setShareStatus(`操作失败：${String(error?.message||error)}`,"error");
    }
  }finally{
    if(button.isConnected){
      button.disabled=false;
      button.removeAttribute("aria-busy");
    }
  }
}

function bindActionButtons(){
  if(actionButtonsBound)return document.querySelectorAll("button[data-action]").length;
  actionButtonsBound=true;

  const staticButtons=[...document.querySelectorAll("button[data-action]")];
  staticButtons.forEach(button=>{
    button.type="button";
    button.addEventListener("click",event=>{
      event.preventDefault();
      void handleActionButton(button);
    });
  });

  // Step verification buttons are created after each calculation; delegate only inside their result container.
  const nextActionArea=requiredElement("nextActionArea");
  nextActionArea.addEventListener("click",event=>{
    const button=event.target.closest?.("button[data-action]");
    if(!button||!nextActionArea.contains(button))return;
    event.preventDefault();
    void handleActionButton(button);
  });

  return staticButtons.length;
}

async function initializeArbitragePage(){
  if(appInitialized&&bootDiagnostics)return bootDiagnostics;

  setRuntimeStatus("loading","正在校验兑换助手页面","检查 20 个兑换方向、结果区域和按钮控制器。");

  try{
    const diagnostics=validateRequiredDom();
    const localLoaded=loadInputs();
    persistenceHydrated=localLoaded||!desktopApi?.getArbitrageState;

    diagnostics.staticButtonCount=bindActionButtons();
    enableLiveCalculation();

    const initialResult=calculate({source:"initial"});
    if(!initialResult.ok)throw initialResult.error;

    await restoreDesktopStateWhenLocalEmpty(localLoaded);

    appInitialized=true;
    bootDiagnostics={
      ...diagnostics,
      storageSource:localLoaded?"localStorage":(desktopApi?.getArbitrageState?"desktop":"defaults"),
      initializedAt:new Date().toISOString()
    };

    setRuntimeStatus(
      "ready",
      "兑换计算模块已就绪",
      `已校验 ${bootDiagnostics.directionCount} 个兑换方向，绑定 ${bootDiagnostics.staticButtonCount} 个固定按钮。`
    );
    return bootDiagnostics;
  }catch(error){
    appInitialized=false;
    showPageError("兑换助手初始化失败",error);
    setRuntimeStatus("error","兑换助手初始化失败",String(error?.message||error));
    throw error;
  }
}

window.POE2ArbitrageApp=Object.freeze({
  boot:initializeArbitragePage,
  isReady:()=>appInitialized,
  calculate:()=>calculate({source:"external"}),
  diagnostics:()=>bootDiagnostics?{...bootDiagnostics}:null
});

