import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors=[];
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox']});
const p=await b.newPage();
p.on('pageerror',e=>errors.push('PE:'+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await p.goto('http://localhost:4173/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,500));
const res=await p.evaluate(()=>{
  const g=window.__bp.game; const out={};
  g.startMode('survival');
  // force-spawn one of each new type to exercise their code paths
  const T=window.__bp; 
  g._spawnEnemy('sniper'); g._spawnEnemy('titan'); g._spawnEnemy('heavy');
  out.bossSet=!!g.boss && g.boss.def.name==='TITAN';
  let grenadesSeen=0, lasersSeen=0;
  for(let i=0;i<1500;i++){
    g.player.health=300; g.player.dead=false;
    g.update(1/60);
    grenadesSeen=Math.max(grenadesSeen,g.enemies.enemyGrenades.length);
    const sn=g.enemies.enemies.find(e=>e.def.sniper&&!e.dead);
    if(sn&&sn.charging>0.1) lasersSeen++;
  }
  out.grenadesSeen=grenadesSeen; out.laserChargeFrames=lasersSeen;
  out.bossAlive=g.boss && !g.boss.dead; out.bossHp=g.boss?Math.round(g.boss.health):null;
  out.alive=g.enemies.alive;
  return out;
});
console.log('AI features:',JSON.stringify(res,null,1));
await b.close(); console.log('ERRORS:',errors.length,errors.slice(0,6));
process.exit(errors.length?1:0);
