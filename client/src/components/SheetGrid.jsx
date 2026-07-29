import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// 엑셀 위장의 '진짜 시트' 프레임 — 열 머리글(A B C…) + 행 번호 거터(1 2 3…) + 셀 영역.
// 배경 격자를 body가 아니라 이 셀 영역(.sheet-body)에 직접 그린다. 자식(게임 콘텐츠)은
// 셀 영역 위에 얹히고, 셀 크기·열 수를 컨텍스트로 내려 손패·보드가 같은 격자를 공유한다.

const SheetContext = createContext({ cols: 14, cellW: 48, cellH: 36, bodyRef: { current: null } });
export const useSheet = () => useContext(SheetContext);

// 요소(anchor)를 시트 셀 영역(originRef) 격자 경계로 스냅 — 셀이 배경 격자에 정확히 포개짐.
// ⚠ 불변조건: anchorRef가 가리키는 요소에는 반환된 transform을 적용하지 말 것.
// getBoundingClientRect는 transform이 반영된 위치를 주므로, 측정 대상에 그대로 적용하면
// 재계산 시 잔여 오프셋이 0이 되어 스냅이 스스로 풀린다.
// → 항상 '측정용 부모(anchorRef)'와 '이동할 자식'을 분리해서 쓴다. (예: .rack-scroll 측정 → .rack-grid 이동)
export function useGridSnap(anchorRef, enabled, originRef) {
  const [snap, setSnap] = useState(null);
  const compute = useCallback(() => {
    if (!enabled) {
      setSnap(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const rs = getComputedStyle(document.documentElement);
    const w = parseFloat(rs.getPropertyValue('--cell-w')) || 48;
    const h = parseFloat(rs.getPropertyValue('--cell-h')) || 36;
    if (!w || !h) return;
    const r = el.getBoundingClientRect();
    const o = originRef?.current?.getBoundingClientRect();
    const off = (v, size) => {
      const m = ((v % size) + size) % size;
      return m <= size / 2 ? -m : size - m;
    };
    const next = { x: off(r.left - (o ? o.left : 0), w), y: off(r.top - (o ? o.top : 0), h) };
    // 값이 같으면 상태를 그대로 둔다 — 매 렌더 재측정해도 리렌더가 번지지 않게.
    setSnap((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
  }, [anchorRef, enabled, originRef]);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = anchorRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(compute);
    ro.observe(document.body);
    ro.observe(el);
    // '위치만' 바뀌는 리플로우(손패 줄 수 변화 등)는 자기 크기가 안 변해 놓친다.
    // 그런 이동은 항상 조상의 크기 변화에서 오므로 시트 셀 영역까지 조상 사슬을 함께 관찰한다.
    // (자식에 건 transform은 조상 크기를 바꾸지 않으므로 재측정 루프가 생기지 않는다.)
    const stop = originRef?.current ?? document.body;
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) ro.observe(a);
    if (originRef?.current) ro.observe(originRef.current);
    return () => ro.disconnect();
  }, [anchorRef, enabled, originRef, compute]);
  return snap;
}

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
  const rootRef = useRef(null);
  const bodyRef = useRef(null);
  const [m, setM] = useState(null); // { cols, rows, cellW, cellH }

  useEffect(() => {
    const el = bodyRef.current;
    const root = rootRef.current;
    if (!el || !root) return undefined;
    const measure = () => {
      // 아직 레이아웃 전(숨은 탭 등)이면 0이 나온다 — 그 값을 박으면 1행짜리 시트로 굳는다.
      if (!root.clientHeight || !el.clientWidth) return;
      const rs = getComputedStyle(document.documentElement);
      const cellW = parseFloat(rs.getPropertyValue('--cell-w')) || 48;
      const cellH = parseFloat(rs.getPropertyValue('--cell-h')) || 36;
      const headH = parseFloat(rs.getPropertyValue('--head-h')) || 22;
      const cols = Math.max(1, Math.floor(el.clientWidth / cellW));
      // 행 수는 '남은 화면 높이'에서 뽑는다. 콘텐츠 높이(scrollHeight) 기준으로 하면
      // 채팅이 길어질수록 행이 늘고 → 시트가 아래로 자라 메인이 스크롤되는 되먹임이 생긴다.
      const rows = Math.max(1, Math.floor((root.clientHeight - headH) / cellH));
      setM((prev) =>
        prev && prev.cols === cols && prev.rows === rows && prev.cellW === cellW && prev.cellH === cellH
          ? prev
          : { cols, rows, cellW, cellH }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(root);
    return () => ro.disconnect();
  }, [children]);

  const cols = m?.cols ?? 14;
  const rows = m?.rows ?? 30;
  const cellW = m?.cellW ?? 48;
  const cellH = m?.cellH ?? 36;

  // 활성 셀(A1)은 '표시만' 한다 — 엑셀 시그니처라 보이긴 해야 하지만, 클릭으로 옮기는
  // 기능은 뺐다. 게임 UI 위/뒤 어디를 눌러도 시트가 반응해서(채팅 뒤 셀이 선택되는 등)
  // 조작을 방해했고, 장식이라 얻는 것보다 잃는 게 컸다.
  const sel = { c: 0, r: 0 };

  return (
    <div className="sheet" ref={rootRef}>
      <div className="sheet-corner" />
      <div className="sheet-colhead">
        {Array.from({ length: cols }, (_, c) => (
          <span key={c} className={`sheet-col ${c === sel.c ? 'sel' : ''}`}>
            {colLabel(c)}
          </span>
        ))}
      </div>
      <div className="sheet-rowhead">
        {Array.from({ length: rows }, (_, r) => (
          <span key={r} className={`sheet-rownum ${r === sel.r ? 'sel' : ''}`}>
            {r + 1}
          </span>
        ))}
      </div>
      <div
        className="sheet-body"
        ref={bodyRef}
        style={{ '--cols': cols, '--rows': rows }}
      >
        {/* 활성 셀 표시 — pointer-events:none이라 게임 조작을 가로막지 않는다 */}
        <div className="xl-active" style={{ gridColumn: sel.c + 1, gridRow: sel.r + 1 }} />
        <SheetContext.Provider value={{ cols, rows, cellW, cellH, bodyRef }}>
          {children}
        </SheetContext.Provider>
      </div>
    </div>
  );
}
