'use client';
import {useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft, ChevronRight, Pause, Play, X} from 'lucide-react';
import type {ProfessionalTaskStep} from '../../lib/npc/professional-task';
import {professionalTaskStepContent} from '../../lib/npc/professional-task-timer';
import {fitnessDemonstrationForStep, interpolateFitnessPose, type FitnessDemonstration, type FitnessPose} from '../../lib/npc/fitness-demonstrations';
import './fitness-demonstration.css';

const amounts=[0,.25,.5,.75,1,.75,.5,.25];
const points=(...values:readonly (readonly [number,number])[])=>values.map(value=>value.join(',')).join(' ');
function Figure({pose,load}:{pose:FitnessPose;load?:FitnessDemonstration['load']}){
  return <g className="zy-fitness-person">
    <circle cx={pose.head[0]} cy={pose.head[1]} r="10"/>
    <path d={`M ${pose.head[0]} ${pose.head[1]+10} L ${pose.shoulder.join(' ')}`}/>
    <path d={pose.torsoCurve||`M ${pose.shoulder.join(' ')} L ${pose.hip.join(' ')}`}/>
    <polyline points={points(pose.shoulder,pose.elbow,pose.hand)}/>
    <polyline points={points(pose.hip,pose.knee,pose.ankle)}/>
    <path d={pose.toe?`M ${pose.ankle.join(' ')} L ${pose.toe.join(' ')}`:`M ${pose.ankle[0]-4} ${pose.ankle[1]} L ${pose.ankle[0]+15} ${Math.min(211,pose.ankle[1]+2)}`}/>
    {pose.otherElbow&&pose.otherHand&&<polyline points={points(pose.shoulder,pose.otherElbow,pose.otherHand)}/>}
    {load==='dumbbell'&&[pose.hand,...(pose.otherHand?[pose.otherHand]:[])].map((hand,index)=><g className="zy-fitness-load" key={index} transform={`translate(${hand.join(' ')})`}><path d="M -11 0 L 11 0 M -9 -6 L -9 6 M 9 -6 L 9 6"/></g>)}
  </g>;
}
export function FitnessSchematic({demonstration,phase,playing,frame=0}:{demonstration:FitnessDemonstration;phase:'preparation'|'movement'|'mistake';playing:boolean;frame?:number}){
  const arrowId=useId().replace(/:/g,''),moving=phase==='movement',error=phase==='mistake';
  const poses=moving&&playing?amounts.map(amount=>interpolateFitnessPose(demonstration.start,demonstration.finish,amount))
    :[error?demonstration.error:moving?interpolateFitnessPose(demonstration.start,demonstration.finish,amounts[frame]||0):demonstration.start];
  return <svg className={'zy-fitness-schematic'+(moving&&playing?' is-playing':'')+(error?' is-mistake':'')} viewBox="0 0 300 230" aria-label={`${demonstration.title}，${phase==='preparation'?'准备姿态':error?'常见错误示意':'大致往返轨迹'}；二维结构示意，非精确动作分析`}>
    <title>{`${demonstration.title} · ${phase==='preparation'?'准备':error?'错误示意':'往返轨迹示意'}`}</title>
    <defs><marker id={arrowId} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>
    <path className="zy-fitness-floor" d="M 20 213 L 280 213"/>
    <g className="zy-fitness-equipment">{demonstration.equipment.map((path,index)=><path d={path} key={index}/>)}</g>
    {poses.map((pose,index)=><g className={moving&&playing?'zy-fitness-motion-frame':undefined} data-frame={index} key={index} style={{'--frame-delay':`${-index*.35}s`} as CSSProperties}>
      {demonstration.cableAnchor&&<path className="zy-fitness-cable" d={`M ${demonstration.cableAnchor.join(' ')} L ${pose.hand.join(' ')}`}/>}
      <Figure pose={pose} load={demonstration.load}/>
    </g>)}
    {moving&&<path className="zy-fitness-direction" d={demonstration.arrow} markerEnd={`url(#${arrowId})`}/>}
    {error&&<g className="zy-fitness-error-mark"><circle cx="264" cy="35" r="13"/><path d="M 259 30 L 269 40 M 269 30 L 259 40"/></g>}
  </svg>;
}

