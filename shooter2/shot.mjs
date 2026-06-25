import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors=[];
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--window-size=1280,800']});
const p=await b.newPage(); await p.setViewport({width:1280,height:800});
p.on('pageerror',e=>errors.push('PE:'+e.message)); p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await p.goto('http://localhost:4173/',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,700));
await p.evaluate(()=>{const{game,input}=window.__bp;input.locked=true;game.startMode('survival');});
await new Promise(r=>setTimeout(r,400));
await p.evaluate(()=>{const g=window.__bp.game;g.player.pos.set(8,0,6);g.player.yaw=Math.PI*0.7;g.player.pitch=0;for(let i=0;i<30;i++)g.update(1/60);g.scene.updateMatrixWorld(true);
  // trigger a muzzle flash + tracer for the shot
  window.__bp.input.buttons.left=true;window.__bp.input.mousePressed.left=true;g.update(1/60);g.scene.updateMatrixWorld(true);});
await new Promise(r=>setTimeout(r,200));
await p.screenshot({path:'shot-bloom.png'});
await b.close(); console.log('errors:',errors.length,errors.slice(0,4));
