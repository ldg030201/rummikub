// 엑셀 위장 크롬 — '엑셀 모드'에서 게임 화면을 감싸는 가짜 리본/수식줄/시트탭/상태바.
// 순수 장식(위장용)이라 게임 로직과 무관. 상태바 일부만 실제 게임 상태를 반영한다.

const RIBBON_TABS = ['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'];
// 그룹명 + 그 안의 도구 글리프. 외부 아이콘 에셋 없이 문자만으로 리본 실루엣을 만든다.
const RIBBON_GROUPS = [
  { name: '클립보드', items: ['📋', '✂', '🖌'] },
  { name: '글꼴', items: ['가', 'B', 'I', 'U'] },
  { name: '맞춤', items: ['≡', '⬒', '↩'] },
  { name: '표시 형식', items: ['%', '₩', '.00'] },
  { name: '스타일', items: ['▦', '▤', '▥'] },
  { name: '셀', items: ['⊞', '⊟', '⌗'] },
  { name: '편집', items: ['Σ', '↓', '🔍'] },
];
const SHEETS = ['실적요약', 'Sheet1', '참고'];

export function ExcelRibbon() {
  return (
    <div className="xl-ribbon" aria-hidden="true">
      <div className="xl-ribbon-tabs">
        {RIBBON_TABS.map((t) => (
          <span
            key={t}
            className={`xl-ribbon-tab ${t === '홈' ? 'active' : ''} ${t === '파일' ? 'file' : ''}`}
          >
            {t}
          </span>
        ))}
        <span className="xl-ribbon-collapse">∧</span>
      </div>
      {/* 그룹 = 도구 글리프 행 + 아래 그룹명 (실제 리본 구조). 우하단 ↘는 대화상자 표시기 */}
      <div className="xl-ribbon-body">
        {RIBBON_GROUPS.map((g) => (
          <div key={g.name} className="xl-rg">
            <div className="xl-rg-icons">
              {g.items.map((it, i) => (
                <span key={i} className="xl-rg-icon">
                  {it}
                </span>
              ))}
            </div>
            <div className="xl-rg-name">{g.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 수식 입력줄 — 위장 크롬이지만 '누가 편집 중인지'와 턴 타이머를 실어 나른다(그래서 aria-hidden 아님).
export function ExcelFormulaBar({ cell = 'A1', value = '', right = null }) {
  return (
    <div className="xl-formula">
      <span className="xl-namebox" aria-hidden="true">
        {cell}
      </span>
      <span className="xl-fx" aria-hidden="true">
        fx
      </span>
      <span className="xl-formula-input">{value}</span>
      {right && <span className="xl-formula-right">{right}</span>}
    </div>
  );
}

export function ExcelSheetTabs({ active = '실적요약' }) {
  return (
    <div className="xl-sheets" aria-hidden="true">
      <span className="xl-sheet-nav">◀&nbsp;▶</span>
      {SHEETS.map((s) => (
        <span key={s} className={`xl-sheet ${s === active ? 'active' : ''}`}>
          {s}
        </span>
      ))}
      <span className="xl-sheet-add">＋</span>
    </div>
  );
}

// 상태바: 왼쪽 모드(준비/입력) + 오른쪽 자동집계 흉내. count/sum은 실제 게임값을 흘려도 자연스럽다.
export function ExcelStatusBar({ mode = '준비', count, sum }) {
  return (
    <div className="xl-status" aria-hidden="true">
      <span className="xl-status-mode">{mode}</span>
      <span className="xl-status-spacer" />
      {sum != null && <span className="xl-status-agg">합계: {sum}</span>}
      {count != null && <span className="xl-status-agg">개수: {count}</span>}
      <span className="xl-status-agg">평균: —</span>
      <span className="xl-status-zoom">100%</span>
    </div>
  );
}
