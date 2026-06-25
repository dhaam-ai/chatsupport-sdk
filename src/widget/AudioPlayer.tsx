import React, { useRef, useState } from 'react';

interface Props {
  src: string;
  isCustomer: boolean;
}

export const CompactAudioPlayer = React.memo(function CompactAudioPlayer({ src, isCustomer }: Props) {
  const audioRef             = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent]   = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    playing ? a.pause() : a.play();
  };

  const fmt = (s: number) =>
    !isFinite(s) || isNaN(s) ? '0:00' : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const accent  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';
  const trackBg = isCustomer ? 'rgba(255,255,255,0.25)' : '#e5e7eb';
  const fillBg  = isCustomer ? 'rgba(255,255,255,0.9)' : '#5b4fcf';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '210px', height: '40px' }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        style={{ display: 'none' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrent(0); }}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (!a?.duration) return;
          setCurrent(a.currentTime);
          setProgress(a.currentTime / a.duration);
        }}
        onLoadedMetadata={() => {
          const a = audioRef.current;
          if (a) setDuration(a.duration);
        }}
      />
      <button
        onClick={toggle}
        style={{ flexShrink: 0, width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${accent}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, padding: 0 }}
      >
        {playing
          ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16" rx="1" /><rect x="15" y="4" width="4" height="16" rx="1" /></svg>
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div
          style={{ height: '3px', borderRadius: '2px', background: trackBg, cursor: 'pointer', position: 'relative' }}
          onClick={e => {
            const a = audioRef.current;
            if (!a?.duration) return;
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
          }}
        >
          <div style={{ height: '100%', width: `${progress * 100}%`, background: fillBg, borderRadius: '2px', transition: 'width 0.1s linear' }} />
        </div>
        <div style={{ fontSize: '9px', color: accent, opacity: 0.8, lineHeight: 1 }}>{fmt(current)} / {fmt(duration || 0)}</div>
      </div>
    </div>
  );
});
