'use client';

import {type ReactNode} from 'react';
import type {Post,Comment} from './data';
import PhosphorActionIcon from './phosphor-action-icon';

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
        <PhosphorActionIcon name="like" size={23} gradient={post.liked} filled={post.liked}/><span className="zy-interaction-count">{post.likeCount??Number(post.liked)}</span>
      </button>
      <button type="button" className={'zy-icon'+(ownComment?' commented':'')} aria-label={`评论${authorName}的动态`} aria-pressed={ownComment} onClick={onComment}>
        <PhosphorActionIcon name="comment" size={22} gradient={ownComment} filled={ownComment}/><span className="zy-interaction-count">{post.comments.length}</span>
      </button>
    </div>
    {(likes.length>0||post.comments.length>0||editor)&&<section className="zy-moment-interaction-box" aria-label="点赞与评论">
      {likes.length>0&&<div className="zy-post-likers"><PhosphorActionIcon name="like" size={13}/><span>{likes.map((like,index)=><span key={like.actorId}>{index>0?'、':''}<strong>{like.actorId==='self'?selfName:actorName(like.actorId,like.name)}</strong></span>)}</span></div>}
      {post.comments.length>0&&<div className="zy-post-comments" aria-label="动态评论">{post.comments.map(comment=><div className="zy-inline-comment" key={comment.id}>
        <button type="button" onClick={()=>onReply(comment)}><strong>{comment.actorId==='self'?selfName:comment.name}</strong>{comment.replyToName&&<span> 回复 <strong>{comment.replyToName}</strong></span>}：{comment.text}</button>
      </div>)}</div>}
      {editor}
    </section>}
  </>;
}
