import { createContext, useContext, useEffect, useRef, useState } from 'react';

// 엑셀 위장의 '진짜 시트' 프레임 — 열 머리글(A B C…) + 행 번호 거터(1 2 3…) + 셀 영역.
// 배경 격자를 body가 아니라 이 셀 영역(.sheet-body)에 직접 그린다. 자식(게임 콘텐츠)은
// 셀 영역 위에 얹히고, 셀 크기·열 수를 컨텍스트로 내려 손패·보드가 같은 격자를 공유한다.

const SheetContext = createContext({ cols: 14, cellW: 48, cellH: 36, bodyRef: { current: null } });
export const useSheet = () => useContext(SheetContext);

// 0→A, 25→Z, 26→AA …
function colLabel(n) {
  let s = '';
  let k = n + 1;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

export function SheetGrid({ children }) {
  const bodyRef = useRef(null);
  const [m, setM] = useState(null); // { cols, rows, cellW, cellH }

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rs = getComputedStyle(document.documentElement);
      const cellW = parseFloat(rs.getPropertyValue('--cell-w')) || 48;
      const cellH = parseFloat(rs.getPropertyValue('--cell-h')) || 36;
      const cols = Math.max(1, Math.floor(el.clientWidth / cellW));
      const rows = Math.max(1, Math.ceil(el.scrollHeight / cellH));
      setM((prev) =>
        prev && prev.cols === cols && prev.rows === rows && prev.cellW === cellW && prev.cellH === cellH
          ? prev
          : { cols, rows, cellW, cellH }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const cols = m?.cols ?? 14;
  const rows = m?.rows ?? 30;

  return (
    <div className="sheet">
      <div className="sheet-corner" />
      <div className="sheet-colhead">
        {Array.from({ length: cols }, (_, c) => (
          <span key={c} className="sheet-col">
            {colLabel(c)}
          </span>
        ))}
      </div>
      <div className="sheet-rowhead">
        {Array.from({ length: rows }, (_, r) => (
          <span key={r} className="sheet-rownum">
            {r + 1}
          </span>
        ))}
      </div>
      <div className="sheet-body" ref={bodyRef}>
        <SheetContext.Provider
          value={{ cols, cellW: m?.cellW ?? 48, cellH: m?.cellH ?? 36, bodyRef }}
        >
          {children}
        </SheetContext.Provider>
      </div>
    </div>
  );
}
