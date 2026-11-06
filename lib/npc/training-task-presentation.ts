/** A read-only compatibility view for explicitly labelled cues in old titles.
 * Normal exercise qualifiers (equipment, grip, stance, warm-up) are not prose
 * classifiers and must remain part of the exercise name. */
export function trainingTitlePresentation(value:string,training=true):{title:string;cues:string[]} {
  if(!training)return {title:value,cues:[]};
  const marker=/(?:[\s·|｜;；:：—–（(])(?:动作要点|技术要点|动作提示|要点)\s*[:：]\s*/u.exec(value);
  if(!marker)return {title:value,cues:[]};
  const title=value.slice(0,marker.index).trim().replace(/[\s·|｜;；:：—–]+$/u,'');
  let tail=value.slice(marker.index+marker[0].length).trim();
  if(/^[（(]/u.test(marker[0]))tail=tail.replace(/[）)]\s*$/u,'').trim();
  if(!title||!tail)return {title:value,cues:[]};
  return {title,cues:tail.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean)};
}
