import { Link } from 'react-router-dom';
import './brand.css';
export function BrandPage() {
  return (
    <div className="brand-page">
      <div className="page-heading">
        <div>
          <h1>Coin Desk</h1>
          <p>시세를 훑고, 지표를 깊게 보는 코인 서비스</p>
        </div>
        <Link to="/">시장으로</Link>
      </div>
      <section className="brand-showcase" aria-label="Coin Desk 브랜드">
        <div className="brand-new-lockup">
          <img
            src="/brand/coin-desk-shiba-smile.png"
            width="100"
            height="100"
            alt="웃고 있는 시바견"
          />
          <strong>Coin Desk</strong>
        </div>
        <p>
          Coin Desk의 강아지 캐릭터입니다. 로고와 빈 관심목록에만 사용하고, 차트와 수치는 가리지
          않습니다.
        </p>
        <div className="brand-colors">
          <span style={{ background: '#101216', color: '#edf0f5' }}>배경 · #101216</span>
          <span style={{ background: '#a8b5f7', color: '#101216' }}>강조 · #A8B5F7</span>
          <span style={{ background: '#191c22', color: '#ff7f8b' }}>상승 +</span>
          <span style={{ background: '#191c22', color: '#7faaff' }}>하락 −</span>
        </div>
        <p>
          현재 가격, 확정된 지표값, 작성자의 해석을 구분합니다. 상승·하락은 색상과 부호를 함께
          표시합니다.
        </p>
        <a href="/brand/coin-desk-shiba-smile.png" download>
          강아지 이미지 저장
        </a>
      </section>
    </div>
  );
}
