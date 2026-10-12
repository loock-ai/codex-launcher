const {existsSync,renameSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
function resolveConfigDirectory(home,appData,explicit){
  if(explicit)return explicit;
  const destination=join(home,'.codex-launcher');
  const legacy=join(appData,'codex-mobile');
  if(!existsSync(destination)&&existsSync(legacy)){
    mkdirSync(home,{recursive:true});
    renameSync(legacy,destination);
  }
  return destination;
}
module.exports={resolveConfigDirectory};
