// Maintainer publishing tool. No third-party dependencies; never logs secrets.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {CONFIG,MAX_BUNDLE_BYTES,MAX_AUDIO_BYTES,MAX_PACKAGE_BYTES,MAX_MANIFEST_BYTES,sha,validateManifest,validateReview}=require('./catalog-contract.cjs');
const fail=m=>{throw new Error(m);};
function read(root,name,max){
 const file=path.join(root,name),stat=fs.lstatSync(file);
 if(stat.isSymbolicLink()||!stat.isFile())fail('Not a regular file: '+name);
 if(stat.size>max)fail('File too large ('+max+' bytes maximum): '+name);
 const bytes=fs.readFileSync(file);if(bytes.length>max)fail('File too large: '+name);return bytes;
}
function wav(b,name){
 if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)fail('Invalid WAV: '+name);
 let n=12,fmt=false,data=false;
 while(n+8<=b.length){const id=b.toString('ascii',n,n+4),size=b.readUInt32LE(n+4);n+=8;if(n+size>b.length)fail('Truncated WAV: '+name);if(id==='fmt ')fmt=size>=16&&[1,3].includes(b.readUInt16LE(n))&&b.readUInt16LE(n+2)>0&&b.readUInt32LE(n+4)>0;if(id==='data')data=size>0;n+=size+(size%2);}
 if(!fmt||!data||n!==b.length)fail('Incomplete WAV: '+name);
}
async function download(url,max,fetcher=fetch){
 for(let redirects=0;redirects<6;redirects++){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||!['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))fail('Unsafe catalog URL');
  const reply=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if([301,302,303,307,308].includes(reply.status)){const location=reply.headers.get('location');await reply.body?.cancel();if(!location)fail('Missing redirect URL');url=new URL(location,url).href;continue;}
  if(!reply.ok){await reply.body?.cancel();fail('Published catalog download failed: HTTP '+reply.status);}
  const chunks=[];let size=0;
  for await(const chunk of reply.body){size+=chunk.length;if(size>max)fail('Published catalog exceeds size limit');chunks.push(chunk);}
  return Buffer.concat(chunks);
 }
 fail('Too many catalog redirects');
}
async function syncPublished(config=CONFIG,fetcher=fetch){
 const base='https://github.com/'+config.repository+'/releases/latest/download/';
 const bytes=await download(base+config.manifest_name,MAX_MANIFEST_BYTES,fetcher);
 const signature=(await download(base+config.signature_name,4096,fetcher)).toString('utf8');
 const manifest=validateManifest(bytes,signature,config),questions=new Map();
 for(const pack of manifest.packages){
  const entry=pack.files.find(f=>f.path===pack.directory+'/bundle.json');
  const url='https://raw.githubusercontent.com/'+config.repository+'/'+manifest.commit+'/'+entry.path.split('/').map(encodeURIComponent).join('/');
  const raw=await download(url,entry.size,fetcher);
  if(raw.length!==entry.size||sha(raw)!==entry.sha256)fail('Published question hash mismatch: '+entry.path);
  const value=JSON.parse(raw),items=Array.isArray(value)?value:value.questions;
  if(!Array.isArray(items)||JSON.stringify(items.map(q=>q.id))!==JSON.stringify(pack.question_ids))fail('Published question IDs differ from manifest: '+entry.path);
  for(const [index,q]of items.entries()){
   if(typeof q.text!=='string'||!q.text.trim()||q.text.length>10000)fail('Invalid published question text: '+q.id);
   questions.set(q.id,{package:pack.directory,bundle:entry.path,index,text:q.text,question:q});
  }
 }
 return {manifest,questions,packages:new Map(manifest.packages.map(p=>[p.directory,p]))};
}
function scan(root){
 const poses=new Set(JSON.parse(read(root,'scripts/pose-ids.json',100000))),packages=[];
 for(const dir of fs.readdirSync(root).filter(n=>/^questions-[A-Za-z0-9._-]+$/.test(n)).sort()){
  const folder=path.join(root,dir),stat=fs.lstatSync(folder);
  if(stat.isSymbolicLink()||!stat.isDirectory())fail('Invalid package directory: '+dir);
  if(fs.existsSync(path.join(folder,'audio'))&&fs.lstatSync(path.join(folder,'audio')).isSymbolicLink())fail('Audio symlink directory: '+dir);
  for(const name of fs.readdirSync(folder))if(!['bundle.json','audio','review.json'].includes(name))fail('Unexpected package entry: '+dir+'/'+name);
  const source=dir+'/bundle.json',bytes=read(root,source,MAX_BUNDLE_BYTES),bundle=JSON.parse(bytes),questions=Array.isArray(bundle)?bundle:bundle.questions;
  if(!Array.isArray(questions)||!questions.length||questions.length>1000)fail('Invalid questions: '+dir);
  const files=[{path:source,size:bytes.length,sha256:sha(bytes)}],used=new Set();let total=bytes.length;
  for(const q of questions){
   if(!q||typeof q.id!=='string'||!q.id.trim()||q.id.length>200)fail('Invalid question ID: '+dir);
   if(q.character_id&&q.character_id!=='Ema')fail('Unsupported character');
   if(typeof q.text!=='string'||!q.text.trim()||q.text.length>10000||!Array.isArray(q.segments)||!q.segments.length||q.segments.length>100)fail('Invalid question: '+q.id);
   if(q.segments.some(s=>!s)||q.segments.map(s=>s.text).join('')!==q.text)fail('Segments differ from text: '+q.id);
   for(const [i,s]of q.segments.entries()){
    if(s.order!==i||typeof s.text!=='string'||!s.text.trim()||!poses.has(s.pose_id)||typeof s.japanese!=='string'||!s.japanese.trim())fail('Incomplete segment: '+q.id+'/'+i);
    if(typeof s.audio_file!=='string'||!/^audio\/[A-Za-z0-9_.-]+\.wav$/.test(s.audio_file)||s.audio_file.includes('..'))fail('Audio missing/unsafe: '+q.id+'/'+i);
    const file=dir+'/'+s.audio_file,b=read(root,file,MAX_AUDIO_BYTES);wav(b,file);const hash=sha(b),name=path.basename(s.audio_file,'.wav');if(/^[a-f0-9]{64}$/.test(name)&&hash!==name)fail('Audio hash mismatch: '+file);
    if(!used.has(file)){used.add(file);files.push({path:file,size:b.length,sha256:hash});total+=b.length;}
   }
  }
  if(fs.existsSync(path.join(folder,'audio')))for(const name of fs.readdirSync(path.join(folder,'audio')))if(!used.has(dir+'/audio/'+name))fail('Unreferenced or unexpected audio: '+dir+'/audio/'+name);
  if(total>MAX_PACKAGE_BYTES)fail('Package exceeds 500 MB: '+dir);
  files.sort((a,b)=>a.path.localeCompare(b.path));
  packages.push({directory:dir,question_ids:questions.map(q=>q.id),content_hash:sha(JSON.stringify(files)),files,questions});
 }
 if(!packages.length)fail('No complete questions-* packages found');return packages;
}
function prepareReplacements(root,packages,published){
 const file=path.join(root,'audio-replacements.json'),accepted=new Map();
 if(!fs.existsSync(file))return accepted;
 const plan=JSON.parse(read(root,'audio-replacements.json',100000));
 if(plan?.schema_version!==1||!/^[a-f0-9]{40}$/.test(plan.published_commit)||!Array.isArray(plan.replacements)||!plan.replacements.length||plan.replacements.length>1000)fail('Invalid audio replacement plan');
 const seenOld=new Set(),seenNew=new Set(),{contentHash,validateProof}=require('./audio-replacement.cjs');
 for(const change of plan.replacements){
  if(!change||!/^questions-[A-Za-z0-9._-]+$/.test(change.old_directory)||!/^questions-[A-Za-z0-9._-]+$/.test(change.new_directory)||change.old_directory===change.new_directory
   ||!/^[a-f0-9]{64}$/.test(change.old_content_hash)||seenOld.has(change.old_directory)||seenNew.has(change.new_directory))fail('Invalid or duplicate audio replacement');
  seenOld.add(change.old_directory);seenNew.add(change.new_directory);
  const target=packages.find(p=>p.directory===change.new_directory),old=published.packages.get(change.old_directory),retained=published.packages.get(change.new_directory);
  if(!target||packages.some(p=>p.directory===change.old_directory))fail('Audio replacement must remove its old package and include its new package');
  if(!old&&retained?.content_hash===target.content_hash&&retained.audio_replacement?.previous_directory===change.old_directory&&retained.audio_replacement.previous_content_hash===change.old_content_hash){
   target.audio_replacement=validateProof(retained.audio_replacement,target);continue;
  }
  if(plan.published_commit!==published.manifest.commit||!old||old.content_hash!==change.old_content_hash||retained)fail('Audio replacement baseline is stale or unknown');
  if(JSON.stringify(old.question_ids)!==JSON.stringify(target.question_ids))fail('Audio replacement changed question IDs or order');
  const hashes=[];
  for(const q of target.questions){
   const prior=published.questions.get(q.id);if(!prior||prior.package!==old.directory||contentHash(prior.question)!==contentHash(q))fail('Audio replacement changed authored content: '+q.id);
   if(q.segments.some((s,i)=>s.audio_file===prior.question.segments[i].audio_file))fail('Audio replacement contains unchanged old audio: '+q.id);
   hashes.push({id:q.id,sha256:contentHash(q)});
  }
  target.audio_replacement=validateProof({schema_version:1,previous_directory:old.directory,previous_content_hash:old.content_hash,question_content_hashes:hashes},target);
  accepted.set(old.directory,target.directory);
 }
 return accepted;
}
function conflictsFor(packages,published,replacements=new Map()){
 const conflicts=[],seen=new Map(),current=new Map(packages.map(p=>[p.directory,p]));
 for(const old of published.manifest.packages)if(!current.has(old.directory)&&!replacements.has(old.directory))conflicts.push({type:'removed_published_package',existing_package:old.directory,question_ids:old.question_ids});
 for(const pack of packages){
  const old=published.packages.get(pack.directory),retained=old?.content_hash===pack.content_hash;
  if(old&&!retained)conflicts.push({type:'changed_published_package',existing_package:pack.directory,existing_content_hash:old.content_hash,incoming_content_hash:pack.content_hash});
  for(const [index,q]of pack.questions.entries()){
   const incoming={package:pack.directory,bundle:pack.directory+'/bundle.json',index,text:q.text};
   if(seen.has(q.id))conflicts.push({type:'duplicate_upload_id',question_id:q.id,existing:seen.get(q.id),incoming});
   else seen.set(q.id,incoming);
   const existing=published.questions.get(q.id);
   if(existing&&!retained&&replacements.get(existing.package)!==pack.directory){const {question,...location}=existing;conflicts.push({type:'published_id_conflict',question_id:q.id,existing:location,incoming});}
  }
 }
 return conflicts;
}
function reportConflicts(output,published,conflicts){
 const report={schema_version:1,repository:published.manifest.repository,published_commit:published.manifest.commit,conflict_count:conflicts.length,conflicts};
 if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'catalog-conflicts.json'),JSON.stringify(report,null,2));}
 console.error('Catalog conflicts:\n'+JSON.stringify(report,null,2));return report;
}
async function build({root=process.cwd(),output,repository,commit,privateKey,checkOnly=false,config=CONFIG,fetcher=fetch}={}){
 if(repository!==CONFIG.repository||config.repository!==repository||!/^[a-f0-9]{40}$/.test(commit||''))fail('Unexpected repository or commit');
 if(!output)fail('CATALOG_OUTPUT required');
 // Failed sync is never interpreted as an empty library. Only signed data counts.
 const published=await syncPublished(config,fetcher),packages=scan(root);
 const replacements=prepareReplacements(root,packages,published),conflicts=conflictsFor(packages,published,replacements);
 if(conflicts.length){const error=new Error('Question catalog conflicts: '+conflicts.length);error.report=reportConflicts(output,published,conflicts);throw error;}
 for(const pack of packages){
  const old=published.packages.get(pack.directory);
  if(old?.content_hash===pack.content_hash){for(const key of ['reviewed_at','review_sha256','audio_replacement'])if(old[key])pack[key]=old[key];continue;}
  const reviewBytes=read(root,pack.directory+'/review.json',20000);
  const files=pack.files.map(f=>({...f,path:f.path.slice(pack.directory.length+1)})).sort((a,b)=>a.path.localeCompare(b.path));
  const review=validateReview(JSON.parse(reviewBytes),files);pack.reviewed_at=review.reviewed_at;pack.review_sha256=sha(reviewBytes);
 }
 const manifest=Buffer.from(JSON.stringify({schema_version:1,repository,commit,published_at:new Date().toISOString(),packages:packages.map(({questions,...pack})=>pack)}));
 if(manifest.length>MAX_MANIFEST_BYTES)fail('Catalog manifest exceeds client limit');
 const totals={packages:packages.length,questions:packages.reduce((n,p)=>n+p.question_ids.length,0),published_commit:published.manifest.commit};
 if(packages.length>1000||totals.questions>20000||packages.reduce((n,p)=>n+p.files.reduce((a,f)=>a+f.size,0),0)>2_000_000_000)fail('Catalog exceeds client limits');
 if(checkOnly)return totals;
 let key;try{key=crypto.createPrivateKey(privateKey||'');if(key.asymmetricKeyType!=='ed25519')fail('Invalid signing key');
  if(!crypto.createPublicKey(key).export({type:'spki',format:'der'}).equals(crypto.createPublicKey(config.trusted_public_key_pem).export({type:'spki',format:'der'})))fail('Invalid signing key');
 }catch{fail('Signing key configuration invalid');}
 const signature=crypto.sign(null,manifest,key).toString('base64');validateManifest(manifest,signature,config);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'release-manifest.json'),manifest);fs.writeFileSync(path.join(output,'release-manifest.sig'),signature);
 return totals;
}
if(require.main===module)build({output:process.env.CATALOG_OUTPUT,repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,privateKey:process.env.QUESTION_SIGNING_PRIVATE_KEY,checkOnly:process.argv.includes('--check')})
 .then(result=>console.log('Catalog checks passed: '+JSON.stringify(result))).catch(error=>{console.error('Catalog build failed: '+error.message);process.exitCode=1;});
module.exports={build,syncPublished,scan,conflictsFor,download,prepareReplacements};
