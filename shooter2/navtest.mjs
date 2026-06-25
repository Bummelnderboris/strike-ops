import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors=[];
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox']});
const p=await b.newPage();
p.on('pageerror',e=>errors.push('PE:'+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await p.goto('http://localhost:4173/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,500));
const res=await p.evaluate(()=>{
  const g=window.__bp.game; const ng=g.world.navGrid;
  const out={cols:ng.cols,rows:ng.rows};
  // path from one side of the warehouse to the other (must route around walls)
  const a={x:-14,z:8}, bb={x:-14,z:-28};
  const path=ng.findPath(a,bb);
  out.pathLen=path?path.length:null;
  out.pathOk=!!(path&&path.length>=2);
  // path straight-line where open
  const p2=ng.findPath({x:0,z:20},{x:0,z:10});
  out.openPathLen=p2?p2.length:null;
  // blocked-cell sanity: center of warehouse wall should be blocked
  const wc=ng.worldToCell(-14,-20); out.wallBlocked=ng.isBlockedCell(wc.c,wc.r);
  const oc=ng.worldToCell(0,20); out.openWalkable=!ng.isBlockedCell(oc.c,oc.r);
  // run a live op to ensure enemies path without errors
  g.startMode('operation');
  for(let i=0;i<600;i++){ g.player.health=200; g.player.dead=false; g.update(1/60); }
  out.aliveEnemies=g.enemies.alive; out.state=g.state;
  // count enemies that have an active path
  out.enemiesWithPath=g.enemies.enemies.filter(e=>!e.dead&&e.path&&e.path.length).length;
  return out;
});
console.log('Nav:',JSON.stringify(res,null,1));
await b.close(); console.log('ERRORS:',errors.length,errors.slice(0,5));
process.exit((errors.length||!res.pathOk||!res.wallBlocked||!res.openWalkable)?1:0);
