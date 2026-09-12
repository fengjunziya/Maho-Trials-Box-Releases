// Maintainer publishing tool. No third-party dependencies; never logs secrets.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.cwd(),out=process.env.CATALOG_OUTPUT;
const fail=m=>{throw new Error(m);},sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function read(name,max){const p=path.join(root,name);if(fs.lstatSync(p).isSymbolicLink()||!fs.statSync(p).isFile())fail('Not a regular file: '+name);if(fs.statSync(p).size>max)fail('File too large: '+name);const b=fs.readFileSync(p);if(b.length>max)fail('File too large: '+name);return b;}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function wav(b,name){if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)fail('Invalid WAV: '+name);let n=12,fmt=false,data=false;while(n+8<=b.length){const id=b.toString('ascii',n,n+4),size=b.readUInt32LE(n+4);n+=8;if(n+size>b.length)fail('Truncated WAV: '+name);if(id==='fmt ')fmt=size>=16&&[1,3].includes(b.readUInt16LE(n));if(id==='data')data=size>0;n+=size+(size%2);}if(!fmt||!data||n!==b.length)fail('Incomplete WAV: '+name);}
function main(){
 const repository=process.env.GITHUB_REPOSITORY,commit=process.env.GITHUB_SHA;
 if(repository!=='fengjunziya/Maho-Trials-Box-Releases'||!/^[a-f0-9]{40}$/.test(commit||''))fail('Unexpected repository or commit');
 if(!out)fail('CATALOG_OUTPUT required');
 const poses=new Set(JSON.parse(read('scripts/pose-ids.json',100000)));
 const packages=[],ids=new Map();
 for(const dir of fs.readdirSync(root).filter(n=>/^questions-[A-Za-z0-9._-]+$/.test(n)).sort()){
  if(fs.lstatSync(dir).isSymbolicLink()||!fs.statSync(dir).isDirectory())fail('Invalid package directory');
  if(fs.existsSync(path.join(dir,'audio'))&&fs.lstatSync(path.join(dir,'audio')).isSymbolicLink())fail('Audio symlink directory');
  for(const name of fs.readdirSync(dir))if(!['bundle.json','audio'].includes(name))fail('Unexpected package entry: '+dir+'/'+name);
  const source=dir+'/bundle.json',bytes=read(source,1500000),bundle=JSON.parse(bytes),questions=Array.isArray(bundle)?bundle:bundle.questions;
  if(!Array.isArray(questions)||!questions.length||questions.length>1000)fail('Invalid questions: '+dir);
  const files=[{path:source,size:bytes.length,sha256:sha(bytes)}],localIds=new Set(),used=new Set();let total=bytes.length;
  for(const q of questions){
   if(typeof q.id!=='string'||!q.id.trim()||q.id.length>200||localIds.has(q.id))fail('Duplicate/invalid ID: '+dir);localIds.add(q.id);
   if(q.character_id&&q.character_id!=='Ema')fail('Unsupported character');
   if(typeof q.text!=='string'||!q.text.trim()||q.text.length>10000||!Array.isArray(q.segments)||!q.segments.length||q.segments.length>100)fail('Invalid question: '+q.id);
   if(q.segments.map(s=>s.text).join('')!==q.text)fail('Segments differ from text: '+q.id);
   const normalized=[];
   for(const [i,s]of q.segments.entries()){
    if(s.order!==i||typeof s.text!=='string'||!s.text.trim()||!poses.has(s.pose_id)||typeof s.japanese!=='string'||!s.japanese.trim())fail('Incomplete segment: '+q.id+'/'+i);
    if(typeof s.audio_file!=='string'||!/^audio\/[A-Za-z0-9_.-]+\.wav$/.test(s.audio_file)||s.audio_file.includes('..'))fail('Audio missing/unsafe: '+q.id+'/'+i);
    const file=dir+'/'+s.audio_file,b=read(file,20000000);wav(b,file);const hash=sha(b),name=path.basename(s.audio_file,'.wav');if(/^[a-f0-9]{64}$/.test(name)&&hash!==name)fail('Audio hash mismatch');
    if(!used.has(file)){used.add(file);files.push({path:file,size:b.length,sha256:hash});total+=b.length;}
    normalized.push({text:s.text,pose_id:s.pose_id,japanese:s.japanese,audio_sha256:hash});
   }
   const identity=sha(JSON.stringify(canonical({text:q.text,segments:normalized})));if(ids.has(q.id)&&ids.get(q.id)!==identity)fail('Conflicting question ID: '+q.id);ids.set(q.id,identity);
  }
  if(fs.existsSync(path.join(dir,'audio'))){if(fs.lstatSync(path.join(dir,'audio')).isSymbolicLink())fail('Audio symlink directory');for(const name of fs.readdirSync(path.join(dir,'audio')))if(!used.has(dir+'/audio/'+name))fail('Unreferenced or unexpected audio: '+dir+'/audio/'+name);}
  if(total>500000000)fail('Package exceeds 500MB');
  files.sort((a,b)=>a.path.localeCompare(b.path));packages.push({directory:dir,question_ids:[...localIds],content_hash:sha(JSON.stringify(files)),files});
 }
 if(!packages.length)fail('No complete questions-* packages found');
 const manifest=Buffer.from(JSON.stringify({schema_version:1,repository,commit,published_at:new Date().toISOString(),packages}));
 const privateKey=crypto.createPrivateKey(process.env.QUESTION_SIGNING_PRIVATE_KEY||'');if(privateKey.asymmetricKeyType!=='ed25519')fail('Ed25519 signing key required');
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'release-manifest.json'),manifest);fs.writeFileSync(path.join(out,'release-manifest.sig'),crypto.sign(null,manifest,privateKey).toString('base64'));
 console.log('Validated '+packages.length+' packages, '+ids.size+' unique questions.');
}
try{main();}catch(e){console.error('Catalog build failed: '+(e.message.includes('key')?'Signing key configuration invalid':e.message));process.exitCode=1;}
