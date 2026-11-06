import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store } from './store.js';
import { Stage } from './stage/Stage.js';

const useStore = () => useSyncExternalStore(store.subscribe, store.snapshot);
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function App() {
  const host = useRef(null);
  const stage = useRef(null);
  const s = useStore();
  const [prompted2, setPrompted2] = useState(false);

  useEffect(() => {
    const st = new Stage(host.current);
    window.__PRAGMA_STAGE = st;
    stage.current = st;
    st.load().catch((e) => { console.error(e); store.set({ error: true }); });
    return () => st.dispose();
  }, []);

  // the prompt moves on shortly after the first pour stops, and steps back if they pour again
  useEffect(() => {
    if (s.isPouring) { setPrompted2(false); return; }
    if (!s.hasPoured) return;
    const t = setTimeout(() => setPrompted2(true), 900);
    return () => clearTimeout(t);
  }, [s.isPouring, s.hasPoured]);

  const pourOn = (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); stage.current?.setPour(true); };
  const pourOff = () => stage.current?.setPour(false);

  useEffect(() => {
    const off = () => stage.current?.setPour(false);
    const hide = () => document.hidden && off();
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('blur', off); document.removeEventListener('visibilitychange', hide); };
  }, []);

  const holding = s.lidMode === 'dragging' || s.lidMode === 'seating' || s.lidAligned;
  const lidStage = s.step === 2 || holding || (s.hasPoured && prompted2);
  const showPour = !holding;
  const full = s.waterLevel >= 1;

  let prompt = '사랑을 원하는 만큼 따라보세요.';
  if (lidStage) prompt = '뚜껑을 가져와 돌려 닫아보세요.';
  let sub = '';
  if (s.lidAligned) sub = coarse ? '뚜껑을 좌우로 밀어 돌려보세요' : '휠을 아래로 굴려 돌려보세요';

  return (
    <div className={'app' + (s.ready ? ' is-ready' : '')}>
      <div ref={host} className="stage" aria-label="PRAGMA 텀블러 3D 장면" />
      <header className="hud-top">
        <h1>PRAGMA</h1>
        <p className="subtitle">오래된 사랑</p>
      </header>
      <div className="hud-bottom">
        <p className="prompt" aria-live="polite" key={prompt}>{prompt}</p>
        <p className="sub" key={sub || 'none'}>{sub}</p>
        <button
          type="button"
          className={'pour' + (s.isPouring ? ' is-on' : '') + (showPour ? '' : ' is-away')}
          disabled={full || !s.ready || !showPour}
          onPointerDown={pourOn}
          onPointerUp={pourOff}
          onPointerCancel={pourOff}
          onLostPointerCapture={pourOff}
          onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); stage.current?.setPour(true); } }}
          onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') pourOff(); }}
          onContextMenu={(e) => e.preventDefault()}
        >사랑 따르기</button>
      </div>
      {!s.ready && <div className="loading">{s.error ? '3D를 불러오지 못했어요. 새로고침해 주세요.' : ''}</div>}
    </div>
  );
}
