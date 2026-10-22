// Builds the SNS share card and icons from the app's own surface renderer.
// Requires ImageMagick 7 (`magick`) with Pango and the Noto Sans JP font; usage: node tools/social-card.mjs
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTopology,Game} from '../dist/engine.js';
import {chooseMove} from './ai-tuner/legacy-v1.mjs';
import {renderSurface} from '../dist/surface-renderer.js';

const dist=new URL('../dist/',import.meta.url),out=name=>new URL(name,dist).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const font=process.env.CARD_FONT||'Noto Sans JP';
const tmp=mkdtempSync(join(tmpdir(),'kyokugo-card-'));

// Deterministic AI self-play so the boards look like a game in progress.
// Mulberry32: Tommy Ettinger; JavaScript form by bryc (public domain).
// Adapted to our seeded closure; see dist/licenses/Mulberry32-NOTICE.txt.
function seeded(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function position(kind,size,moves,seed){const game=new Game(createTopology(kind,size)),random=seeded(seed);while(game.moves<moves&&!game.ended){const move=chooseMove(game,{random});if(move==null||move<0)game.pass();else game.play(move);}return game;}

// Supersampled render, written as PAM (RGBA) for ImageMagick.
function layer(name,game,rotation,size,ss=2){
 const w=size*ss,frame=renderSurface({topology:game.topology,board:game.board,lastMove:game.lastMove,rotX:rotation[0],rotY:rotation[1],width:w,height:w,scale:w*.41,centerX:w/2,centerY:w/2,pixelRatio:ss});
 const file=join(tmp,name+'.pam');writeFileSync(file,Buffer.concat([Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${w}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),Buffer.from(frame.pixels.buffer)]));
 return file;
}
// Pango picks weights from variable fonts, which plain -font rendering cannot.
const text=(value,px,weight,color,x,y)=>['(','-background','none','-density','72',`pango:<span font_family="${font}" weight="${weight}" size="${px*1024}" foreground="${color}">${value}</span>`,')','-geometry',`+${x}+${y}`,'-composite'];
const magick=(...args)=>execFileSync('magick',args,{stdio:'inherit'});

const sphere=layer('sphere',position('sphere',4,46,7),[.75,.62],600);
magick('-size','1200x630','xc:#102b2b',
 '(',sphere,'-resize','600x600',')','-geometry','+590+15','-composite',
 ...text('曲面囲碁',104,700,'#edece0',70,118),
 ...text('球面とトーラスで遊ぶ囲碁',40,500,'#dcc18b',76,288),
 ...text('回転できる立体盤 · ローカル AI 対局',28,400,'#a0b3ac',76,360),
 ...text('kyokugo.ryusei.dev',26,400,'#a0b3ac',76,530),
 '-strip',out('og-image.png'));

// Icons: a sphere board on the app background; favicon.ico is downscaled from a 512px master.
const icon=layer('icon',position('sphere',3,24,3),[.75,.62],180,4);
magick('-size','180x180','xc:#102b2b','(',icon,'-resize','176x176',')','-geometry','+2+2','-composite','-strip',out('apple-touch-icon.png'));
magick('-size','512x512','xc:#102b2b','(',icon,'-resize','480x480',')','-geometry','+16+16','-composite',join(tmp,'icon-512.png'));
magick(join(tmp,'icon-512.png'),'-define','icon:auto-resize=48,32,16',out('favicon.ico'));
rmSync(tmp,{recursive:true,force:true});
console.log('Wrote og-image.png, apple-touch-icon.png, favicon.ico to dist/');
