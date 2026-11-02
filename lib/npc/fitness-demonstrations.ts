import type {ProfessionalTaskStepContent} from './professional-task';

/** Original schematic geometry, never an author's footage or a movement assessment. */
export type FitnessPoint = readonly [number, number];
export type FitnessPose = {
  head: FitnessPoint; shoulder: FitnessPoint; hip: FitnessPoint;
  elbow: FitnessPoint; hand: FitnessPoint; knee: FitnessPoint; ankle: FitnessPoint;
  otherElbow?: FitnessPoint; otherHand?: FitnessPoint; torsoCurve?: string; toe?: FitnessPoint;
};
export type FitnessDemonstration = {
  id: string; title: string; aliases: readonly string[]; equipment: readonly string[];
  start: FitnessPose; finish: FitnessPose; error: FitnessPose;
  arrow: string; load?: 'dumbbell'; cableAnchor?: FitnessPoint;
  preparation: string; movement: string; mistake: string; conditions: string;
  source?: {url: string; context: string};
};
const upright: FitnessPose={head:[120,48],shoulder:[120,72],hip:[120,150],elbow:[143,105],hand:[149,132],knee:[170,167],ankle:[174,210]};
const standing: FitnessPose={head:[134,32],shoulder:[134,57],hip:[134,126],elbow:[145,86],hand:[148,117],knee:[139,168],ankle:[138,209]};
const seat=['M 87 78 L 87 153 L 150 153','M 102 153 L 102 211 M 143 153 L 143 211'];
const stand=['M 240 89 L 240 211 M 225 89 L 255 89'];

