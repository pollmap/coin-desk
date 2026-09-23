import { useEffect, useRef, useState, type ReactNode } from 'react';
export function DeferredMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={visible ? '' : 'lazy-region'}>
      {visible ? (
        children
      ) : (
        <button className="desk-button" onClick={() => setVisible(true)}>
          지표 차트 불러오기
        </button>
      )}
    </div>
  );
}
