// /public/js/ui/debug.js - 화면 위 로그 출력 도구

// 로그를 표시할 DOM 요소를 한 번만 생성합니다.
function getLogContainer() {
  let container = document.getElementById('on-screen-debug-log');
  if (!container) {
    container = document.createElement('div');
    container.id = 'on-screen-debug-log';
    // --- 스타일 ---
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '60px', // 하단 탭 바 위로
      left: '10px',
      right: '10px',
      zIndex: '99999',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      color: '#fff',
      padding: '10px',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      maxHeight: '30vh',
      overflowY: 'auto',
      border: '1px solid #444',
      opacity: '0.9'
    });
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 화면에 로그 메시지를 출력합니다.
 * @param {string} label - 로그 제목
 * @param {any} data - 출력할 데이터 (객체, 문자열 등)
 */
export function logToScreen(label, data) {
  const container = getLogContainer();
  const pre = document.createElement('pre');
  
  let content;
  try {
    content = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
  } catch (e) {
    content = '[Circular Reference or Unstringifiable Object]';
  }

  pre.textContent = `[${label}] ${content}`;
  
  Object.assign(pre.style, {
    margin: '0 0 5px 0',
    padding: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all'
  });

  container.appendChild(pre);
  container.scrollTop = container.scrollHeight;
}

/**
 * 화면 로그를 모두 지웁니다.
 */
export function clearLogScreen() {
  const container = document.getElementById('on-screen-debug-log');
  if (container) {
    container.innerHTML = '';
  }
}