export function FitnessDemonstrationDialog({step,onClose,restoreFocus}:{step:ProfessionalTaskStep;onClose:()=>void;restoreFocus?:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),titleId=useId(),captionId=useId();
  const demonstration=fitnessDemonstrationForStep(step),[phase,setPhase]=useState<'preparation'|'movement'|'mistake'>('preparation');
  const [playing,setPlaying]=useState(false),[frame,setFrame]=useState(0);
  const {instructions,notes}=professionalTaskStepContent(step);
  useLayoutEffect(()=>{
    const node=dialog.current;if(!node)return;node.showModal();close.current?.focus();
    return()=>{node.close();restoreFocus?.();};
  },[restoreFocus]);
  const changePhase=(value:typeof phase)=>{setPhase(value);setFrame(0);setPlaying(value==='movement'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);};
  const caption=demonstration?(phase==='preparation'?demonstration.preparation:phase==='movement'?demonstration.movement:demonstration.mistake):'';
  return <dialog ref={dialog} className="zy-dialog zy-fitness-dialog" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}} onPointerDown={event=>{
    if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();
  }}>
    <header><div><h2 id={titleId}>{step.title}</h2><p>{demonstration?'动作示意':'暂时没有匹配的动作示意'}</p></div><button ref={close} type="button" aria-label="关闭动作图片" onClick={onClose}><X size={17}/></button></header>
    <div className="zy-fitness-dialog-scroll">
      {demonstration?<>
        <nav className="zy-fitness-phases" aria-label="动作示意内容">{(['preparation','movement','mistake'] as const).map((value,index)=><button type="button" key={value} aria-pressed={phase===value} onClick={()=>changePhase(value)}>{['准备','轨迹','错误'][index]}</button>)}</nav>
        <figure aria-describedby={captionId}>
          <FitnessSchematic demonstration={demonstration} phase={phase} playing={playing} frame={frame}/>
          <figcaption id={captionId}>{phase==='mistake'&&<strong>错误示意：</strong>}{caption}</figcaption>
        </figure>
        {phase==='movement'&&<div className="zy-fitness-playback"><button type="button" aria-label={playing?'暂停动图':'播放动图'} onClick={()=>{setFrame(0);setPlaying(value=>!value);}}>{playing?<Pause size={13}/>:<Play size={13}/>} {playing?'暂停':'播放'}</button><button type="button" aria-label="上一帧" onClick={()=>{setPlaying(false);setFrame(value=>(value+amounts.length-1)%amounts.length);}}><ChevronLeft size={13}/></button><span>逐帧查看</span><button type="button" aria-label="下一帧" onClick={()=>{setPlaying(false);setFrame(value=>(value+1)%amounts.length);}}><ChevronRight size={13}/></button></div>}
        <section className="zy-fitness-conditions"><h3>适用条件</h3><p>{demonstration.conditions}</p></section>
        <p className="zy-fitness-schematic-note">仅为示意，不能用来判断你的姿势是否正确。疼痛或失控即停。</p>
      </>:<p className="zy-fitness-fallback">这个名称或动作版本尚未匹配示意图，先按下方文字核对，或请陈年说明具体版本。</p>}
      {(instructions.length>0||notes.length>0)&&<section className="zy-fitness-original-instructions"><h3>本次任务说明</h3>{instructions.map((text,index)=><p key={'i'+index}>{text}</p>)}{notes.map((text,index)=><p className="is-note" key={'n'+index}>{text}</p>)}</section>}
    </div>
  </dialog>;
}

export function FitnessDemonstrationButton({step}:{step:ProfessionalTaskStep}){
  const [open,setOpen]=useState(false),anchor=useRef<HTMLButtonElement>(null);
  const restoreFocus=useCallback(()=>{if(anchor.current?.isConnected)anchor.current.focus();},[]);
  const demonstration=fitnessDemonstrationForStep(step),label=demonstration?'查看图片':'动作要点';
  if(!step.training&&!demonstration)return null;
  return <><button ref={anchor} type="button" className="zy-professional-task-view-images" data-has-demonstration={!!demonstration} aria-label={label+'：'+step.title} onClick={()=>setOpen(true)}>{label}</button>
    {open&&createPortal(<FitnessDemonstrationDialog key={step.id+step.title+(step.training?.exerciseId||'')} step={step} onClose={()=>setOpen(false)} restoreFocus={restoreFocus}/>,document.body)}</>;
}
