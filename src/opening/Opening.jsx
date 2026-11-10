import { useEffect, useState } from 'react';
import './opening.css';

// Shared intro for every love in 〈When Love Responds〉. Pass the words; the layout and motion stay the same.
// accent sets the one colour that belongs to this love.
export default function Opening({ visible, eyebrow = 'WHEN LOVE RESPONDS', title, subtitle, description = [], howLabel = 'HOW TO EXPERIENCE', how = [], startLabel = '체험 시작 →', ready = true, onStart, accent = '#9fc9e3' }) {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), 1000);
    return () => clearTimeout(t);
  }, [visible]);
  if (!shown) return null;
  return (
    <section className={'opening' + (visible ? ' is-in' : ' is-out')} style={{ '--accent': accent }} aria-hidden={!visible}>
      <div className="opening-inner">
        <p className="opening-eyebrow">{eyebrow}</p>
        <h1 className="opening-title">{title}</h1>
        <p className="opening-subtitle">{subtitle}</p>
        <div className="opening-desc">
          {description.map((d) => <p key={d}>{d}</p>)}
        </div>
        <hr className="opening-rule" />
        <p className="opening-label">{howLabel}</p>
        <div className="opening-how">
          {how.map((d) => <p key={d}>{d}</p>)}
        </div>
      </div>
      <button type="button" className="opening-start" onClick={onStart} disabled={!ready || !visible}>{startLabel}</button>
    </section>
  );
}
