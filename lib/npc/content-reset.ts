/** Local maintenance epochs carry no account credentials or dialogue content. */
export const validContentResetAt=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=8640000000000000;
export const contentResetStorageKey=(accountId:string)=>`zhiyu-content-reset-applied-v1:${accountId}`;
export function accountContentResetAt(value:unknown,accountId:string):number|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||!accountId)return;
 const marker=value as {version?:unknown;accounts?:unknown};
 if(marker.version!==1||!marker.accounts||typeof marker.accounts!=='object'||Array.isArray(marker.accounts))return;
 const at=Object.hasOwn(marker.accounts,accountId)?(marker.accounts as Record<string,unknown>)[accountId]:undefined;
 return validContentResetAt(at)?at:undefined;
}
