/**
 * 모식도 전수 갤러리 — 진입점.
 *
 * `src/main.jsx`와 다른 점만 적는다:
 *  · 라우터·react-query·전역 스토어를 **걸지 않는다.** 갤러리가 마운트하는 것은
 *    표시 계층 컴포넌트뿐이고(그 컴포넌트들의 import를 실제로 확인했다 — 라우터
 *    훅도 쿼리 훅도 없다), 프로바이더를 걸면 갤러리가 앱 배선을 흉내내게 된다.
 *  · `StrictMode`를 **쓰지 않는다.** StrictMode는 개발에서 이펙트를 2회 실행해
 *    WebGL 컨텍스트를 마운트당 2개 잡았다 놓는다 — 20종 × 단계를 늘어놓는 이 페이지에서는
 *    그 순간 초과분이 그대로 「빈 칸」이 되고, 빈 칸이 곧 오판이다.
 *  · `styles/index.css`를 **반드시** 들인다. tailwind content 글롭이
 *    `./index.html`·`./src/**`뿐이라 갤러리 파일에 쓴 유틸리티 클래스는 생성되지
 *    않지만, `src/**` 컴포넌트가 쓰는 클래스는 이 스타일시트 안에 이미 있다.
 *    ⇒ **갤러리 자신의 장식은 인라인 스타일로만** 한다(아래 파일들이 그 규약을 따른다).
 */
import ReactDOM from 'react-dom/client';
import '../src/styles/index.css';
import Gallery from './Gallery.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(<Gallery />);
