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
          className="brand-wordmark brand-wordmark-dark"
          src="/brand/coin-desk-wordmark.svg"
          width="340"
          height="80"
          alt="Coin Desk"
        />
        <img
          className="brand-wordmark brand-wordmark-light"
          src="/brand/coin-desk-wordmark-light.svg"
          width="340"
          height="80"
          alt="Coin Desk"
        />
        <p>열린 C 프레임과 시간축을 따라 움직이는 선은 시장의 전체 이력과 흐름을 담습니다.</p>
        <div className="brand-colors">
          <span style={{ background: '#087b69', color: 'white' }}>Deep Teal · #087B69</span>
          <span style={{ background: '#51dac2', color: '#14202c' }}>Teal · #51DAC2</span>
          <span style={{ background: '#0b1014', color: '#d8e2ee' }}>Ink · #0B1014</span>
        </div>
        <div className="brand-downloads">
          <a href="/brand/coin-desk-mark.svg" download>
            심볼 SVG
          </a>
          <a href="/brand/coin-desk-wordmark.svg" download>
            로고 SVG
          </a>
          <a href="/brand/coin-desk-wordmark-light.svg" download>
            밝은 배경 SVG
          </a>
          <a href="/brand/coin-desk-wordmark-mono.svg" download>
            단색 SVG
          </a>
          <a href="/brand/icon-512.png" download>
            앱 아이콘 PNG
          </a>
          <a href="/favicon.ico" download>
            파비콘 ICO
          </a>
          <a href="/brand/og-card-v2.png" download>
            공유 썸네일 PNG
          </a>
        </div>
      </section>
      <section className="panel brand-mascot" aria-label="Coin Desk 안내 캐릭터">
        <img
          src="/brand/coin-desk-shiba.png"
          width="160"
          height="160"
          loading="lazy"
          alt="청록색 스카프를 두른 미니멀한 시바견 캐릭터"
        />
        <div>
          <h2>Coin Desk 시바견</h2>
          <p>분석 방법을 안내하는 캐릭터입니다. 공식 코인 로고나 매매 신호로 사용하지 않습니다.</p>
          <a href="/brand/coin-desk-shiba.png" download>캐릭터 PNG 저장</a>
        </div>
      </section>
      <section className="panel brand-preview">
        <h2>링크 공유 미리보기</h2>
        <img
          src="/brand/og-card-v2.png"
          alt="Coin Desk, 시장의 전체 흐름을 읽다. BTC DOGE ETH"
          width="1200"
          height="630"
          loading="lazy"
        />
        <p>심볼의 선은 브랜드 그래픽입니다. 실제 가격이나 수익률을 나타내지 않습니다.</p>
      </section>
    </div>
  );
}
