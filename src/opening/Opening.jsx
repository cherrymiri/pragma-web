import { useEffect, useState } from 'react';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import './opening.css';

// Shared intro for every love in 〈When Love Responds〉: a title column on the left, the meaning and how to take part on the right.
// Pass the words; layout and motion stay the same. accent sets the one colour that belongs to this love.
export default function Opening({ visible, eyebrow = 'WHEN LOVE RESPONDS', title, subtitle, description = [], howLabel = 'HOW TO EXPERIENCE', how = [], startLabel = '체험 시작', ready = true, onStart, accent = '#9fc9e3' }) {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), 1000);
    return () => clearTimeout(t);
  }, [visible]);
  if (!shown) return null;
  return (
    <section className={'opening' + (visible ? ' is-in' : ' is-out')} style={{ '--accent': accent }} aria-hidden={!visible}>
      <header className="opening-title-col">
        <p className="opening-eyebrow">{eyebrow}</p>
        <h1 className="opening-title">{title}</h1>
        <p className="opening-subtitle">{subtitle}</p>
        <span className="opening-mark" aria-hidden="true" />
      </header>
      <div className="opening-body">
        <div className="opening-desc">
          {description.map((d) => <p key={d}>{d}</p>)}
        </div>
        <div className="opening-how-block">
          <p className="opening-label">{howLabel}</p>
          <ul className="opening-how">
            {how.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      </div>
      <button type="button" className="opening-start" onClick={onStart} disabled={!ready || !visible}>
        <span>{startLabel}</span><span className="opening-arrow" aria-hidden="true">→</span>
      </button>
    </section>
  );
}
