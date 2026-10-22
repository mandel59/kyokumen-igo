// Which AI plays is the viewer's choice on this device, saved apart from any game.
export const AI_CHOICE_KEY='surface-go:ai:v1';
export const AI_CHOICES=['v2','v3'];
export const DEFAULT_AI='v2';

export function normalizeAIChoice(data){
  return typeof data?.ai==='string'&&AI_CHOICES.includes(data.ai)?data.ai:DEFAULT_AI;
}

export function loadAIChoice(storage){
  try{
    storage??=window.localStorage;
    const raw=storage.getItem(AI_CHOICE_KEY);
    return normalizeAIChoice(raw===null?null:JSON.parse(raw));
  }catch{
    return DEFAULT_AI;
  }
}

export function saveAIChoice(ai,storage){
  try{
    storage??=window.localStorage;
    storage.setItem(AI_CHOICE_KEY,JSON.stringify({ai:normalizeAIChoice({ai})}));
    return true;
  }catch{
    return false;
  }
}
