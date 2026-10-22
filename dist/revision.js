// The deployed revision is written next to the app by tools/write-revision.mjs; a checkout has none.
const REVISION=/^[0-9a-f]{7,40}\+?$/;

export function parseRevision(text){
  const revision=String(text).trim();
  return REVISION.test(revision)?revision:null;
}

export async function loadRevision(fetcher=globalThis.fetch){
  try{
    const response=await fetcher(new URL('./revision.txt',import.meta.url),{cache:'no-store'});
    return response.ok?parseRevision(await response.text()):null;
  }catch{
    return null;
  }
}
