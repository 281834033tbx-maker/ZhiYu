import CharacterWindowClient from './character-window-client';
import PageErrorBoundary from '../zhiyu/page-error-boundary';

export default function CharacterWindowPage() {
  return <PageErrorBoundary><CharacterWindowClient /></PageErrorBoundary>;
}
