'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, X } from 'lucide-react';
import './dungeons.css';
import './user-facing-ui.css';

type Dungeon = {
  id: string;
  title: string;
  genre: string;
  summary: string;
  /** 是否已经可以进入。第一版都还没开放，先只做书架和详情卡。 */
  open: boolean;
};

const dungeons: Dungeon[] = [
  {
    id: 'a-city-ceo-day',
    title: 'A市总裁的一天',
    genre: '都市 · 一天',
    summary: '从早会到深夜，你跟在 A 市这位总裁身边过完整整一天。',
    open: false,
  },
  {
    id: 'dungeon-slot-2',
    title: '',
    genre: '',
    summary: '这本副本还在准备中，开放后会出现在书架上。',
    open: false,
  },
  {
    id: 'dungeon-slot-3',
    title: '',
    genre: '',
    summary: '这本副本还在准备中，开放后会出现在书架上。',
    open: false,
  },
];

const BOOKS_PER_ROW = 3;

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < list.length; index += size) rows.push(list.slice(index, index + size));
  return rows;
}

/** 封面留空白：只有纸张、书脊阴影和内页边，不放图也不放字。 */
function BookCover({ blank }: { label: string; blank: boolean }) {
  return (
    <span className={`zy-book-cover${blank ? ' is-blank' : ''}`} aria-hidden="true" />
  );
}

export default function Dungeons({ onBack }: { onBack: () => void }) {
  const [picked, setPicked] = useState<Dungeon | null>(null);

  return (
    <section className="zy-dungeons" aria-label="副本">
      <div className="zy-dungeons-inner">
        <button type="button" className="zy-dungeons-back" onClick={onBack}>
          <ArrowLeft size={16} />
          返回宠物
        </button>
        <header className="zy-dungeons-head">
          <h1>
            <BookOpen size={22} />
            副本
          </h1>
          <p>挑一本进去待一会儿。书架上的空位会慢慢填上。</p>
        </header>
        <div className="zy-shelf">
          {chunk(dungeons, BOOKS_PER_ROW).map((row, rowIndex) => (
            <div className="zy-shelf-row" key={rowIndex}>
              <div className="zy-shelf-books">
                {row.map(dungeon => (
                  <button
                    key={dungeon.id}
                    type="button"
                    className="zy-book"
                    aria-label={dungeon.title || '即将开放'}
                    onClick={() => setPicked(dungeon)}
                  >
                    <BookCover label={dungeon.title || '即将开放'} blank={!dungeon.title} />
                    {dungeon.title ? (
                      <span className="zy-book-title">{dungeon.title}</span>
                    ) : (
                      <span className="zy-book-title is-dim">即将开放</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="zy-shelf-plank" aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
      {picked&&<DungeonDialog dungeon={picked} onClose={()=>setPicked(null)}/>}
    </section>
  );
}

function DungeonDialog({dungeon,onClose}:{dungeon:Dungeon;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="zy-dungeon-backdrop" aria-label={dungeon.title||'副本详情'} style={{width:'100vw',height:'100dvh',maxWidth:'none',maxHeight:'none',margin:0,border:0}} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}>
          <div className="zy-dungeon-card">
            <button type="button" className="zy-dungeon-close" aria-label="关闭" onClick={() => onClose()}>
              <X size={18} />
            </button>
            <div className="zy-dungeon-cover">
              <BookCover label={dungeon.title || '即将开放'} blank={!dungeon.title} />
            </div>
            <div className="zy-dungeon-info">
              <span className="zy-dungeon-genre">{dungeon.genre || '待定'}</span>
              <h2>{dungeon.title || '即将开放'}</h2>
              <p>{dungeon.summary}</p>
              <button type="button" className="zy-dungeon-enter" disabled>
                即将开放
              </button>
            </div>
          </div>
  </dialog>;
}
