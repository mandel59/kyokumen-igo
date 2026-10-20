import {Game,chooseMove} from './engine.js';
self.onmessage = ({data}) => { try { const game=Game.fromJSON(data.game); self.postMessage({id:data.id,move:chooseMove(game)}); } catch(e) { self.postMessage({id:data.id,error:e.message}); } };
