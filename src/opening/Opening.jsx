import { useEffect, useState } from 'react';
import './opening.css';

// The shared 〈When Love Responds〉 opening, the same system as EROS and LUDUS:
// kicker, serif title, Korean subtitle, rule, description, guide, start button — centred, revealed in sequence.
// Each love only changes its words and its colours (opening.css).
export default function Opening({ visible, kicker = 'WHEN LOVE RESPONDS', title, subtitle, description = [], guide = [], startLabel = '체험 시작하기', ready = true, onStart, label }) {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), 900);
    return () => clearTimeout(t);
  }, [visible]);
  if (!shown) return null;
  // the last two words of each line stay together, so a narrow screen never leaves one word on its own
  const glue = (l) => l.replace(/ (\S+)$/, '\u00a0$1');
  const lines = (arr) => arr.map((l, i) => <span key={l}>{i > 0 && <br />}{glue(l)}</span>);
  return (
    <section className={'opening' + (visible ? '' : ' closing')} aria-label={label || `${title} 오프닝`} aria-hidden={!visible}>
      <div className="op-inner">
        <p className="op-kicker">{kicker}</p>
        <h1 className="op-title">{title}</h1>
        <p className="op-sub">{subtitle}</p>
        <i className="op-rule" aria-hidden="true" />
        <p className="op-desc">{lines(description)}</p>
        <p className="op-guide">{lines(guide)}</p>
        <button type="button" className="op-btn" onClick={onStart} disabled={!ready || !visible}>{startLabel}</button>
      </div>
    </section>
  );
}
