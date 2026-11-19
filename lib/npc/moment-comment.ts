import {assets} from './contracts';

/** Only canonical, account-scoped upload IDs become comment attachments.
 * The server independently resolves those IDs against the authenticated owner. */
export type MomentCommentMedia=
  | {type:'image';url:string}
  | {type:'voice';url:string;durationSeconds?:number}
  | {type:'sticker';url:string};

export function momentCommentMedia(input:{imageId?:unknown;audioId?:unknown;assetId?:unknown;audioDurationSeconds?:unknown}):MomentCommentMedia|undefined {
  if(typeof input.imageId==='string'&&/^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(input.imageId))return {type:'image',url:'/api/npc/media/'+input.imageId};
  if(typeof input.audioId==='string'&&/^[a-f0-9-]{36}\.(webm|mp4|ogg|wav|mp3)$/.test(input.audioId))return {type:'voice',url:'/api/npc/audio/'+input.audioId,
    ...(typeof input.audioDurationSeconds==='number'&&Number.isInteger(input.audioDurationSeconds)&&input.audioDurationSeconds>=1&&input.audioDurationSeconds<=60?{durationSeconds:input.audioDurationSeconds}:{})};
  if(typeof input.assetId==='string'&&Object.hasOwn(assets,input.assetId)&&assets[input.assetId as keyof typeof assets].kind==='sticker')return {type:'sticker',url:assets[input.assetId as keyof typeof assets].url};
  return undefined;
}
