'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {SurveyQuestion} from '../zhiyu/beta-survey-inbox';
import {betaSurveyQuestions,type BetaSurveyAnswers,type BetaSurveyVersion} from '../../lib/npc/beta-surveys';
import './preview.css';

/** Uses the actual question schema and controls. Answers stay in this page's
 * memory; this route never creates an account, card, submission or usage event. */
export default function SurveyPreview(){
  const [version,setVersion]=useState<BetaSurveyVersion>('A');
  const [answers,setAnswers]=useState<Record<BetaSurveyVersion,BetaSurveyAnswers>>({A:{},B:{}});
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get('version');
    if(requested==='B')queueMicrotask(()=>setVersion('B'));
  },[]);
  return <main className="zy-beta-survey-dialog zy-survey-preview" aria-label="问卷内容预览">
    <header><div><h1>智域内测问卷</h1><p>内容预览，不提交答案、不计入内测数据</p></div><Link href="/admin" prefetch={false}>数据看板</Link></header>
    <form onSubmit={event=>event.preventDefault()}>
      <nav className="zy-survey-preview-tabs" aria-label="选择问卷">
        <button type="button" aria-pressed={version==='A'} onClick={()=>setVersion('A')}>第 7 天 · 问卷 A</button>
        <button type="button" aria-pressed={version==='B'} onClick={()=>setVersion('B')}>第 28 天 · 问卷 B</button>
      </nav>
      <p className="zy-beta-survey-hint">可以试选和填写；刷新页面后清空，不会保存到任何账号。</p>
      {betaSurveyQuestions(version).map((question,index)=><SurveyQuestion key={version+':'+question.id} question={question} index={index} value={answers[version][question.id]} disabled={false} onChange={value=>setAnswers(current=>({...current,[version]:{...current[version],[question.id]:value}}))}/>)}
      <footer><p>正式内测问卷由 Molly 在私聊中发送，用户填写后才进入数据看板。</p><Link href="/mobile" prefetch={false}>打开智域内测端</Link></footer>
    </form>
  </main>;
}
