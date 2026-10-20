export const KOMI_MIN=0,KOMI_MAX=9.5,KOMI_STEP=.5;
export const KOMI_VALUES=Array.from({length:(KOMI_MAX-KOMI_MIN)/KOMI_STEP+1},(_,i)=>KOMI_MIN+i*KOMI_STEP);
export const isValidKomi=value=>Number.isFinite(value)&&value>=KOMI_MIN&&value<=KOMI_MAX&&Number.isInteger(value/KOMI_STEP);