export const fitnessDemonstrations: readonly FitnessDemonstration[]=[
  {
    id:'incline_db_press',title:'上斜哑铃卧推',aliases:['上斜哑铃卧推','上斜哑铃推胸'],
    equipment:['M 85 89 L 159 161 L 190 161','M 124 128 L 124 211 M 175 161 L 175 211'],
    start:{head:[92,67],shoulder:[110,95],hip:[159,152],elbow:[109,132],hand:[134,103],knee:[211,164],ankle:[224,210]},
    finish:{head:[92,67],shoulder:[110,95],hip:[159,152],elbow:[120,59],hand:[134,24],knee:[211,164],ankle:[224,210]},
    error:{head:[99,51],shoulder:[122,81],hip:[160,138],elbow:[122,51],hand:[137,24],knee:[211,164],ankle:[224,210],torsoCurve:'M 122 81 Q 170 94 160 138'},
    arrow:'M 167 92 L 170 39',load:'dumbbell',
    preparation:'凳子稳固，双脚踩稳；先握牢哑铃，背部和臀部有可靠支撑。',
    movement:'在能控制的幅度内推起，再平稳回到起点；图只显示一侧手臂。',
    mistake:'抬臀或明显挺腰抢次数；失去支撑时先停下。',
    conditions:'仅示意上斜哑铃版本。凳角、肘轨迹和活动幅度须适配；需能安全拿起与放下哑铃。',
    source:{url:'https://www.bilibili.com/video/BV1aa4y1o7XA/',context:'原片仅局部握持准备已核；不是本图的完整动作认证。'},
  },
  {
    id:'seated_neutral_db_shoulder_press',title:'坐姿轻哑铃中立握肩推',aliases:['坐姿轻哑铃中立握肩推','坐姿哑铃中立握肩推','坐姿中立握哑铃肩推'],
    equipment:seat,start:{...upright,elbow:[157,92],hand:[156,61]},finish:{...upright,elbow:[139,45],hand:[146,20]},
    error:{...upright,head:[144,48],shoulder:[143,72],elbow:[158,45],hand:[162,20],torsoCurve:'M 143 72 Q 151 114 120 150'},
    arrow:'M 181 84 L 181 27',load:'dumbbell',
    preparation:'坐稳并踩牢地面，背部有支撑；握法保持中立，哑铃先放在可控起点。',
    movement:'在无痛、可控的幅度内向上推，再控制放回；允许肩胛随抬臂自然运动。',
    mistake:'靠后仰和挺腰把重量顶上去；不要全程强压沉肩。',
    conditions:'器械尺寸不适配时才考虑此替代；空手抬臂及最低负荷试推须无痛，并能独立安全拿放。最低哑铃仍过重则不选。',
  },
  {
    id:'seated_db_lateral_raise',title:'坐姿哑铃侧平举',aliases:['坐姿哑铃侧平举','坐姿轻哑铃侧平举'],
    equipment:seat,start:{...upright,elbow:[94,110],hand:[83,142],otherElbow:[146,110],otherHand:[157,142]},
    finish:{...upright,elbow:[73,78],hand:[35,79],otherElbow:[167,78],otherHand:[205,79]},
    error:{...upright,head:[144,42],shoulder:[144,66],elbow:[97,63],hand:[56,47],otherElbow:[190,63],otherHand:[228,47]},
    arrow:'M 48 137 Q 28 113 25 88',load:'dumbbell',
    preparation:'坐稳、轻握哑铃，手腕受控，肘保持舒适的轻微弯曲。',
    movement:'向身体两侧抬起，再缓慢回程；上限以肩部无痛且不借力为准。',
    mistake:'甩动躯干、抢着把重量抛高；减轻负荷后重新找控制。',
    conditions:'仅示意坐姿哑铃版；二维图不规定精确抬臂平面或固定角度，不展示绳索版本。',
  },
  {
    id:'seated_cable_row',title:'坐姿绳索划船',aliases:['坐姿绳索划船','坐姿拉索划船'],
    equipment:['M 70 151 L 149 151 M 88 151 L 88 211','M 213 184 L 232 145','M 272 88 L 272 211'],
    start:{...upright,elbow:[160,89],hand:[200,110],knee:[180,161],ankle:[219,182]},
    finish:{...upright,elbow:[106,108],hand:[148,125],knee:[180,161],ankle:[219,182]},
    error:{...upright,head:[71,56],shoulder:[81,82],elbow:[74,119],hand:[118,132],knee:[180,161],ankle:[219,182]},
    arrow:'M 201 133 L 153 143',cableAnchor:[272,110],
    preparation:'坐稳并踩牢踏板；起点与握把先调到可控位置。',movement:'把握把拉向躯干，再控制送回；肩胛可自然运动，躯干保持受控。',
    mistake:'大幅后仰甩拉，用身体抢重量。',conditions:'仅示意坐姿水平绳索划船；不适用于单臂下拉、胸托机器或每种器械设置。',
  },
  {
    id:'neutral_lat_pulldown',title:'中立握高位下拉',aliases:['中立握高位下拉','对握高位下拉','对握/中立握高位下拉'],
    equipment:[...seat,'M 267 24 L 267 211 M 151 172 L 202 172'],
    start:{...upright,elbow:[148,41],hand:[167,18]},finish:{...upright,elbow:[142,113],hand:[171,83]},
    error:{...upright,head:[91,47],shoulder:[99,72],elbow:[109,115],hand:[141,83]},
    arrow:'M 196 29 L 196 79',cableAnchor:[235,15],
    preparation:'座位和压腿垫适配，脚踩稳；先确保握把和起始负荷可控。',movement:'手肘向下带动拉回，再控制还原；图仅示意一侧，不规定握距与精确肩胛路线。',
    mistake:'大幅后仰、甩动把下拉做成向后拉。',conditions:'仅适用已确认的中立握版本；不同握把与机器需按实际设备适配，不靠此图判断肩痛原因。',
  },
  {
    id:'cable_pushdown',title:'绳索下压',aliases:['绳索下压','绳索三头下压','绳索肱三头肌下压'],
    equipment:['M 252 16 L 252 211'],start:{...standing,elbow:[145,89],hand:[180,77]},finish:{...standing,elbow:[145,89],hand:[152,124]},
    error:{...standing,head:[160,50],shoulder:[162,75],elbow:[182,98],hand:[191,132]},arrow:'M 200 79 L 191 128',cableAnchor:[233,16],
    preparation:'站稳，握牢把手；上臂先放在舒适且受控的位置。',movement:'伸肘下压，再控制屈肘回程；不要让重量把上臂拉走。',
    mistake:'身体前冲、大幅晃动肩和上臂抢次数。',conditions:'仅示意站姿绳索下压；不是过顶臂屈伸，肘或肩不适时停止。',
  },
  {
    id:'db_rdl',title:'哑铃罗马尼亚硬拉',aliases:['哑铃罗马尼亚硬拉','哑铃RDL','双腿哑铃罗马尼亚硬拉'],
    equipment:[],start:standing,finish:{head:[196,98],shoulder:[175,107],hip:[105,137],elbow:[179,136],hand:[175,171],knee:[137,171],ankle:[138,209]},
    error:{head:[197,126],shoulder:[175,138],hip:[106,137],elbow:[177,163],hand:[175,196],knee:[137,171],ankle:[138,209],torsoCurve:'M 175 138 Q 133 106 106 137'},
    arrow:'M 103 115 L 73 130',load:'dumbbell',
    preparation:'双脚站稳，轻握哑铃；膝可微屈，先用轻负荷建立髋铰链。',movement:'髋向后移，躯干随髋折叠，哑铃靠近腿；到能控制并能起身的位置后回到站立。',
    mistake:'为了碰到地面弯曲腰背、失去控制；不要追深度。',conditions:'仅示意双腿哑铃版；幅度随个人能力调整，不锁死膝盖，不按图中比例规定站距或下放深度。',
    source:{url:'https://www.douyin.com/video/7671852814386030521',context:'原片只核了髋铰链、控制与深度等局部；未核完整握法及呼吸。'},
  },
  {
    id:'supported_bodyweight_hip_hinge',title:'扶固定支撑自重髋后移',aliases:['扶固定支撑自重髋后移','扶稳自重髋后移','扶固定支撑自重髋后移（学习退阶）'],
    equipment:stand,start:{...standing,elbow:[179,71],hand:[240,89]},finish:{head:[188,86],shoulder:[168,100],hip:[96,135],elbow:[209,95],hand:[240,89],knee:[133,171],ankle:[138,209]},
    error:{head:[188,105],shoulder:[169,124],hip:[96,135],elbow:[211,103],hand:[240,89],knee:[133,171],ankle:[138,209],torsoCurve:'M 169 124 Q 129 103 96 135'},
    arrow:'M 98 109 L 65 124',preparation:'确认支撑固定、不滑、不倾倒；轻扶稳定，膝可微屈。',movement:'保持足下稳定，让髋向后移；在躯干受控范围内折叠，再站起。',
    mistake:'塌腰弓背追深度，或拉拽支撑来起身。',conditions:'仅作髋铰链学习退阶；不能等效负重RDL增肌。滚轮椅、松动家具不能作支撑，腰背或关节疼痛即停。',
  },
  {
    id:'wall_push_up',title:'墙面俯卧撑',aliases:['墙面俯卧撑','墙壁俯卧撑','扶墙俯卧撑'],
    equipment:['M 237 18 L 237 211'],start:{head:[169,40],shoulder:[154,61],hip:[121,123],elbow:[195,70],hand:[237,72],knee:[110,168],ankle:[102,209]},
    finish:{head:[206,48],shoulder:[186,70],hip:[145,130],elbow:[210,105],hand:[237,72],knee:[119,171],ankle:[102,209]},
    error:{head:[206,48],shoulder:[186,70],hip:[176,144],elbow:[210,105],hand:[237,72],knee:[136,180],ankle:[102,209]},arrow:'M 165 34 L 195 35',
    preparation:'双手放在稳固墙面，双脚站稳；站距先选容易控制的版本。',movement:'保持躯干整体稳定，屈肘靠近墙面，再推回起点。',mistake:'腰部下塌、头抢着往前伸；缩小幅度或调近站距。',
    conditions:'只示意全掌墙面俯卧撑，不是五指墙撑；手腕、肩或肘不适时不继续。',
  },
  {
    id:'elevated_push_up',title:'固定高台俯卧撑',aliases:['固定高台俯卧撑','高台俯卧撑'],
    equipment:['M 222 111 L 270 111 L 270 211 M 229 111 L 229 211'],
    start:{head:[183,46],shoulder:[169,69],hip:[118,132],elbow:[200,91],hand:[236,111],knee:[78,173],ankle:[40,210]},
    finish:{head:[199,96],shoulder:[177,111],hip:[123,151],elbow:[209,143],hand:[236,111],knee:[81,180],ankle:[40,210]},
    error:{head:[199,96],shoulder:[177,111],hip:[136,181],elbow:[209,143],hand:[236,111],knee:[86,193],ankle:[40,210]},arrow:'M 199 61 L 212 91',
    preparation:'只用固定、承重可靠、不滑动的高台；高度先选容易控制的版本。',movement:'躯干整体移动，屈肘下降后推回；幅度以肩腕无痛且能稳定推起为限。',mistake:'腰部下塌，或使用会滑动、翻倒的桌椅。',
    conditions:'本图只示意固定高台版本；墙面版本请用墙面示意。台面越低通常承重越大，不直接照搬组次或力竭要求。',
  },
  {
    id:'supported_straight_knee_calf_raise',title:'扶稳地面双脚提踵',aliases:['扶稳地面双脚提踵','扶稳平地自重双脚提踵','扶固定支撑平地自重双脚提踵'],
    equipment:stand,start:{...standing,elbow:[178,95],hand:[240,89],toe:[160,211]},finish:{head:[134,18],shoulder:[134,43],hip:[134,112],elbow:[186,67],hand:[240,89],knee:[139,154],ankle:[142,195],toe:[160,211]},
    error:{head:[154,22],shoulder:[157,46],hip:[156,115],elbow:[194,71],hand:[240,89],knee:[147,156],ankle:[153,193],toe:[160,211]},arrow:'M 85 182 L 85 147',
    preparation:'双脚在平地站稳，轻扶固定支撑；前脚掌始终可靠接触地面。',movement:'脚跟平稳抬起，再控制落回；膝保持舒适的近伸直状态，不锁死。',mistake:'身体晃动、失控弹起，或靠支撑拉起身体。',
    conditions:'只示意平地自重双脚版；不是台阶单脚、器械负重或坐姿屈膝提踵。',
  },
  {
    id:'high_box_sit_to_stand',title:'高箱坐站',aliases:['高箱坐站','高椅坐站','徒手高箱深蹲','高箱坐站（徒手）'],
    equipment:['M 61 145 L 128 145 M 65 145 L 65 211 M 118 145 L 118 211'],
    start:{head:[136,56],shoulder:[126,80],hip:[95,137],elbow:[161,87],hand:[195,93],knee:[156,148],ankle:[160,209]},
    finish:{head:[159,24],shoulder:[159,49],hip:[158,119],elbow:[190,70],hand:[219,84],knee:[162,164],ankle:[160,209]},
    error:{head:[115,60],shoulder:[105,83],hip:[70,143],elbow:[141,91],hand:[176,99],knee:[156,148],ankle:[160,209]},arrow:'M 96 116 L 132 89',
    preparation:'箱凳固定、承重可靠且高度合适；双脚踩稳，确认能控制坐下与站起。',movement:'髋膝共同弯曲，控制靠近坐面；轻触或坐稳后以可控方式站起。',mistake:'向后跌坐、失控撞上箱凳；先提高坐面或另选退阶。',
    conditions:'仅示意徒手高箱坐站；不展示杯式负重或扶手版本。活动受限、起立困难者需另行适配。',
  },
];

