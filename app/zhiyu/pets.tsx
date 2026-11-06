'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import Image from 'next/image';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import DirectoryDivider from './directory-divider';
import { BookOpen, Check, PawPrint, Pencil, X } from 'lucide-react';
import Dungeons from './dungeons';
import { PET_STATE_CHANGED_EVENT, petStorageKey, type StoredPetState } from './pet-storage';
import { petDisplayFrames } from './pet-display-frames';
import './pets.css';

type Pet = { id: string; name: string; description: string; appearance: number; imageSrc?: string; limited?: boolean; limitedRegion?: string; limitedCode?: number };
type PetState = StoredPetState;
type ExplorePet = Pet & { priceCny?: number };

const initialState: PetState = { pets: [], selectedId: '', visible: true };
const moods = ['状态不错', '有点饿了', '想出去玩', '有点渴了', '想安静待着', '有点烦躁'];
const regularDisplaySlugs = new Set([
  'african-lion', 'spotted-hyena', 'three-toed-sloth', 'tibetan-fox',
  'bengal-cat', 'devon-rex', 'siberian-husky', 'king-cobra',
  'turkey-vulture', 'golden-retriever', 'penguin', 'westie',
]);
const regularPets: ExplorePet[] = [
  ['非洲狮', 'african-lion'], ['斑鬣狗', 'spotted-hyena'], ['三趾树懒', 'three-toed-sloth'], ['藏狐', 'tibetan-fox'],
  ['孟加拉猫', 'bengal-cat'], ['德文卷毛猫', 'devon-rex'], ['西伯利亚哈士奇', 'siberian-husky'], ['眼镜王蛇', 'king-cobra'],
  ['火鸡秃鹫', 'turkey-vulture'], ['金毛寻回犬', 'golden-retriever'], ['企鹅', 'penguin'], ['西高地白梗', 'westie'],
  ['捕鸟蛛', 'tarantula'], ['雪豹', 'snow-leopard'], ['中国冠毛犬', 'chinese-crested'], ['鳄鱼', 'crocodile'],
].map(([name, slug], index) => ({
  id: `regular-${slug}`, name, description: '普通宠物', appearance: index % 6,
  imageSrc: `/pets/regular/${slug}${regularDisplaySlugs.has(slug) ? '-display' : ''}.png`,
}));

// Preserve previously adopted Shenzhen pets in the warehouse when replacing the catalog.
const replacedSharkId = 'limited-shenzhen-sneaker-shark';
const limitedCaptions = [
  '叽叽喳喳的，不如不复活了...', '曾经是个美女', '上班攒钱买上半身',
  '深海鱼的童年回忆', '吃之前记得扒皮', '丑',
];
const limitedPets: ExplorePet[] = [
  ['复活的标本金刚鹦鹉', 'revived-macaw'], ['火龙果芭蕾骷髅', 'dragonfruit-ballerina'],
  ['公文包下半身人', 'briefcase-person'], ['深海电视鱼', 'deepsea-tv-fish'],
  ['香蕉三文鱼', 'banana-salmon'], ['机甲蟾蜍', 'mecha-toad'],
].map(([name, slug], index) => ({
  id: `limited-${String(index + 1).padStart(2, '0')}`, name, description: limitedCaptions[index],
  appearance: index, imageSrc: `/pets/limited/${slug}${slug === 'dragonfruit-ballerina' ? '-display' : ['revived-macaw', 'banana-salmon', 'mecha-toad'].includes(slug) ? '-cutout' : ''}.png`, limited: true, priceCny: 18,
}));
const currentPetImages = new Map([...regularPets, ...limitedPets].map(pet => [pet.id, pet.imageSrc]));
const adoptableIds = new Set([...regularPets, ...limitedPets].map(pet => pet.id));
// Older Shenzhen pets came from the previous adoption catalog. Keep their saved records.
const isAdoptedPet = (pet: Pet) => adoptableIds.has(pet.id) || pet.id.startsWith('limited-shenzhen-');
const isLimitedPet = (pet: Pet) => Boolean(pet.limited || pet.limitedRegion || pet.id.startsWith('limited-'));

