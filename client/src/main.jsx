import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ls } from './storage.js';
import './styles.css';
import './theme-excel.css';

// 테마를 첫 렌더 '전에' 건다. App의 useEffect로만 걸면 첫 페인트가 기본 테마로 나가서
// (1) 테마가 번쩍이고 (2) 엑셀의 .app{height:100vh;overflow:hidden}이 없는 채로
// 시트가 콘텐츠만큼 늘어난 높이를 SheetGrid가 측정해 행 수가 폭주한다.
document.documentElement.setAttribute('data-theme', ls.get('rk_theme') || 'default');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
