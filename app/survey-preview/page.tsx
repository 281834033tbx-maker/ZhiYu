import type {Metadata} from 'next';
import SurveyPreview from './client';

export const metadata:Metadata={title:'智域 · 问卷内容预览',robots:{index:false,follow:false}};
export default function SurveyPreviewPage(){return <SurveyPreview/>;}
