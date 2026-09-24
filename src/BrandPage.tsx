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
        <div className="brand-new-lockup">
          <img src="/brand/coin-desk-shiba-smile.png" width="100" height="100" alt="웃는 시바견" />
          <strong>
            Coin<span>Desk</span>
          </strong>
        </div>
        <p>웃는 시바견과 청록색 포인트. 복잡한 시장을 편하게 살펴보는 개인 분석 공간입니다.</p>
        <div className="brand-colors">
          <span style={{ background: '#087b69', color: 'white' }}>Deep Teal · #087B69</span>
          <span style={{ background: '#51dac2', color: '#14202c' }}>Teal · #51DAC2</span>
          <span style={{ background: '#0b1014', color: '#d8e2ee' }}>Ink · #0B1014</span>
        </div>
        <div className="brand-downloads">
          <a href="/brand/coin-desk-shiba-smile.png" download>
            시바견 브랜드 이미지 PNG
          </a>
        </div>
      </section>
      <section className="panel brand-mascot" aria-label="Coin Desk 안내 캐릭터">
        <img
          src="/brand/coin-desk-shiba-smile.png"
          width="160"
          height="160"
          loading="lazy"
          alt="청록색 스카프를 두르고 웃는 Coin Desk 시바견"
        />
        <div>
          <h2>Coin Desk 시바견</h2>
          <p>분석 방법을 안내하는 캐릭터입니다. 공식 코인 로고나 매매 신호로 사용하지 않습니다.</p>
          <a href="/brand/coin-desk-shiba-smile.png" download>
            캐릭터 PNG 저장
          </a>
        </div>
      </section>
      <section className="panel brand-preview">
        <h2>링크 공유 미리보기</h2>
        <img
          src="/brand/coin-desk-shiba-smile.png"
          alt="Coin Desk, 시장의 전체 흐름을 읽다. BTC DOGE ETH"
          width="1254"
          height="1254"
          loading="lazy"
        />
        <p>사이트 아이콘과 링크 미리보기에도 같은 시바견을 사용합니다.</p>
      </section>
    </div>
  );
}