export function normalizedFitnessTitle(title: string) {
  return title.trim().replace(/^(?:(?:动作|第)[一二三四五六七八九十\d]+[：:、.．\s]*|\d+[、.．]\s*)/,'')
    .replace(/[\s·]/g,'').replace(/（/g,'(').replace(/）/g,')').toLowerCase();
}
export function fitnessDemonstrationForStep(step: Pick<ProfessionalTaskStepContent,'title'|'training'>): FitnessDemonstration | undefined {
  const title=normalizedFitnessTitle(step.title);
  // No fuzzy substring matching: a different grip, side or exercise must never inherit an animation.
  const matches=fitnessDemonstrations.filter(item=>item.aliases.some(alias=>normalizedFitnessTitle(alias)===title));
  const requested=step.training?.exerciseId;
  if (requested!==undefined) return matches.find(item=>item.id===requested);
  return matches.length===1 ? matches[0] : undefined;
}

export function interpolateFitnessPose(start:FitnessPose,finish:FitnessPose,amount:number):FitnessPose {
  const point=(a:FitnessPoint,b:FitnessPoint):FitnessPoint=>[a[0]+(b[0]-a[0])*amount,a[1]+(b[1]-a[1])*amount];
  // Rotate rigid arm segments for drawing continuity, not biomechanical analysis.
  const shoulder=point(start.shoulder,finish.shoulder);
  const arm=(a:FitnessPoint,b:FitnessPoint,c:FitnessPoint,d:FitnessPoint)=>{
    if(b[0]===d[0]&&b[1]===d[1]){
      const upper=Math.hypot(a[0]-start.shoulder[0],a[1]-start.shoulder[1]),lower=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const dx=b[0]-shoulder[0],dy=b[1]-shoulder[1],distance=Math.max(.001,Math.hypot(dx,dy));
      const side=Math.sign((b[0]-start.shoulder[0])*(a[1]-start.shoulder[1])-(b[1]-start.shoulder[1])*(a[0]-start.shoulder[0]))||1;
      const angle=Math.atan2(dy,dx)+side*Math.acos(Math.max(-1,Math.min(1,(distance*distance+upper*upper-lower*lower)/(2*distance*upper))));
      return {elbow:[shoulder[0]+Math.cos(angle)*upper,shoulder[1]+Math.sin(angle)*upper] as FitnessPoint,hand:b};
    }
    const segment=(from:FitnessPoint,startA:FitnessPoint,startB:FitnessPoint,endA:FitnessPoint,endB:FitnessPoint):FitnessPoint=>{
      const first=Math.atan2(startB[1]-startA[1],startB[0]-startA[0]),last=Math.atan2(endB[1]-endA[1],endB[0]-endA[0]);
      const angle=first+Math.atan2(Math.sin(last-first),Math.cos(last-first))*amount,length=Math.hypot(startB[0]-startA[0],startB[1]-startA[1]);
      return [from[0]+Math.cos(angle)*length,from[1]+Math.sin(angle)*length];
    };
    const elbow=segment(shoulder,start.shoulder,a,finish.shoulder,c),hand=segment(elbow,a,b,c,d);
    return {elbow,hand};
  };
  const primary=arm(start.elbow,start.hand,finish.elbow,finish.hand);
  const secondary=start.otherElbow&&start.otherHand&&finish.otherElbow&&finish.otherHand?arm(start.otherElbow,start.otherHand,finish.otherElbow,finish.otherHand):undefined;
  return {...start,head:point(start.head,finish.head),shoulder,hip:point(start.hip,finish.hip),...primary,knee:point(start.knee,finish.knee),ankle:point(start.ankle,finish.ankle),
    ...(secondary?{otherElbow:secondary.elbow,otherHand:secondary.hand}:{}),...(start.toe&&finish.toe?{toe:point(start.toe,finish.toe)}:{})};
}
