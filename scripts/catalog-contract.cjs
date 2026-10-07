'use strict';
// Shared by publisher, studio and client. No Electron or network dependency.
const crypto=require('node:crypto');
const MAX_BUNDLE_BYTES=10*1024*1024,MAX_PACKAGE_BYTES=500_000_000,MAX_AUDIO_BYTES=20_000_000,MAX_MANIFEST_BYTES=5_000_000;
const CONFIG={repository:'fengjunziya/Maho-Trials-Box-Releases',manifest_name:'release-manifest.json',signature_name:'release-manifest.sig',
 trusted_public_key_pem:'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA00nlp8VF7rUozybq8WMbet4osi14h76d+XkDBDcLzTo=\n-----END PUBLIC KEY-----\n'};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function validateManifest(bytes,sig,config=CONFIG){
 if(bytes.length>MAX_MANIFEST_BYTES)throw new Error('更新清单过大');
 if(!config.trusted_public_key_pem||!crypto.verify(null,bytes,config.trusted_public_key_pem,Buffer.from(sig.trim(),'base64')))throw new Error('更新清单签名无效');
 const m=JSON.parse(bytes);
 if(m.schema_version!==1||m.repository!==config.repository||!/^[a-f0-9]{40}$/.test(m.commit)||!Array.isArray(m.packages)||m.packages.length>1000)throw new Error('更新清单格式无效');
 const dirs=new Set(),ids=new Set();let total=0;
 for(const p of m.packages){
  if(!/^questions-[A-Za-z0-9._-]+$/.test(p.directory)||dirs.has(p.directory)||!Array.isArray(p.files)||p.files.length>10000||!Array.isArray(p.question_ids)||p.question_ids.length>1000)throw new Error('问题包目录无效');dirs.add(p.directory);
  for(const id of p.question_ids){if(typeof id!=='string'||!id.trim()||id.length>200||ids.has(id))throw new Error('问题ID为空或重复：'+id);ids.add(id);}
  if(p.audio_replacement)require('./audio-replacement.cjs').validateProof(p.audio_replacement,p);
  if(sha(JSON.stringify(p.files))!==p.content_hash)throw new Error('问题包摘要不匹配');
  const paths=new Set();let size=0;
  for(const f of p.files){const rel=typeof f.path==='string'&&f.path.startsWith(p.directory+'/')?f.path.slice(p.directory.length+1):'';
   if(!(rel==='bundle.json'||/^audio\/[A-Za-z0-9_.-]+\.wav$/.test(rel))||rel.includes('..')||paths.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isInteger(f.size)||f.size<1||f.size>(rel==='bundle.json'?MAX_BUNDLE_BYTES:MAX_AUDIO_BYTES))throw new Error('更新文件路径、大小或哈希无效');paths.add(f.path);size+=f.size;
  }
  if(!paths.has(p.directory+'/bundle.json')||size>MAX_PACKAGE_BYTES)throw new Error('问题包不完整或过大');total+=size;
 }
 if(total>2_000_000_000||ids.size>20000)throw new Error('本次更新总量过大');return m;
}
function createReview(files,at=new Date().toISOString()){
 return {schema_version:1,reviewed_at:at,checks:{character:true,translation:true,audio:true},content_hash:sha(JSON.stringify(files))};
}
function validateReview(review,files){
 if(review?.schema_version!==1||typeof review.reviewed_at!=='string'||!Number.isFinite(Date.parse(review.reviewed_at))||
  ['character','translation','audio'].some(k=>review.checks?.[k]!==true))throw new Error('Missing maintainer review of character, translation or audio');
 if(review.content_hash!==sha(JSON.stringify(files)))throw new Error('Review is stale: bundle or audio changed after review');
 return review;
}
module.exports={MAX_BUNDLE_BYTES,MAX_PACKAGE_BYTES,MAX_AUDIO_BYTES,MAX_MANIFEST_BYTES,CONFIG,sha,validateManifest,createReview,validateReview};
