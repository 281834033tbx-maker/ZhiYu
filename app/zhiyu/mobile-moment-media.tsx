'use client';
/* eslint-disable next/no-img-element */
import {useState} from 'react';
import type {Post} from './data';
export default function MobileMomentMedia({post,open}:{post:Post;open:(images:string[],index:number,origin:HTMLImageElement|null)=>void}) {
 const [aspect,setAspect]=useState('is-square');
 if(!post.images.length)return null;
 return <div className={`zy-mobile-moment-media count-${post.images.length} ${aspect}`}>{post.images.map((src,index)=><button type="button" key={src+'-'+index} aria-label={`查看第${index+1}张图片`} onClick={event=>open(post.images,index,event.currentTarget.querySelector('img'))}><img src={src} alt={`动态照片 ${index+1}`} onLoad={event=>{if(post.images.length!==1)return;const image=event.currentTarget;setAspect(image.naturalWidth>image.naturalHeight?'is-landscape':image.naturalWidth<image.naturalHeight?'is-portrait':'is-square');}}/></button>)}</div>;
}
