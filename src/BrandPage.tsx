import { Link } from 'react-router-dom';
import './brand.css';
export function BrandPage() {
  return (
    <div className="brand-page">
      <div className="page-heading">
        <div>
          <h1>보리차트</h1>
          <p>시세를 훑고, 지표를 깊게 보는 코인 서비스</p>
        </div>
        <Link to="/">시장으로</Link>
      </div>
      <section className="brand-showcase" aria-label="보리차트 브랜드">
        <div className="brand-new-lockup">
          <img
            src="/brand/coin-desk-shiba-smile.png"
            width="64"
            height="64"
            alt="보리, 웃고 있는 시바견"
          />
          <strong>보리차트</strong>
        </div>
        <p>
          보리차트의 시바견, 보리입니다. 로고와 빈 관심목록에만 사용하고, 차트와 수치는 가리지
          않습니다.
        </p>
        <div className="brand-colors">
          <span style={{ background: '#ffffff', color: '#202633' }}>배경 · #FFFFFF</span>
          <span style={{ background: '#0f666b', color: '#ffffff' }}>강조 · #0F666B</span>
          <span style={{ background: '#ffffff', color: '#b62d43' }}>상승 +</span>
          <span style={{ background: '#ffffff', color: '#255db8' }}>하락 −</span>
        </div>
        <p>
          현재 가격, 확정된 지표값, 작성자의 해석을 구분합니다. 상승·하락은 색상과 부호를 함께
          표시합니다.
        </p>
        <a href="/brand/coin-desk-shiba-smile.png" download>
          보리 이미지 저장
        </a>
      </section>
    </div>
  );
}
