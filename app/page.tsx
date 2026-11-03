import Zhiyu from './zhiyu/app';
import PageErrorBoundary from './zhiyu/page-error-boundary';
export default function Home() {
  return <div className="zy-desktop-stage"><PageErrorBoundary><Zhiyu /></PageErrorBoundary></div>;
}
