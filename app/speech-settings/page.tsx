import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import RealtimeSpeechSettings from '../zhiyu/realtime-speech-settings';

export default function SpeechSettingsPage() {
  return <main className="zy-realtime-page">
    <div className="zy-realtime-page-card">
      <header className="zy-realtime-page-header">
        <h1>实时语音连接配置</h1>
        <Link href="/"><ArrowLeft size={14} aria-hidden="true" />返回智域</Link>
      </header>
      <RealtimeSpeechSettings />
    </div>
  </main>;
}
