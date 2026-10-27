// GTP vertices for the plane boards. The plane's point u*size+v sits at column u and row v counted
// from the top (as in the 俯瞰図); GTP letters skip I and count rows from the bottom.
const COLUMNS='ABCDEFGHJKLMNOPQRST';
export const toVertex=(point,size)=>point===null?'pass':COLUMNS[Math.floor(point/size)]+(size-point%size);
export function fromVertex(text,size){
  if(/^pass$/i.test(text))return null;
  const m=/^([A-HJ-T])(\d{1,2})$/i.exec(text),u=m?COLUMNS.indexOf(m[1].toUpperCase()):-1,row=m?Number(m[2]):0;
  if(u<0||u>=size||row<1||row>size)throw new Error('invalid vertex');
  return u*size+(size-row);
}
