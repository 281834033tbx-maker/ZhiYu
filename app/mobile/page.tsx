import type {Metadata} from 'next';
import Zhiyu from '../zhiyu/app';
import PageErrorBoundary from '../zhiyu/page-error-boundary';

export const metadata: Metadata = {
  title: '智域手机版',
  description: '智域独立手机样式预览：消息、智友、任务、动态与我。',
};

export default function MobileHome() {
  return <PageErrorBoundary><Zhiyu mode="mobile"/></PageErrorBoundary>;
}
