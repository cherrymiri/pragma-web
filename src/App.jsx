import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store } from './store.js';
import { Stage } from './stage/Stage.js';
import Opening from './opening/Opening.jsx';
import { sound } from './sound.js';

const useStore = () => useSyncExternalStore(store.subscribe, store.snapshot);
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function App() {
  const host = useRef(null);
  const stage = useRef(null);
  const s = useStore();
  const [intro, setIntro] = useState(true);
  const [replay, setReplay] = useState(false);
  const [veil, setVeil] = useState(false);
  const start = () => { sound.start(); setIntro(false); };
  // back to the first pour: a short fade covers the reset so nothing is seen half-way
  const restart = () => {
    setReplay(false); setVeil(true);
    stage.current?.setPour(false);
    setTimeout(() => { stage.current?.reset(); setVeil(false); }, 480);
  };
  const toOpening = () => {
    setReplay(false); setIntro(true);
    setTimeout(() => stage.current?.reset(), 950);
  };
  useEffect(() => {
    if (!s.ending) return;
    const t = setTimeout(() => setReplay(true), 4600);       // both lines in, then a moment of stillness
    return () => clearTimeout(t);
  }, [s.ending]);
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
  const PROMPTS = { 1: '사랑을 원하는 만큼 따라보세요.', 2: '뚜껑을 가져와 돌려 닫아보세요.', 3: '텀블러를 기울여보세요.', 4: '아직 틈이 남아 있어요.', 5: '조금 더 맞춰볼까요?', 6: '' };
  const prompt = PROMPTS[s.step];
  const adjusting = (s.step === 2 || s.step === 5) && s.lidAligned;
  let sub = '';
  if (adjusting) sub = coarse ? '뚜껑을 좌우로 밀어 돌려보세요' : '휠을 아래로 굴려 돌려보세요';
  if (s.step === 3 && !s.checking) sub = coarse ? '텀블러를 옆으로 밀어 표시된 곳까지 기울여요' : '텀블러를 잡고 옆으로 끌어 표시된 곳까지 기울여요';
  const canClose = s.step === 1 && s.waterLevel >= 0.02;

  return (
    <div className={'app' + (s.ready ? ' is-ready' : '')}>
      <div ref={host} className="stage" aria-label="PRAGMA 텀블러 3D 장면" />
      {!intro && (
        <nav className="hud-corner" aria-label="체험 이동">
          <button type="button" className="corner-btn quiet" onClick={toOpening}>처음 화면</button>
          <button type="button" className="corner-btn" onClick={restart}><span className="corner-icon" aria-hidden="true">↺</span>처음부터 다시 하기</button>
        </nav>
      )}
      <div className={'veil' + (veil ? ' is-on' : '')} />
      <header className="hud-top">
        <h1>PRAGMA</h1>
        <p className="subtitle">오래된 사랑</p>
      </header>
      {s.ending && (
        <div className="ending" lang="ko">
          <span className="ending-rule" />
          <p className="ending-line l1"><span className="ko">같아질 필요는 없어,</span><span className="en" lang="en">We don’t need to become the same,</span></p>
          <p className="ending-line l2"><span className="ko">서로의 모양을 배우면 되니까.</span><span className="en" lang="en">we just need to learn each other’s shape.</span></p>
        </div>
      )}
      <div className={'hud-bottom' + (s.ending ? ' is-ending' : '')}>
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
          {s.canTilt && <button type="button" className="step-btn" onClick={() => stage.current?.startTilt()}>기울여 확인하기</button>}
          {replay && <button type="button" className="step-btn" onClick={restart}>다시 체험하기</button>}
        </div>
      </div>
      <Opening
        visible={intro}
        title="PRAGMA"
        subtitle="오래된 사랑"
        description={[
          '프라그마(Pragma)는 현실적인 이해와 조율을 통해 오래도록 이어가는 사랑을 말합니다.',
          '사랑은 처음부터 완벽하게 맞는 것이 아니라, 서로의 차이를 이해하고 함께할 방법을 찾아가는 과정입니다.',
        ]}
        how={['사랑을 원하는 만큼 채우고, 뚜껑을 맞춰 닫아보세요.', '텀블러를 기울였을 때 물이 새지 않도록 조절해 보세요.']}
        startLabel="체험 시작"
        ready={s.ready}
        onStart={start}
      />
      {!s.ready && !intro && <div className="loading">{s.error ? '3D를 불러오지 못했어요. 새로고침해 주세요.' : ''}</div>}
    </div>
  );
}
