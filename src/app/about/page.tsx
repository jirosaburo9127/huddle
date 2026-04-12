import Link from "next/link";
import type { Metadata } from "next";
import {
  IsoHeroStack,
  IsoDashboard,
  IsoTagDoc,
  IsoPdfExport,
  IsoChatBubble,
  IsoCheckCube,
  IsoShareArrow,
} from "./illustrations";

export const metadata: Metadata = {
  title: "Huddle — 会議で決まったこと、全部どこ行った？",
  description:
    "チャットで流れる「決まったこと」を、チームの資産として永久に残す。招待制のセキュアなチームチャット Huddle。14日間無料。",
  openGraph: {
    title: "Huddle — 会議で決まったこと、全部どこ行った？",
    description:
      "チャットで流れる「決まったこと」を、チームの資産として永久に残す。招待制のセキュアなチームチャット Huddle。",
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-[#0f0f1a] antialiased">
      {/* ───────── ナビゲーション ───────── */}
      {/* アプリに戻るバー（ログイン済みユーザー向け） */}
      <div className="sticky top-0 z-50 bg-[#0f0f1a] text-white text-center py-2 px-4">
        <a
          href="/"
          className="text-sm font-medium hover:underline inline-flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          アプリに戻る
        </a>
      </div>
      <nav className="sticky top-10 z-50 bg-white/90 backdrop-blur border-b border-[#ececec]">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3">
          <Link href="/about" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/logo-transparent.png"
              alt="Huddle"
              className="w-8 h-8"
            />
            <span className="font-bold text-xl tracking-tight">Huddle</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/login"
              className="text-sm text-[#55555c] hover:text-[#0f0f1a] transition-colors"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="text-xs sm:text-sm font-semibold bg-[#0f0f1a] text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-black transition-colors whitespace-nowrap"
            >
              無料で試す
            </Link>
          </div>
        </div>
      </nav>

      {/* ───────── ① ヒーロー ───────── */}
      <section className="px-5 pt-16 pb-20 sm:pt-24 sm:pb-28 border-b border-[#ececec] overflow-hidden relative">
        {/* 背景のグラデ円 */}
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-gradient-to-br from-[#f5f5f7] to-transparent rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative">
          <div className="text-center lg:text-left">
            <div className="inline-block text-xs font-semibold tracking-widest uppercase text-[#55555c] bg-[#f5f5f7] border border-[#ececec] rounded-full px-3 py-1 mb-8 lp-fade-up">
              Decision Record for Teams
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.15] mb-6 lp-fade-up lp-delay-100">
              会議で決まったこと、
              <br />
              全部どこ行った？
            </h1>
            <p className="text-base sm:text-xl text-[#55555c] leading-[1.85] mb-10 lp-fade-up lp-delay-200">
              チャットで流れていった「決まったこと」を、
              <br className="hidden sm:block" />
              チームの資産として永久に残す。
              <br className="hidden sm:block" />
              それが Huddle です。
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start items-center lp-fade-up lp-delay-300">
              <Link
                href="/signup"
                className="group relative w-full sm:w-auto bg-[#0f0f1a] text-white text-lg font-semibold px-8 py-4 rounded-xl overflow-hidden hover:shadow-2xl hover:shadow-[#0f0f1a]/20 hover:-translate-y-0.5 transition-all duration-300"
              >
                <span className="relative z-10 flex items-center gap-2 justify-center">
                  14日間無料ではじめる
                  <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </span>
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto text-[#55555c] hover:text-[#0f0f1a] transition-colors px-6 py-4 text-sm font-medium"
              >
                すでにアカウントをお持ちの方 →
              </Link>
            </div>
            <p className="mt-6 text-xs text-[#8a8a92] lp-fade-up lp-delay-400">
              クレジットカード不要 ／ いつでも解約できます
            </p>
          </div>

          {/* イラスト（ゆらり浮かぶ） */}
          <div className="flex justify-center lg:justify-end lp-fade-left lp-delay-500">
            <div className="lp-float">
              <IsoHeroStack className="w-full max-w-[480px] h-auto drop-shadow-[0_20px_40px_rgba(15,15,26,0.08)]" />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── ② 痛み提示 ───────── */}
      <section className="px-5 py-20 sm:py-28 bg-[#fafafb] border-b border-[#ececec] relative overflow-hidden">
        {/* 背景ドットパターン */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, #0f0f1a 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden="true"
        />
        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-14 lp-reveal">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-3">
              こんなこと、ありませんか？
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
              会議で決まったことが、
              <br className="sm:hidden" />
              埋もれていく。
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <PainCard
              number="01"
              Icon={PainIconChat}
              title="Slackでは流れる"
              body="決定した瞬間は盛り上がっても、翌週には誰も検索できない。ピン留めしても忘れる。"
              delay="lp-delay-100"
            />
            <PainCard
              number="02"
              Icon={PainIconDoc}
              title="Chatwork / LINEでは埋もれる"
              body="タスクとチャットが混在。決定事項だけを後から追いかけるのが難しい。履歴も消える。"
              delay="lp-delay-300"
            />
            <PainCard
              number="03"
              Icon={PainIconMail}
              title="メールでは分散する"
              body="誰が何をいつ決めたか、Ccの順序やスレッドの断片に散る。顧問先との履歴が整理できない。"
              delay="lp-delay-500"
            />
          </div>
        </div>
      </section>

      {/* ───────── ③ Huddleとは ───────── */}
      <section className="px-5 py-20 sm:py-28 border-b border-[#ececec]">
        <div className="max-w-3xl mx-auto text-center lp-reveal">
          <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-4">
            What is Huddle?
          </p>
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight mb-8">
            チャットの顔をした、
            <br />
            意思決定の保管庫。
          </h2>
          <p className="text-base sm:text-lg text-[#55555c] leading-[2]">
            普段のチャットはそのまま使えます。違うのは「決定」ボタン。
            <br />
            メッセージに一度触れるだけで、決定事項として自動的に記録され、
            <br />
            ダッシュボードで一覧され、PDFで配布できます。
            <br />
            <span className="text-[#0f0f1a] font-semibold">
              決まったことが、資産になる。
            </span>
          </p>
        </div>
      </section>

      {/* ───────── ④ 主要3機能 ───────── */}
      <section className="px-5 py-20 sm:py-28 bg-[#fafafb] border-b border-[#ececec]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14 lp-reveal">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-3">
              Features
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
              Huddleだけの3つの武器
            </h2>
          </div>
          <div className="space-y-16">
            <FeatureRow
              number="01"
              title="決定事項ダッシュボード"
              body="ワークスペース全体の「決まったこと」を1箇所に集約。チャンネル別・期間別（今週・今月）のフィルタで、振り返りが一瞬で終わります。"
              tags={["自動集約", "チャンネル横断", "期間フィルタ"]}
              illustration={<IsoDashboard className="w-full h-auto" />}
            />
            <FeatureRow
              number="02"
              title="Why / Due で背景を残す"
              body="決定事項に「なぜその結論に至ったか」と「いつまでに実行するか」を後から追記できます。3ヶ月後に見返しても文脈が失われません。"
              tags={["背景・理由", "期限", "資産化"]}
              illustration={<IsoTagDoc className="w-full h-auto" />}
              reverse
            />
            <FeatureRow
              number="03"
              title="PDFエクスポート / 外部共有"
              body="今週決まったことを1枚のPDFにまとめて、クライアントや顧問先に共有。ログイン不要の外部共有リンクも発行できます。"
              tags={["PDF出力", "ログイン不要の共有", "伴走マイスター向け"]}
              illustration={<IsoPdfExport className="w-full h-auto" />}
            />
          </div>
        </div>
      </section>

      {/* ───────── ⑤ 使い方3ステップ ───────── */}
      <section className="px-5 py-20 sm:py-28 border-b border-[#ececec]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14 lp-reveal">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-3">
              How it works
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
              使い方は、たった3ステップ。
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <StepCard
              step="STEP 1"
              title="チャットで会話する"
              body="いつも通りチームで会話。チャンネルは招待制で、見せたい人にだけ見せられます。"
              illustration={<IsoChatBubble className="w-full h-full" />}
              delay="lp-delay-100"
            />
            <StepCard
              step="STEP 2"
              title="決定ボタンを押す"
              body="重要な結論が出たら、メッセージに「決定」ボタン。必要なら Why / Due を追記。"
              illustration={<IsoCheckCube className="w-full h-full" />}
              delay="lp-delay-300"
            />
            <StepCard
              step="STEP 3"
              title="ダッシュボードで配布"
              body="決定事項がダッシュボードに自動集約。PDF出力・外部共有リンクで展開。"
              illustration={<IsoShareArrow className="w-full h-full" />}
              delay="lp-delay-500"
            />
          </div>
        </div>
      </section>

      {/* ───────── ⑥ 比較表 ───────── */}
      <section className="px-5 py-20 sm:py-28 bg-[#fafafb] border-b border-[#ececec]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14 lp-reveal">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-3">
              Comparison
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
              他のツールと、何が違うのか。
            </h2>
          </div>
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full min-w-[600px] text-left text-sm sm:text-base">
              <thead>
                <tr className="border-b-2 border-[#0f0f1a]">
                  <th className="py-4 px-4 font-semibold"></th>
                  <th className="py-4 px-4 font-semibold text-[#55555c]">
                    Slack
                  </th>
                  <th className="py-4 px-4 font-semibold text-[#55555c]">
                    Chatwork
                  </th>
                  <th className="py-4 px-4 font-bold text-[#0f0f1a] bg-[#f5f5f7] rounded-t-xl">
                    Huddle
                  </th>
                </tr>
              </thead>
              <tbody>
                <CompRow label="チャット" s="○" c="○" h="○" />
                <CompRow
                  label="決定事項の集約"
                  s="—"
                  c="—"
                  h="✅"
                  highlight
                />
                <CompRow
                  label="Why / Due 追記"
                  s="—"
                  c="—"
                  h="✅"
                  highlight
                />
                <CompRow
                  label="PDFで配布"
                  s="—"
                  c="—"
                  h="✅"
                  highlight
                />
                <CompRow
                  label="外部共有（ログイン不要）"
                  s="—"
                  c="—"
                  h="✅"
                  highlight
                />
                <CompRow
                  label="完全招待制チャンネル"
                  s="△"
                  c="○"
                  h="✅"
                />
                <CompRow label="日本語設計" s="△" c="○" h="○" />
                <CompRow label="東京リージョン" s="—" c="○" h="○" />
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-xs text-[#8a8a92] text-center">
            ※ 2026年4月時点の各社公開情報に基づく。Huddleは「意思決定の記録」に
            特化しており、汎用チャットとは性格が異なります。
          </p>
        </div>
      </section>

      {/* ───────── ⑦ 料金 ───────── */}
      <section className="px-5 py-20 sm:py-28 border-b border-[#ececec]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14 lp-reveal">
            <p className="text-sm font-semibold tracking-widest uppercase text-[#55555c] mb-3">
              Pricing
            </p>
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
              シンプルに、1プラン。
            </h2>
            <p className="mt-4 text-[#55555c]">
              複数プランで迷わせません。必要な機能は全部入り。
            </p>
          </div>
          <div className="bg-white border-2 border-[#0f0f1a] rounded-3xl p-8 sm:p-12 shadow-xl shadow-[#0f0f1a]/10 lp-reveal lp-lift hover:shadow-[0_30px_60px_-20px_rgba(15,15,26,0.3)]">
            <div className="text-center mb-8">
              <div className="inline-block text-xs font-semibold tracking-widest uppercase bg-[#0f0f1a] text-white rounded-full px-3 py-1 mb-4">
                Standard
              </div>
              <div className="flex items-baseline justify-center gap-2 mb-2">
                <span className="text-5xl sm:text-6xl font-bold">1,500</span>
                <span className="text-lg text-[#55555c]">円 / 人・月</span>
              </div>
              <p className="text-sm text-[#8a8a92]">
                税別 ／ 14日間無料トライアル
              </p>
            </div>
            <ul className="space-y-3 mb-10 max-w-sm mx-auto">
              <Benefit>無制限のチャンネル・ダイレクトメッセージ</Benefit>
              <Benefit>決定事項ダッシュボード（チャンネル別・期間別）</Benefit>
              <Benefit>PDFエクスポート（日本語ベクター対応）</Benefit>
              <Benefit>ログイン不要の外部共有リンク</Benefit>
              <Benefit>Why / Due による決定事項への背景追記</Benefit>
              <Benefit>2段階認証・監査ログ・東京リージョン</Benefit>
              <Benefit>iOSアプリ（プッシュ通知対応）</Benefit>
            </ul>
            <Link
              href="/signup"
              className="block w-full text-center bg-[#0f0f1a] text-white text-lg font-semibold py-4 rounded-xl hover:bg-black transition-colors"
            >
              14日間無料ではじめる
            </Link>
            <p className="mt-4 text-xs text-[#8a8a92] text-center">
              クレジットカード不要 ／ いつでも解約できます
            </p>
          </div>
        </div>
      </section>

      {/* ───────── ⑧ 最終CTA ───────── */}
      <section className="px-5 py-24 sm:py-32 bg-[#0f0f1a] text-white relative overflow-hidden">
        {/* 背景ドットパターン */}
        <div
          className="absolute inset-0 opacity-[0.05] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
          aria-hidden="true"
        />
        <div className="max-w-3xl mx-auto text-center relative lp-reveal">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight mb-8">
            会議で決まったこと、
            <br />
            ちゃんと残しませんか？
          </h2>
          <p className="text-base sm:text-lg text-white/70 mb-10 leading-relaxed">
            14日間、すべての機能を無料で試せます。
            <br />
            途中で合わなくても、何も請求されません。
          </p>
          <Link
            href="/signup"
            className="group relative inline-block bg-white text-[#0f0f1a] text-lg font-bold px-10 py-5 rounded-xl hover:bg-[#f5f5f7] transition-all duration-300 shadow-2xl hover:-translate-y-1 hover:shadow-[0_30px_60px_-10px_rgba(255,255,255,0.3)]"
          >
            <span className="flex items-center gap-2">
              無料ではじめる
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </span>
          </Link>
          <p className="mt-6 text-xs text-white/50">
            すでにアカウントをお持ちの方は{" "}
            <Link href="/login" className="underline hover:text-white">
              こちらからログイン
            </Link>
          </p>
        </div>
      </section>

      {/* ───────── フッター ───────── */}
      <footer className="px-5 py-12 bg-white border-t border-[#ececec]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/logo-transparent.png"
              alt="Huddle"
              className="w-7 h-7"
            />
            <span className="font-bold text-lg">Huddle</span>
          </div>
          <div className="flex gap-6 text-sm text-[#55555c]">
            <Link href="/login" className="hover:text-[#0f0f1a] transition-colors">
              ログイン
            </Link>
            <Link href="/signup" className="hover:text-[#0f0f1a] transition-colors">
              無料で試す
            </Link>
          </div>
          <div className="text-xs text-[#8a8a92]">
            © 2026 Huddle. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}

// ───────── サブコンポーネント ─────────

function PainCard({
  number,
  Icon,
  title,
  body,
  delay = "",
}: {
  number: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  delay?: string;
}) {
  return (
    <div
      className={`group relative bg-white border border-[#ececec] rounded-2xl p-7 lp-lift lp-fade-up hover:border-[#0f0f1a] hover:shadow-[0_20px_50px_-20px_rgba(15,15,26,0.25)] ${delay}`}
    >
      {/* コーナー番号 */}
      <div className="absolute top-4 right-5 text-xs font-bold tracking-widest text-[#c8c8d0] group-hover:text-[#0f0f1a] transition-colors">
        {number}
      </div>
      {/* アイコン（四角いモノクロバッジ） */}
      <div className="mb-5 inline-flex items-center justify-center w-14 h-14 rounded-xl bg-[#0f0f1a] text-white group-hover:rotate-[-4deg] group-hover:scale-105 transition-transform duration-500">
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="font-bold text-lg mb-2 tracking-tight">{title}</h3>
      <p className="text-sm text-[#55555c] leading-[1.8]">{body}</p>
      {/* hover時に下部にアンダーラインが伸びる */}
      <div className="absolute bottom-0 left-7 right-7 h-[2px] bg-[#0f0f1a] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-500" />
    </div>
  );
}

// ───────── Pain アイコン（モノクロラインアート） ─────────

function PainIconChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <circle cx="8.5" cy="10" r="0.8" fill="currentColor" />
      <circle cx="12" cy="10" r="0.8" fill="currentColor" />
      <circle cx="15.5" cy="10" r="0.8" fill="currentColor" />
    </svg>
  );
}

function PainIconDoc({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function PainIconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function FeatureRow({
  number,
  title,
  body,
  tags,
  illustration,
  reverse = false,
}: {
  number: string;
  title: string;
  body: string;
  tags: string[];
  illustration: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`group flex flex-col ${
        reverse ? "md:flex-row-reverse" : "md:flex-row"
      } gap-8 md:gap-12 items-center lp-reveal`}
    >
      <div className="md:w-5/12 flex justify-center">
        <div className="relative w-full max-w-[280px]">
          <div className="absolute -top-4 -left-2 text-6xl font-bold text-[#ececec] leading-none select-none group-hover:text-[#d8d8e0] transition-colors duration-500">
            {number}
          </div>
          <div className="relative group-hover:scale-[1.03] group-hover:-translate-y-1 transition-transform duration-500">
            {illustration}
          </div>
        </div>
      </div>
      <div className="md:w-7/12">
        <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          {title}
        </h3>
        <p className="text-[#55555c] leading-relaxed mb-4">{body}</p>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="text-xs bg-[#f5f5f7] border border-[#ececec] rounded-full px-3 py-1 text-[#55555c] hover:bg-[#0f0f1a] hover:text-white hover:border-[#0f0f1a] transition-colors cursor-default"
            >
              #{t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  body,
  illustration,
  delay = "",
}: {
  step: string;
  title: string;
  body: string;
  illustration: React.ReactNode;
  delay?: string;
}) {
  return (
    <div
      className={`group bg-white border border-[#ececec] rounded-2xl p-6 lp-lift lp-fade-up hover:border-[#0f0f1a] hover:shadow-[0_20px_50px_-20px_rgba(15,15,26,0.25)] ${delay}`}
    >
      <div className="mb-2 flex justify-center">
        <div className="w-32 h-28 flex items-center justify-center group-hover:scale-105 group-hover:-translate-y-1 transition-transform duration-500">
          {illustration}
        </div>
      </div>
      <div className="text-xs font-bold tracking-widest text-[#8a8a92] mb-2 text-center group-hover:text-[#0f0f1a] transition-colors">
        {step}
      </div>
      <h3 className="font-bold text-xl mb-3 text-center">{title}</h3>
      <p className="text-sm text-[#55555c] leading-relaxed text-center">
        {body}
      </p>
    </div>
  );
}

function CompRow({
  label,
  s,
  c,
  h,
  highlight = false,
}: {
  label: string;
  s: string;
  c: string;
  h: string;
  highlight?: boolean;
}) {
  return (
    <tr className="border-b border-[#ececec]">
      <td className="py-4 px-4 font-medium">{label}</td>
      <td className="py-4 px-4 text-[#8a8a92] text-center">{s}</td>
      <td className="py-4 px-4 text-[#8a8a92] text-center">{c}</td>
      <td
        className={`py-4 px-4 text-center font-bold ${
          highlight ? "bg-[#f5f5f7] text-[#0f0f1a]" : "text-[#0f0f1a]"
        }`}
      >
        {h}
      </td>
    </tr>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[#0f0f1a]">
      <svg
        className="w-5 h-5 shrink-0 mt-0.5 text-[#0f0f1a]"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-sm leading-relaxed">{children}</span>
    </li>
  );
}
