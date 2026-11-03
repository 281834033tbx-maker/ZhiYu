import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {createMolly} from '../../lib/npc/molly';
import {scheduleDelivery} from '../../lib/npc/delivery';
import type {MollyState} from '../../lib/npc/molly';

/** Called only by successful new-account registration, inside its transaction. */
export function initializeNewAccountOpening(db:DatabaseSync,root:string,owner:string,now:number,claimedLegacy=false):boolean {
 db.exec('CREATE TABLE IF NOT EXISTS npc_experience_onboarding(owner TEXT PRIMARY KEY,at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
 if(claimedLegacy||db.prepare('SELECT 1 FROM npc_experience_onboarding WHERE owner=?').get(owner))return false;
 const key=`${owner}:molly-system-secretary`,row=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(key) as {data:string}|undefined;
 const state:MollyState=row?JSON.parse(row.data):createMolly();
 // A retained/imported real conversation is never treated as a first visit.
 if(state.messages.length){db.prepare('INSERT OR IGNORE INTO npc_experience_onboarding VALUES(?,?)').run(owner,now);return false;}
 const raw=JSON.parse(readFileSync(join(root,'npc-skills/skills/zhiyu-dialogue/npcs/molly/opening.json'),'utf8')) as {messages?:unknown};
 if(!Array.isArray(raw.messages)||raw.messages.length!==3||raw.messages.some(text=>typeof text!=='string'||!text.trim()||text.length>200))throw Error('Opening configuration invalid');
 for(const [index,text] of raw.messages.entries())state.messages.push({id:`molly-opening-${index+1}`,turnId:'molly-opening-v1',role:'assistant',at:new Date(now).toISOString(),origin:'proactive',part:{type:'text',text},secretaryEvent:{id:`opening:v1:${index}`,kind:'opening'}});
 scheduleDelivery(state.messages,0,now,now,{characterId:'molly'});state.revision=(state.revision||0)+1;
 db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES(?,?)').run(key,JSON.stringify(state));
 db.prepare('INSERT INTO npc_experience_onboarding VALUES(?,?)').run(owner,now);return true;
}
