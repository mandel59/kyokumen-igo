// Which build is deployed: tools/write-build-info.mjs writes dist/build-info.json at deploy time; a checkout has none.
const REVISION=/^[0-9a-f]{7,40}\+?$/, DATE=/^\d{4}-\d{2}-\d{2}$/;

// Only a bare hash and a plain date are accepted; anything else (an error page, say) shows nothing.
export function parseBuildInfo(text){
  try{
    const {revision,deployed}=JSON.parse(text);
    return typeof revision==='string'&&REVISION.test(revision)&&typeof deployed==='string'&&DATE.test(deployed)?{revision,deployed}:null;
  }catch{
    return null;
  }
}

export async function loadBuildInfo(fetcher=globalThis.fetch){
  try{
    const response=await fetcher(new URL('./build-info.json',import.meta.url),{cache:'no-store'});
    return response.ok?parseBuildInfo(await response.text()):null;
  }catch{
    return null;
  }
}
