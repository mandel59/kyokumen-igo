import assert from 'node:assert/strict';
import {createRandom,exploreRoot,sampleVisits} from './selfplay-policy.mjs';
const left=createRandom(7),right=createRandom(7);for(let i=0;i<100;i++)assert.equal(left(),right());
const legal=new Float32Array(161);legal[2]=legal[30]=legal[160]=1;
const policy=new Float32Array(161).fill(-100);policy[2]=3;policy[30]=2;policy[160]=-1;
const repeat=policy.slice();exploreRoot(policy,legal,createRandom(23));exploreRoot(repeat,legal,createRandom(23));assert.deepEqual(policy,repeat);
const sum=[2,30,160].reduce((s,p)=>s+Math.exp(policy[p]),0);assert.ok(Math.abs(sum-1)<1e-6);assert.equal(policy[0],-100);
const visits=new Float32Array(161);visits[2]=.6;visits[30]=.3;visits[160]=.1;
assert.equal(sampleVisits(visits,createRandom(1),0),2);
const random=createRandom(91),counts=new Map();for(let i=0;i<10000;i++){const p=sampleVisits(visits,random,1);counts.set(p,(counts.get(p)??0)+1);}
assert.equal(counts.size,3);assert.ok(Math.abs(counts.get(2)/10000-.6)<.025);assert.ok(Math.abs(counts.get(160)/10000-.1)<.02);
const pass=new Float32Array(161);pass[160]=1;assert.equal(sampleVisits(pass,random,1),160);
console.log('Selfplay: seeded Dirichlet noise, legal support, temperature sampling and exact pass targets passed.');
