'use client';

import './chat-image-placeholder.css';

export default function ChatImagePlaceholder({label = '图片未能加载', onRetry, className = ''}: {
  label?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const icon = <svg viewBox="0 0 48 40" aria-hidden="true"><path d="M5 2h38a3 3 0 0 1 3 3v30a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm1 4v20l11-11 11 11 7-7 7 7V6H6Z" fill="currentColor"/></svg>;
  const classes = `chat-image-placeholder ${className}`.trim();
  return onRetry
    ? <button type="button" className={classes} onClick={onRetry} aria-label={`${label}，点击重试`} title={`${label}，点击重试`}>{icon}</button>
    : <div className={classes}>{icon}<span className="chat-image-placeholder-label">{label}</span></div>;
}
