import type {ArrangementItem} from '../../lib/npc/arrangement-types';

export type MollyPurchaseGroup={id:string;title:string;source:string;lines:string[]};

/** Active purchase arrangements Molly already saved. Board demo tasks are not included. */
export function mollyPurchaseGroups(items:readonly ArrangementItem[]):MollyPurchaseGroup[] {
  return items.filter(item=>item.section==='purchase'&&item.status==='active').map(item=>{
    const lines=(item.details.items||[]).map(name=>name.trim()).filter(Boolean);
    return {id:item.id,title:item.title.trim()||'采购',source:item.sourceText.trim(),lines:lines.length?lines:[item.title.trim()||'采购']};
  });
}

export function purchaseCheckKey(groupId:string,index:number){return `${groupId}:${index}`;}

export function purchaseGroupComplete(group:MollyPurchaseGroup,checked:ReadonlySet<string>) {
  return group.lines.length>0&&group.lines.every((_,index)=>checked.has(purchaseCheckKey(group.id,index)));
}

export function mollyPurchasePlainText(groups:readonly MollyPurchaseGroup[]) {
  if(!groups.length)return 'Molly 采购\n还没有要买的东西';
  return ['Molly 采购',...groups.flatMap(group=>[group.title,...group.lines.map(line=>`· ${line}`),group.source?`来源：${group.source}`:''].filter(Boolean))].join('\n');
}
