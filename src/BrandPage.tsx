import { Link } from 'react-router-dom';
import './brand.css';
export function BrandPage() {
  return (
    <div className="brand-page">
      <div className="page-heading">
        <div>
          <h1>보리차트</h1>
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
        <p>보리차트의 보리입니다.</p>
      </section>
    </div>
  );
}
