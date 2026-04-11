// Huddle LP 用のアイソメトリックSVGイラスト
// モノクロ + 黒ベース（#0f0f1a）。外部ライブラリ不使用、SVG直書き。
//
// 色の役割:
//   INK   #0f0f1a  輪郭・アクセント
//   DARK  #2a2a36  暗い面
//   MID   #55555c  中間
//   LIGHT #f5f5f7  上面（明るい面）
//   WHITE #ffffff  最明面・紙色

type Props = { className?: string };

const INK = "#0f0f1a";
const DARK = "#2a2a36";
const MID = "#55555c";
const LIGHT = "#f5f5f7";
const WHITE = "#ffffff";
const STROKE = 2;

// ─────────────────────────────────────────────
// ヒーロー用: チャットから決定事項カードが積み上がるイメージ
// ─────────────────────────────────────────────
export function IsoHeroStack({ className }: Props) {
  return (
    <svg
      viewBox="0 0 480 380"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* 薄い影 */}
      <ellipse cx="240" cy="348" rx="160" ry="14" fill={INK} opacity="0.06" />

      {/* 一番下のカード */}
      <g>
        <polygon
          points="100,280 280,200 380,240 200,320"
          fill={LIGHT}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="100,280 200,320 200,340 100,300"
          fill={DARK}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="380,240 200,320 200,340 380,260"
          fill={MID}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
      </g>

      {/* 中段カード */}
      <g>
        <polygon
          points="90,220 270,140 370,180 190,260"
          fill={WHITE}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="90,220 190,260 190,280 90,240"
          fill={DARK}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="370,180 190,260 190,280 370,200"
          fill={MID}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        {/* 中段カードのテキスト線 */}
        <line x1="150" y1="215" x2="300" y2="148" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <line x1="160" y1="230" x2="280" y2="177" stroke={MID} strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* 上段カード（メイン） */}
      <g>
        <polygon
          points="80,160 260,80 360,120 180,200"
          fill={WHITE}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="80,160 180,200 180,220 80,180"
          fill={DARK}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        <polygon
          points="360,120 180,200 180,220 360,140"
          fill={MID}
          stroke={INK}
          strokeWidth={STROKE}
          strokeLinejoin="round"
        />
        {/* テキスト線 */}
        <line x1="140" y1="155" x2="290" y2="88" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="150" y1="170" x2="280" y2="112" stroke={MID} strokeWidth="2" strokeLinecap="round" />
        <line x1="160" y1="185" x2="250" y2="145" stroke={MID} strokeWidth="2" strokeLinecap="round" />
        {/* 決定マーク (円 + チェック) */}
        <circle cx="325" cy="110" r="16" fill={INK} stroke={INK} strokeWidth="2" />
        <path d="M317 110 L322 115 L333 103" stroke={WHITE} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* 上に浮かぶチャット吹き出し */}
      <g transform="translate(60, 30)">
        <rect x="0" y="0" width="100" height="50" rx="10" fill={WHITE} stroke={INK} strokeWidth={STROKE} />
        <circle cx="25" cy="25" r="3" fill={INK} />
        <circle cx="45" cy="25" r="3" fill={INK} />
        <circle cx="65" cy="25" r="3" fill={INK} />
        <path d="M30 50 L25 65 L42 50 Z" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>

      {/* 破線の矢印 */}
      <path
        d="M100 75 Q 130 100, 160 130"
        stroke={INK}
        strokeWidth="2"
        fill="none"
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
      <path d="M156 128 L165 132 L158 138" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────
