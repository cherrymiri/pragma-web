import { useEffect, useRef, useSyncExternalStore } from 'react';
import { store } from './store.js';
import { Stage } from './stage/Stage.js';

const useStore = () => useSyncExternalStore(store.subscribe, store.snapshot);
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function App() {
  const host = useRef(null);
  const stage = useRef(null);
  const s = useStore();
  useEffect(() => {
    const st = new Stage(host.current);
    window.__PRAGMA_STAGE = st;
    stage.current = st;
    st.load().catch((e) => { console.error(e); store.set({ error: true }); });
    return () => st.dispose();
  }, []);

  const pourOn = (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); stage.current?.setPour(true); };
  const pourOff = () => stage.current?.setPour(false);

  useEffect(() => {
    const off = () => stage.current?.setPour(false);
    const hide = () => document.hidden && off();
    window.addEventListener('blur', off);
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('blur', off); document.removeEventListener('visibilitychange', hide); };
  }, []);

  const full = s.waterLevel >= 1;
  const PROMPTS = { 1: '사랑을 원하는 만큼 따라보세요.', 2: '뚜껑을 가져와 돌려 닫아보세요.', 3: '텀블러를 기울여보세요.', 4: '', 5: '조금 더 맞춰볼까요?', 6: '' };
  const prompt = PROMPTS[s.step];
  const adjusting = (s.step === 2 || s.step === 5) && s.lidAligned;
  const sub = adjusting ? (coarse ? '뚜껑을 좌우로 밀어 돌려보세요' : '휠을 아래로 굴려 돌려보세요') : '';
  const canClose = s.step === 1 && s.waterLevel >= 0.02;

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
        <div className="actions">
          {s.step === 1 && (
            <button
              type="button"
              className={'pour' + (s.isPouring ? ' is-on' : '')}
              disabled={full || !s.ready}
              onPointerDown={pourOn}
              onPointerUp={pourOff}
              onPointerCancel={pourOff}
              onLostPointerCapture={pourOff}
              onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); stage.current?.setPour(true); } }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') pourOff(); }}
              onContextMenu={(e) => e.preventDefault()}
            >사랑 따르기</button>
          )}
          {canClose && <button type="button" className="step-btn" onClick={() => stage.current?.closeLid()}>뚜껑 닫기</button>}
          {s.canTilt && <button type="button" className="step-btn" onClick={() => stage.current?.startTilt()}>기울여 보기</button>}
          {s.ended && <button type="button" className="step-btn" onClick={() => stage.current?.reset()}>다시 체험하기</button>}
        </div>
      </div>
      {!s.ready && <div className="loading">{s.error ? '3D를 불러오지 못했어요. 새로고침해 주세요.' : ''}</div>}
    </div>
  );
}