function PetArt({ appearance, imageSrc, label, limited = false, className = '' }: { appearance: number; imageSrc?: string; label: string; limited?: boolean; className?: string }) {
  const clipId = useId();
  const pose = imageSrc ? petDisplayFrames[imageSrc] : undefined;
  const artClassName = `${limited ? '' : 'is-regular'} ${className}`;
  if (pose) {
    const [x, y, width, height] = pose.clipBounds;
    return <svg className={`zy-pet-image ${artClassName}`} viewBox={pose.viewBox} preserveAspectRatio="xMidYMid meet" aria-label={label}>
      <title>{label}</title>
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
      <image href={pose.source} width={pose.imageWidth} height={pose.imageHeight} clipPath={`url(#${clipId})`} />
    </svg>;
  }
  if (imageSrc) return <Image unoptimized width={120} height={120} className={`zy-pet-image ${artClassName}`} src={imageSrc} alt={label} />;
  return <span className={`zy-pet-art zy-pet-art-${appearance} ${artClassName}`} aria-hidden="true" />;
}

function UprightPaw({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="6.7" cy="8.3" rx="1.7" ry="2.25" />
    <ellipse cx="10.5" cy="5.9" rx="1.65" ry="2.15" />
    <ellipse cx="13.5" cy="5.9" rx="1.65" ry="2.15" />
    <ellipse cx="17.3" cy="8.3" rx="1.7" ry="2.25" />
    <path d="M12 12.1c-1.5-1.4-3.2-1.1-4.1.2-.4.6-.8 1.2-1.4 1.8-1.6 1.6-1.4 4.1.5 5.1 1.1.6 2.3.4 3.4.1.5-.1 1-.2 1.6-.2s1.1.1 1.6.2c1.1.3 2.3.5 3.4-.1 1.9-1 2.1-3.5.5-5.1-.6-.6-1-1.2-1.4-1.8-.9-1.3-2.6-1.6-4.1-.2Z" />
  </svg>;
}

function parsePetState(raw:string|null):PetState {
    let loadedState = initialState;
    try {
      const saved = raw;
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PetState>;
        if (Array.isArray(parsed.pets)) {
          const pets = parsed.pets.filter((pet): pet is Pet =>
            typeof pet?.id === 'string' && typeof pet.name === 'string' &&
            typeof pet.description === 'string' && Number.isInteger(pet.appearance) &&
            pet.appearance >= 0 && pet.appearance < 6).map(pet => {
              return {
                ...pet,
                name: pet.id === replacedSharkId && pet.name === '蓝鲨' ? '机甲小怪' : pet.name,
                description: pet.id === replacedSharkId ? '带着机械装备，准备探索新地方。' : pet.description,
                imageSrc: pet.id === replacedSharkId ? '/pets/shenzhen/mecha-creature.png' : currentPetImages.get(pet.id) ?? (typeof pet.imageSrc === 'string' ? pet.imageSrc : undefined),
                limited: pet.limited === true,
                limitedRegion: typeof pet.limitedRegion === 'string' ? pet.limitedRegion : undefined,
                limitedCode: typeof pet.limitedCode === 'number' ? pet.limitedCode : undefined,
              };
            });
          const adoptedPets = pets.filter(isAdoptedPet);
          loadedState = {
            pets, selectedId: adoptedPets.some(pet => pet.id === parsed.selectedId) ? parsed.selectedId! : adoptedPets[0]?.id || '',
            visible: parsed.visible !== false,
          };
        }
      }
    } catch { loadedState = initialState; }
  return loadedState;
}
const subscribeHydrated=()=>()=>{};
function subscribePetState(onChange:()=>void) {
  window.addEventListener(PET_STATE_CHANGED_EVENT,onChange);
  window.addEventListener('storage',onChange);
  return()=>{window.removeEventListener(PET_STATE_CHANGED_EVENT,onChange);window.removeEventListener('storage',onChange);};
}
export default function PetPage({ accountId, dirWidth, onDirectoryWidthChange, embedded=false }: {
  accountId: string;
  dirWidth: number;
  onDirectoryWidthChange: (width: number) => void;
  embedded?: boolean;
}) {
  return <PetPageSession key={accountId} accountId={accountId} dirWidth={dirWidth} onDirectoryWidthChange={onDirectoryWidthChange} embedded={embedded}/>;
}
function PetPageSession({accountId,dirWidth,onDirectoryWidthChange,embedded}:{accountId:string;dirWidth:number;onDirectoryWidthChange:(width:number)=>void;embedded:boolean}) {
  const hydrated=useSyncExternalStore(subscribeHydrated,()=>true,()=>false);
  const storageKey = petStorageKey(accountId);
  const raw=useSyncExternalStore(subscribePetState,()=>{try{return localStorage.getItem(storageKey);}catch{return null;}},()=>null);
  const state=useMemo(()=>parsePetState(raw),[raw]);
  const [section, setSection] = useState<'mine' | 'explore'>('mine');
  const [discover, setDiscover] = useState<'pets' | 'dungeons' | null>(embedded?'pets':null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<'rename' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');

  const renameDialog=useRef<HTMLDialogElement>(null),nameInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const node=renameDialog.current;if(!node||!dialog)return;
    node.showModal();nameInput.current?.focus();
    return()=>node.close();
  },[dialog]);
  useEffect(()=>{
    if(!hydrated)return;
    const normalized=JSON.stringify(state);
    try{if(localStorage.getItem(storageKey)!==normalized){localStorage.setItem(storageKey,normalized);window.dispatchEvent(new Event(PET_STATE_CHANGED_EVENT));}}catch(cause){console.error('[智域] 读取宠物存储',cause);}
  },[state,storageKey,hydrated]);
  const setState=(update:PetState|((current:PetState)=>PetState))=>{
    try {
      const current=parsePetState(localStorage.getItem(storageKey));
      const next=typeof update==='function'?update(current):update;
      localStorage.setItem(storageKey,JSON.stringify(next));
      window.dispatchEvent(new Event(PET_STATE_CHANGED_EVENT));
      return true;
    }catch(cause){setError(reportUserFacingError(cause,'save','保存宠物'));return false;}
  };

  const pets = state.pets.filter(isAdoptedPet);
  const selected = pets.find(pet => pet.id === state.selectedId) || pets[0];
  const adopt = (pet: Pet) => {
    if (pets.some(item => item.id === pet.id)) {
      setNotice('这只宠物已经在你的仓库里。');
      return;
    }
    const saved=setState(current => {
      if (current.pets.some(item => item.id === pet.id)) return current;
      return { ...current, pets: [...current.pets, pet], selectedId: pet.id, visible: true };
    });
    if(saved)setNotice(`${pet.name}已加入“我的宠物”。`);
  };

  const openDialog = () => {
    if (!selected) return;
    setDraftName(selected.name);
    setError('');
    setDialog('rename');
  };
  const savePet = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name || name.length > 16) {
      setError('请输入 1 到 16 个字的宠物名字。');
      return;
    }
    if (dialog !== 'rename' || !selected) return;
    const saved=setState(current => ({ ...current, pets: current.pets.map(pet => pet.id === selected.id ? { ...pet, name } : pet) }));
    if(saved)setDialog(null);
  };

  return <>
    {!embedded&&<><aside className="zy-directory zy-pet-directory" style={{ width: dirWidth }} aria-label="多功能区">
      <div className="zy-pet-directory-heading"><strong>多功能区</strong></div>
      <nav className="zy-pet-directory-nav" aria-label="多功能区入口">
        <button type="button" className={discover === 'pets' ? 'is-active' : ''} aria-current={discover === 'pets' ? 'page' : undefined} onClick={() => setDiscover('pets')}><UprightPaw /><span>宠物</span></button>
        <button type="button" className={discover === 'dungeons' ? 'is-active' : ''} aria-current={discover === 'dungeons' ? 'page' : undefined} onClick={() => { setDiscover('dungeons'); setNotice(''); }}><BookOpen size={18} /><span>副本</span></button>
      </nav>
    </aside>
    <DirectoryDivider width={dirWidth} onWidthChange={onDirectoryWidthChange} label="调整宠物导航宽度"/></>}
    {discover === 'dungeons' ? <Dungeons onBack={() => setDiscover('pets')} /> : discover === 'pets' ? <section className="zy-pets" aria-label={section === 'mine' ? '我的宠物' : '去领养'}>
      <div className="zy-pets-inner">
        <nav className="zy-pets-tabs" aria-label="宠物">
          <button type="button" className={section === 'mine' ? 'is-active' : ''} aria-current={section === 'mine' ? 'page' : undefined} onClick={() => { setSection('mine'); setNotice(''); }}>我的宠物</button>
          <button type="button" className={section === 'explore' ? 'is-active' : ''} aria-current={section === 'explore' ? 'page' : undefined} onClick={() => { setSection('explore'); setNotice(''); }}>去领养</button>
        </nav>
        {section === 'mine' ? <>
          {selected ? <div className="zy-pets-preview">
            <span className="zy-pets-preview-label">当前展示</span>
            <PetArt appearance={selected.appearance} imageSrc={selected.imageSrc} label={selected.name} limited={isLimitedPet(selected)} className="zy-pets-preview-art" />
            <div className="zy-pets-preview-details">
              <div className="zy-pets-preview-name"><strong>{selected.name}</strong><button type="button" title="修改宠物名字" aria-label="修改宠物名字" onClick={openDialog}><Pencil size={14} /></button></div>
              <p>{selected.description}</p>
              <span>{moods[selected.appearance]}</span>
            </div>
          </div> : <div className="zy-pets-empty"><PawPrint size={27} /><h2>还没有领养宠物</h2><p>去领养里挑一只喜欢的伙伴吧。</p><button type="button" onClick={() => setSection('explore')}>去领养</button></div>}
          <div className="zy-pets-section-heading"><div><h2>我的仓库</h2><p>{pets.length ? `${pets.length} 只宠物 · 选择卡片切换展示` : '领养后会显示在这里'}</p></div></div>
          <div className="zy-pets-grid">{pets.map(pet => <button key={pet.id} type="button" className={`zy-pet-card ${pet.id === selected?.id ? 'is-selected' : ''}`} aria-pressed={pet.id === selected?.id} onClick={() => setState(current => ({ ...current, selectedId: pet.id, visible: true }))}>
            {(pet.limited || pet.limitedRegion) && <span className="zy-pet-limited-badge">限定宠物</span>}
            {pet.id === selected?.id && <span className="zy-pet-selected-label"><Check size={13} />当前展示</span>}
            <PetArt appearance={pet.appearance} imageSrc={pet.imageSrc} label={pet.name} limited={isLimitedPet(pet)} /><strong>{pet.name}</strong><span className="zy-pet-description">{pet.description}</span><span className="zy-pet-mood">{moods[pet.appearance]}</span>
          </button>)}</div>
        </> : <>
          <div className="zy-pets-section-heading zy-pets-limited-heading"><div><h2>限定宠物</h2><p>这还是地球生物么？？</p></div></div>
          <div className="zy-pets-grid zy-pets-limited-grid">{limitedPets.map(pet => {
            const owned = pets.some(item => item.id === pet.id);
            return <div key={pet.id} className="zy-pet-card zy-pet-discover-card is-limited"><span className="zy-pet-limited-badge">限定宠物</span><PetArt appearance={pet.appearance} imageSrc={pet.imageSrc} label={pet.name} limited={isLimitedPet(pet)} /><strong>{pet.name}</strong><span className="zy-pet-caption">{pet.description}</span><button type="button" disabled title={owned ? '已领养' : '购买暂未开放'}>{owned ? '已领养' : `¥${pet.priceCny}`}</button></div>;
          })}</div>
          <div className="zy-pets-section-heading zy-pets-discover-heading"><div><h2>更多宠物</h2><p>挑选喜欢的新伙伴</p></div></div>
          <div className="zy-pets-discover-scroll" aria-label="更多可领养宠物，滚动查看更多"><div className="zy-pets-grid">{regularPets.map(pet => {
            const owned = pets.some(item => item.id === pet.id);
            return <div key={pet.id} className="zy-pet-card zy-pet-discover-card"><PetArt appearance={pet.appearance} imageSrc={pet.imageSrc} label={pet.name} limited={isLimitedPet(pet)} /><strong>{pet.name}</strong><button type="button" disabled={owned} onClick={() => adopt(pet)}>{owned ? '已领养' : '领养'}</button></div>;
          })}</div></div>
          {notice && <output className="zy-pets-notice">{notice}</output>}
        </>}
      </div>
    </section> : <section className="zy-chat zy-chat-empty" aria-label="多功能区"><div className="zy-empty-logo"><Image unoptimized width={160} height={160} src="/zhiyu-logo.png" alt="智域" /></div></section>}
    {dialog && <dialog ref={renameDialog} className="zy-pets-dialog-backdrop" aria-label="重命名宠物" style={{width:"100vw",height:"100dvh",maxWidth:"none",maxHeight:"none",margin:0,border:0}} onCancel={event=>{event.preventDefault();setDialog(null);}} onPointerDown={event => { if (event.target === event.currentTarget) setDialog(null); }}>
      <form className="zy-pets-dialog" onSubmit={savePet} aria-label="重命名宠物">
        <div className="zy-pets-dialog-heading"><h2>重命名宠物</h2><button type="button" aria-label="关闭" onClick={() => setDialog(null)}><X size={19} /></button></div>
        <label htmlFor="zy-pet-name">宠物名字</label><input ref={nameInput} id="zy-pet-name" maxLength={16} value={draftName} onChange={event => { setDraftName(event.target.value); setError(''); }} placeholder="给它起个名字" />
        {error && <p className="zy-pets-error" role="alert">{error}</p>}
        <div className="zy-pets-dialog-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button type="submit">保存名字</button></div>
      </form>
    </dialog>}
  </>;
}
