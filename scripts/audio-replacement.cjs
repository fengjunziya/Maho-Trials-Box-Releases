'use strict';
// Explicit audio revisions may retain IDs only when all authored content is unchanged.
const crypto=require('node:crypto');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
function content(question){
 return {id:question.id,character_id:question.character_id||'Ema',text:question.text,segments:question.segments.map(s=>({
  order:s.order,text:s.text,pose_id:s.pose_id||'',japanese:s.japanese||'',pronunciation:s.pronunciation||'',emotion:s.emotion||'',
  translation_status:s.translation_status||'unverified',provenance:{pose:s.provenance?.pose||null,japanese:s.provenance?.japanese||null}
 }))};
}
const contentHash=q=>crypto.createHash('sha256').update(JSON.stringify(stable(content(q)))).digest('hex');
function validateProof(proof,pack){
 if(!proof||proof.schema_version!==1||!/^questions-[A-Za-z0-9._-]+$/.test(proof.previous_directory)||proof.previous_directory===pack.directory
  ||!/^[a-f0-9]{64}$/.test(proof.previous_content_hash)||!Array.isArray(proof.question_content_hashes)
  ||proof.question_content_hashes.length!==pack.question_ids.length
  ||proof.question_content_hashes.some((v,i)=>!v||v.id!==pack.question_ids[i]||!/^[a-f0-9]{64}$/.test(v.sha256)))throw Error('Invalid audio replacement proof');
 return proof;
}
module.exports={content,contentHash,validateProof};
