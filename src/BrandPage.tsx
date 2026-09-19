import { Link } from 'react-router-dom';
import './brand.css';

export function BrandPage() {
  return (
    <div className="brand-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">COIN DESK IDENTITY</div>
          <h1>시장의 전체 흐름을 읽다</h1>
          <p>전체 가격 이력부터 온체인 지표까지, 나의 코인 분석 대시보드.</p>
        </div>
        <Link className="desk-button" to="/">
          대시보드로
        </Link>
      </div>
      <section className="panel brand-showcase" aria-label="Coin Desk 공식 화면용 브랜드 자산">
        <img
          className="brand-wordmark"
          src="/brand/coin-desk-wordmark.svg"
          width="340"
          height="80"
          alt="Coin Desk"
        />
        <p>
          열린 C 프레임은 시장을 넓게 바라보는 창을, 세 개의 선은 서로 다른 시장의 움직임을
          담습니다.
        </p>
        <div className="brand-colors">
          <span style={{ background: '#f2ba72', color: '#14202c' }}>Amber · #F2BA72</span>
          <span style={{ background: '#70d4c4', color: '#14202c' }}>Teal · #70D4C4</span>
          <span style={{ background: '#0d1118', color: '#d8e2ee' }}>Midnight · #0D1118</span>
        </div>
        <div className="brand-downloads">
          <a href="/brand/coin-desk-mark.svg" download>
            심볼 SVG
          </a>
          <a href="/brand/coin-desk-wordmark.svg" download>
            로고 SVG
          </a>
          <a href="/brand/icon-512.png" download>
            앱 아이콘 PNG
          </a>
          <a href="/favicon.ico" download>
            파비콘 ICO
          </a>
          <a href="/brand/og-card-v1.png" download>
            공유 썸네일 PNG
          </a>
        </div>
      </section>
      <section className="panel brand-preview">
        <h2>링크 공유 미리보기</h2>
        <img
          src="/brand/og-card-v1.png"
          alt="Coin Desk, 시장의 전체 흐름을 읽다. BTC DOGE ETH"
          width="1733"
          height="907"
          loading="lazy"
        />
        <p>
          썸네일의 곡선은 브랜드를 위한 일러스트입니다. 실제 가격이나 수익률을 나타내지 않습니다.
        </p>
      </section>
    </div>
  );
}
