import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { measurePage } from '../tools/design-harness/modules/geometry/observe.mjs';
import { writeEvidence } from '../tools/design-harness/modules/core/evidence.mjs';
const [stage, name] = process.argv.slice(2);
assert.ok(['before','after'].includes(stage));
assert.match(name || '', /^[a-z][a-z0-9-]+$/);
const directory=path.resolve('artifacts/design',name);
await mkdir(directory);
const now=Date.parse('2026-09-28T14:00:00Z');
const service=(name,hours,running=true)=>({name,cmd:`npm run ${name}`,running,status:running?'ready':'stopped',ready:running,startedAt:new Date(now-hours*3600000).toISOString(),runId:running?`run-${name}`:undefined,port:3000,effectiveUrl:'http://localhost:3000'});
const projects=[
{id:'madebyolof',name:'Made by Olof',root:'/projects/madebyolof',services:[service('web',2),service('worker',30)]},
{id:'looper',name:'YouTube Looper',root:'/projects/youtube-looper',services:[service('web',8)]},
{id:'nova',name:'Nova',root:'/projects/nova',services:[service('api',26)]},
{id:'markdown',name:'Easy Markdown',root:'/projects/markdown-viewer',services:[service('web',50,false)]},
{id:'video',name:'Video experiments',root:'/projects/ai-video-experiments',services:[service('preview',75)]},
{id:'unknown',name:'Older project',root:'/projects/older-project',services:[{name:'worker',cmd:'npm run worker',running:true,status:'ready'}]},
];
const browser=await chromium.launch();
const records={};
try {
for(const [viewport,size] of Object.entries({desktop:{width:1440,height:900},mobile:{width:390,height:844}})) {
 const context=await browser.newContext({viewport:size,reducedMotion:'reduce',timezoneId:'UTC'});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(now);
 await page.route('**/api/**',async route=>{
  assert.equal(route.request().method(),'GET');
  const endpoint=new URL(route.request().url()).pathname;
  const bodies={'/api/state':{projects},'/api/history':{events:[],latestSeq:0},'/api/logs':{output:'Ready on http://localhost:3000\r\n'}};
  assert.ok(bodies[endpoint],endpoint); await route.fulfill({json:bodies[endpoint]});
 });
 await page.routeWebSocket(/\/ws(?:\?|$)/,socket=>{socket.send(JSON.stringify({type:'meta',runId:'run-web'}));socket.send(JSON.stringify({type:'output',data:'Ready on http://localhost:3000\r\n'}));});
 await page.goto(process.env.DESIGN_BASE_URL || 'http://localhost:4317/');
 await page.locator(stage==='before'?'.xterm-screen':'.overview-project').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const scope={id:'landing',root:'body',regions:[{id:'content',selector:stage==='before'?'.workspace-heading':'.overview-project' , multiple: true}]};
 // A bounded first project/header view complements full-page context.
 scope.regions=[{id:'content',selector:stage==='before'?'.workspace-heading':'.overview-project:first-child'}];
 for(const [view,crop] of [['page',undefined],['detail',scope.regions[0].selector]]) {
  const observation=await measurePage(page,scope);
  const basePath=path.join(directory,`${view}-${viewport}`);
  const record=await writeEvidence(page,{basePath,observation,crop,identity:{target:'overview',state:'mixed',viewport},sourceRoot:process.cwd(),details:{data:'Deterministic mixed-runtime fixture; no live writes',stage},issues:errors.map(message=>({type:'browser',message}))});
  assert.equal(record.status,'complete'); assert.equal(observation.diagnostics.horizontalOverflow,0);
  records[`${view}-${viewport}`]=`${basePath}.json`;
 }
 await context.close();
}
await writeFile(path.join(directory,'snapshot.json'),JSON.stringify({status:'passed',records},null,2));
console.log(directory);
}finally{await browser.close();}
