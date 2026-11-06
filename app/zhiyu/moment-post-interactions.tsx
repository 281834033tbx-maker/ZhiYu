'use client';

import {useId, type ReactNode} from 'react';
import {Heart,MessageSquare,MessageSquareMore} from 'lucide-react';
import type {Post,Comment} from './data';

function InteractionIcon({kind,active}:{kind:'like'|'comment';active:boolean}) {
  const id='zy-moment-action-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const Icon=kind==='like'?Heart:active?MessageSquareMore:MessageSquare;
  return <Icon size={kind==='like'?23:22} aria-hidden="true" className={kind==='comment'&&active?'zy-comment-filled':undefined}
    stroke={active?`url(#${id})`:'currentColor'} fill={active?`url(#${id})`:'none'}>
    {active&&<defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--zy-moment-accent-start, #ff946f)"/><stop offset="1" stopColor="var(--zy-moment-accent-end, #ed628e)"/></linearGradient></defs>}
  </Icon>;
}

export function hasOwnMomentComment(post:Pick<Post,'comments'>) {
  return post.comments.some(comment=>comment.actorId==='self');
}

/** Render only known liker identities. Local likes have no separate server row. */
export function momentLikers(post:Pick<Post,'likes'|'liked'>,selfName:string) {
  const likes=(post.likes||[]).filter(like=>like.actorId!=='self'||post.liked);
  return post.liked&&!likes.some(like=>like.actorId==='self')?[...likes,{actorId:'self',name:selfName}]:likes;
}

export default function MomentPostInteractions({post,authorName,selfName,actorName,busy,onLike,onComment,onReply,editor}: {
  post:Post;authorName:string;selfName:string;actorName:(actorId:string,fallback:string)=>string;busy:boolean;
  onLike:()=>void;onComment:()=>void;onReply:(comment:Comment)=>void;editor?:ReactNode;
}) {
  const ownComment=hasOwnMomentComment(post),likes=momentLikers(post,selfName);
  return <>
    <div className="zy-post-actions">
      <button type="button" className={'zy-icon'+(post.liked?' liked':'')} aria-label={`${post.liked?'取消点赞':'点赞'}${authorName}的动态`} aria-pressed={post.liked} disabled={busy} onClick={onLike}>
        <InteractionIcon kind="like" active={post.liked}/><span className="zy-interaction-count">{post.likeCount??Number(post.liked)}</span>
      </button>
      <button type="button" className={'zy-icon'+(ownComment?' commented':'')} aria-label={`评论${authorName}的动态`} aria-pressed={ownComment} onClick={onComment}>
        <InteractionIcon kind="comment" active={ownComment}/><span className="zy-interaction-count">{post.comments.length}</span>
      </button>
    </div>
    {(likes.length>0||post.comments.length>0||editor)&&<section className="zy-moment-interaction-box" aria-label="点赞与评论">
      {likes.length>0&&<div className="zy-post-likers"><Heart size={13} aria-hidden="true"/><span>{likes.map((like,index)=><span key={like.actorId}>{index>0?'、':''}<strong>{like.actorId==='self'?selfName:actorName(like.actorId,like.name)}</strong></span>)}</span></div>}
      {post.comments.length>0&&<div className="zy-post-comments" aria-label="动态评论">{post.comments.map(comment=><div className="zy-inline-comment" key={comment.id}>
        <button type="button" onClick={()=>onReply(comment)}><strong>{comment.actorId==='self'?selfName:comment.name}</strong>{comment.replyToName&&<span> 回复 <strong>{comment.replyToName}</strong></span>}：{comment.text}</button>
      </div>)}</div>}
      {editor}
    </section>}
  </>;
}
