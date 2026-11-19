export function SpatialWallpaper() {
  return (
    <div className="sd-wallpaper" aria-hidden="true">
      <div className="sd-wallpaper-art">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="sd-ribbon" x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="#b7d4b5" />
              <stop offset="0.48" stopColor="#458d75" />
              <stop offset="1" stopColor="#0b5147" />
            </linearGradient>
            <linearGradient id="sd-edge" x1="0" x2="1">
              <stop stopColor="#e6efda" />
              <stop offset="1" stopColor="#8ab7a1" />
            </linearGradient>
            <linearGradient id="sd-cube" x1="0" x2="1" y2="1">
              <stop stopColor="#ebf4dd" />
              <stop offset="1" stopColor="#84b7a0" />
            </linearGradient>
            <pattern
              id="sd-grid"
              width="56"
              height="56"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M56 0H0V56"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.65"
              />
            </pattern>
            <radialGradient id="sd-fade">
              <stop stopColor="white" />
              <stop offset="1" stopColor="black" />
            </radialGradient>
            <mask id="sd-grid-mask">
              <ellipse
                cx="800"
                cy="750"
                rx="900"
                ry="450"
                fill="url(#sd-fade)"
              />
            </mask>
          </defs>
          <g className="sd-grid-plane" mask="url(#sd-grid-mask)">
            <path
              d="M-400 160H2000V1200H-400Z"
              fill="url(#sd-grid)"
              transform="translate(0 200) rotate(-17 800 600) skewX(30)"
            />
          </g>
          <g
            className="sd-orbit-ring"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            opacity="0.25"
          >
            <ellipse
              cx="740"
              cy="610"
              rx="660"
              ry="290"
              transform="rotate(-28 740 610)"
            />
            <ellipse
              cx="740"
              cy="610"
              rx="705"
              ry="315"
              transform="rotate(-28 740 610)"
            />
            <ellipse
              cx="740"
              cy="610"
              rx="745"
              ry="345"
              transform="rotate(-28 740 610)"
            />
          </g>
          <g className="sd-ribbon-object">
            <path
              d="M-100 820C140 1030 240 675 390 660S480 1030 760 850S1080 850 1160 1050"
              fill="none"
              stroke="#164f4230"
              strokeWidth="96"
              transform="translate(18 24)"
            />
            <path
              d="M-100 820C140 1030 240 675 390 660S480 1030 760 850S1080 850 1160 1050"
              fill="none"
              stroke="url(#sd-ribbon)"
              strokeWidth="90"
            />
            <path
              d="M-100 782C140 992 240 637 390 622S480 992 760 812S1080 812 1160 1012"
              fill="none"
              stroke="url(#sd-edge)"
              strokeWidth="3"
            />
          </g>
          <g className="sd-orbit-object" transform="translate(815 192)">
            <path d="M0 0L52-30L104 0L52 30Z" fill="url(#sd-cube)" />
            <path d="M0 0L52 30V90L0 60Z" fill="#609e86" />
            <path d="M52 30L104 0V60L52 90Z" fill="#32765f" />
            <path
              d="M52 30V90M0 0L52 30L104 0"
              fill="none"
              stroke="#d9ecd5"
              strokeWidth="1"
            />
          </g>
          <g className="sd-orbit-object" transform="translate(1360 650)">
            <path d="M0 0L70-40L140 0L70 40Z" fill="url(#sd-cube)" />
            <path d="M0 0L70 40V112L0 72Z" fill="#639a82" />
            <path d="M70 40L140 0V72L70 112Z" fill="#2d6959" />
            <path
              d="M16 10L70-22L124 10M70 40V112"
              fill="none"
              stroke="#c9e2c4"
            />
          </g>
          <g
            className="sd-orbit-object"
            transform="translate(200 470) rotate(-25)"
          >
            <rect
              width="65"
              height="65"
              rx="17"
              fill="none"
              stroke="url(#sd-ribbon)"
              strokeWidth="14"
            />
            <rect
              x="-5"
              y="-5"
              width="65"
              height="65"
              rx="17"
              fill="none"
              stroke="#bfd8bc"
              strokeWidth="2"
            />
          </g>
          <g fill="currentColor" opacity="0.4">
            <circle cx="1040" cy="220" r="4" />
            <circle cx="310" cy="560" r="3" />
            <circle cx="1300" cy="420" r="3" />
            <path
              d="M1110 730h20m-10-10v20M370 210h14m-7-7v14"
              stroke="currentColor"
            />
          </g>
        </svg>
        <div className="sd-wallpaper-coordinate">
          VDA / SPATIAL INTELLIGENCE
          <br />
          06 PERSPECTIVES · INFINITE POSSIBILITIES
        </div>
      </div>
    </div>
  );
}
