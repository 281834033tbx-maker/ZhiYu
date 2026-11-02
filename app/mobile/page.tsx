import type {Metadata} from 'next';
import Zhiyu from '../zhiyu/app';

export const metadata: Metadata = {
  title: '智域手机版',
  description: '智域独立手机样式预览：聊天、联系人、任务、动态与多功能。',
};

export default function MobileHome() {
  return <Zhiyu mode="mobile"/>;
}
