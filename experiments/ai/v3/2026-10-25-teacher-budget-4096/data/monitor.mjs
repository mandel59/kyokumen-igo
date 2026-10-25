import fs from 'node:fs';
const d='tools/ai-gnn/target/teacher-budget-4096',p=JSON.parse(fs.readFileSync(d+'/plan.json'));let games=0,finished=0,active=0,failed=0;const boards={};
for(const b of p.boards){boards[b.key]=0;for(const v of p.variants){const base=d+'/'+v+'-'+b.key;try{const r=JSON.parse(fs.readFileSync(base+'.json'));const n=r.boards.reduce((s,b)=>s+b.games.length,0);games+=n;boards[b.key]+=n;}catch{}try{const c=JSON.parse(fs.readFileSync(base+'-command.json'));if(c.exitCode===0)finished++;else if(c.exitCode!==undefined)failed++;else active++;}catch{}}}
console.log(JSON.stringify({games,total:p.totalGames,finishedJobs:finished,activeJobs:active,failedJobs:failed,boards}));
