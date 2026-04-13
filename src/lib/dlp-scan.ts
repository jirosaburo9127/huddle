// DLP (Data Loss Prevention): 送信前の機密情報検出
// クライアント側の誤爆防止用。あくまで警告、強制ブロックはしない。
// 検出: クレジットカード番号(Luhnチェック)・マイナンバー・APIキー風文字列・パスワードぽい宣言

export type DlpFinding = {
  type:
    | "credit_card"
    | "my_number"
    | "api_key"
    | "password_disclosure";
  label: string;
  // 検出マッチのプレビュー（先頭6文字 + *****）
  preview: string;
};

// Luhn アルゴリズム（カード番号の妥当性チェック）
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function mask(s: string): string {
  if (s.length <= 6) return s;
  return s.slice(0, 6) + "*".repeat(Math.min(s.length - 6, 6));
}

export function scanForSensitiveData(text: string): DlpFinding[] {
  const findings: DlpFinding[] = [];

  // 1. クレジットカード番号 (13〜19桁、スペース/ハイフン許容、Luhn通過必須)
  const cardMatches = text.match(/\b(?:\d[\s-]?){13,19}\b/g);
  if (cardMatches) {
    for (const raw of cardMatches) {
      const digits = raw.replace(/[\s-]/g, "");
      if (digits.length < 13 || digits.length > 19) continue;
      if (!luhnCheck(digits)) continue;
      findings.push({
        type: "credit_card",
        label: "クレジットカード番号",
        preview: mask(digits),
      });
    }
  }

  // 2. マイナンバー (12桁、前後に数字でないもの)
  // 完全な検算はしないが、「マイナンバー」「個人番号」のキーワード近傍 or 単独12桁を検知
  const myNumberMatches = text.match(/(?:マイナンバー|個人番号)[:：\s]*(\d{12})|\b(\d{12})\b/g);
  if (myNumberMatches) {
    for (const raw of myNumberMatches) {
      const digits = raw.match(/\d{12}/)?.[0];
      if (!digits) continue;
      // 文脈キーワードなしの純粋12桁は誤検出が多いのでキーワード付きのみに絞る
      if (!/マイナンバー|個人番号/.test(raw)) continue;
      findings.push({
        type: "my_number",
        label: "マイナンバー",
        preview: mask(digits),
      });
    }
  }

  // 3. API キー/シークレット (高エントロピー文字列 + よくあるプレフィックス)
  const apiKeyPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g, label: "Stripe Secret Key" },
    { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "Google API Key" },
    { re: /\bghp_[A-Za-z0-9]{36}\b/g, label: "GitHub Personal Access Token" },
    { re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g, label: "GitHub Fine-grained PAT" },
    { re: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS Access Key ID" },
    { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: "Slack Token" },
    { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: "JWT" },
  ];
  for (const { re, label } of apiKeyPatterns) {
    const matches = text.match(re);
    if (matches) {
      for (const m of matches) {
        findings.push({
          type: "api_key",
          label,
          preview: mask(m),
        });
      }
    }
  }

  // 4. パスワード開示 (「パスワード:」「password:」の後ろに単語)
  const pwMatches = text.match(/(?:パスワード|password|passwd|pwd)[:：=\s]+([^\s　]{4,})/gi);
  if (pwMatches) {
    for (const raw of pwMatches) {
      const value = raw.replace(/(?:パスワード|password|passwd|pwd)[:：=\s]+/i, "").trim();
      if (!value) continue;
      findings.push({
        type: "password_disclosure",
        label: "パスワードの記載",
        preview: mask(value),
      });
    }
  }

  return findings;
}