// Feature 01: ダッシュボード（縦棒グラフのアイソメ）
// ─────────────────────────────────────────────
export function IsoDashboard({ className }: Props) {
  return (
    <svg viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* ベースプレート */}
      <polygon points="30,140 120,90 210,140 120,190" fill={LIGHT} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      <polygon points="30,140 120,190 120,200 30,150" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      <polygon points="210,140 120,190 120,200 210,150" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />

      {/* 棒1 低 */}
      <g>
        <polygon points="60,132 75,124 75,88 60,96" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="60,96 75,88 95,98 80,106" fill={INK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="75,124 95,134 95,98 75,88" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>

      {/* 棒2 高 */}
      <g>
        <polygon points="95,142 110,134 110,60 95,68" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="95,68 110,60 130,70 115,78" fill={INK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="110,134 130,144 130,70 110,60" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>

      {/* 棒3 中 */}
      <g>
        <polygon points="130,152 145,144 145,95 130,103" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="130,103 145,95 165,105 150,113" fill={INK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="145,144 165,154 165,105 145,95" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>

      {/* 棒4 中高 */}
      <g>
        <polygon points="165,162 180,154 180,80 165,88" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="165,88 180,80 200,90 185,98" fill={INK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="180,154 200,164 200,90 180,80" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────
// Feature 02: Why / Due タグ付きドキュメント
// ─────────────────────────────────────────────
export function IsoTagDoc({ className }: Props) {
  return (
    <svg viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* ドキュメント本体 */}
      <g>
        <polygon points="60,170 180,110 200,130 80,190" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="60,170 80,190 80,200 60,180" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="200,130 80,190 80,200 200,140" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        {/* 本文ライン */}
        <line x1="90" y1="160" x2="170" y2="120" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="100" y1="168" x2="175" y2="130" stroke={MID} strokeWidth="2" strokeLinecap="round" />
        <line x1="105" y1="178" x2="160" y2="150" stroke={MID} strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* WHY タグ（左上に浮いている） */}
      <g transform="translate(40, 40)">
        <rect x="0" y="0" width="70" height="30" rx="4" fill={INK} stroke={INK} strokeWidth={STROKE} />
        <text x="35" y="21" textAnchor="middle" fill={WHITE} fontSize="13" fontWeight="700" fontFamily="system-ui">
          WHY
        </text>
        <line x1="60" y1="30" x2="110" y2="80" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" />
      </g>

      {/* DUE タグ（右上） */}
      <g transform="translate(150, 20)">
        <rect x="0" y="0" width="70" height="30" rx="4" fill={WHITE} stroke={INK} strokeWidth={STROKE} />
        <text x="35" y="21" textAnchor="middle" fill={INK} fontSize="13" fontWeight="700" fontFamily="system-ui">
          DUE
        </text>
        <line x1="20" y1="30" x2="40" y2="95" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" />
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────
// Feature 03: PDFエクスポート
// ─────────────────────────────────────────────
export function IsoPdfExport({ className }: Props) {
  return (
    <svg viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* 紙面（アイソメトリック） */}
      <g>
        <polygon points="60,120 150,60 220,95 130,155" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="60,120 130,155 130,165 60,130" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="220,95 130,155 130,165 220,105" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        {/* テキスト線 */}
        <line x1="85" y1="115" x2="160" y2="75" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <line x1="90" y1="125" x2="170" y2="85" stroke={MID} strokeWidth="2" strokeLinecap="round" />
        <line x1="95" y1="135" x2="150" y2="110" stroke={MID} strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* PDFラベル */}
      <g transform="translate(155, 45)">
        <rect x="0" y="0" width="46" height="22" rx="4" fill={INK} />
        <text x="23" y="16" textAnchor="middle" fill={WHITE} fontSize="11" fontWeight="800" fontFamily="system-ui">
          PDF
        </text>
      </g>

      {/* ダウンロード矢印（下方向） */}
      <g transform="translate(100, 155)">
        <line x1="20" y1="0" x2="20" y2="40" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M8 28 L20 42 L32 28" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="0" y1="52" x2="40" y2="52" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────
// Steps 用: チャット吹き出し・チェック・共有
// ─────────────────────────────────────────────
export function IsoChatBubble({ className }: Props) {
  return (
    <svg viewBox="0 0 180 160" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      {/* 影 */}
      <ellipse cx="90" cy="135" rx="60" ry="6" fill={INK} opacity="0.08" />
      {/* 大吹き出し */}
      <g>
        <polygon points="30,80 110,30 160,60 80,110" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="30,80 80,110 80,120 30,90" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="160,60 80,110 80,120 160,70" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        {/* チャットドット */}
        <circle cx="75" cy="78" r="4" fill={INK} />
        <circle cx="95" cy="66" r="4" fill={INK} />
        <circle cx="115" cy="54" r="4" fill={INK} />
      </g>
      {/* テール */}
      <polygon points="60,110 50,125 72,115" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
    </svg>
  );
}

export function IsoCheckCube({ className }: Props) {
  return (
    <svg viewBox="0 0 180 160" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <ellipse cx="90" cy="140" rx="55" ry="6" fill={INK} opacity="0.08" />
      {/* 立方体 */}
      <g>
        <polygon points="90,25 155,60 90,95 25,60" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="25,60 90,95 90,130 25,95" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="155,60 90,95 90,130 155,95" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        {/* 上面チェック */}
        <path d="M60 58 L78 70 L118 45" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function IsoShareArrow({ className }: Props) {
  return (
    <svg viewBox="0 0 180 160" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <ellipse cx="90" cy="140" rx="55" ry="6" fill={INK} opacity="0.08" />
      {/* 書類 */}
      <g>
        <polygon points="40,95 110,55 150,75 80,115" fill={WHITE} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="40,95 80,115 80,125 40,105" fill={DARK} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <polygon points="150,75 80,115 80,125 150,85" fill={MID} stroke={INK} strokeWidth={STROKE} strokeLinejoin="round" />
        <line x1="60" y1="90" x2="115" y2="60" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <line x1="65" y1="100" x2="125" y2="70" stroke={MID} strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* 矢印（右上へ飛ぶ共有アイコン） */}
      <g transform="translate(120, 20)">
        <line x1="0" y1="30" x2="40" y2="0" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M20 0 L40 0 L40 20" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
