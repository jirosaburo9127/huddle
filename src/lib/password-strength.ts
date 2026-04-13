// パスワード強度検証（サインアップ・設定画面で使い回す）
// 要件: 12文字以上、大小英字・数字・記号をそれぞれ1文字以上、一般的な弱いパスワードを拒否
// HaveIBeenPwned の漏洩パスワード DB と突き合わせる（k-anonymity なのでパスワード本体は送信されない）

const WEAK_PASSWORDS = new Set([
  "password", "password1", "password12", "password123",
  "12345678", "123456789", "1234567890",
  "qwerty", "qwertyui", "qwerty123",
  "abcdefgh", "abc12345",
  "letmein", "welcome", "admin123",
  "huddle", "huddle123",
]);

export type PasswordStrength = {
  valid: boolean;
  errors: string[];
  /** 0..4 の強度スコア（UIゲージ表示用） */
  score: number;
};

export function validatePassword(password: string): PasswordStrength {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push("12文字以上で入力してください");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("英小文字を1文字以上含めてください");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("英大文字を1文字以上含めてください");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("数字を1文字以上含めてください");
  }
  if (!/[!-/:-@[-`{-~]/.test(password)) {
    errors.push("記号を1文字以上含めてください");
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    errors.push("よく使われるパスワードは使用できません");
  }

  // スコア計算: 要件を満たした数 + 長さボーナス
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[!-/:-@[-`{-~]/.test(password)) score++;

  return {
    valid: errors.length === 0,
    errors,
    score: Math.min(score, 4),
  };
}

/**
 * HaveIBeenPwned Pwned Passwords API v3 で漏洩済みパスワードかチェックする。
 * k-anonymity: パスワードのSHA-1ハッシュの先頭5文字だけ送信し、
 * 残りはブラウザで突き合わせる。パスワード本体は絶対に外に出ない。
 *
 * 返り値: 漏洩が見つかった回数（0 = クリーン、>0 = 漏洩済み）
 * API が落ちている等の場合は null を返す（可用性優先で通す）
 */
export async function checkPasswordBreached(
  password: string
): Promise<number | null> {
  try {
    // SHA-1 ハッシュを計算
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    // HIBP API: /range/{5文字prefix} で該当候補リストを取得
    // Add-Padding ヘッダでレスポンスサイズを一定化し、レスポンス長から特定されるのを防ぐ
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return null;

    const text = await res.text();
    // レスポンスは "SUFFIX:COUNT" 行の羅列
    for (const line of text.split("\n")) {
      const [rest, countStr] = line.trim().split(":");
      if (rest === suffix) {
        return parseInt(countStr || "0", 10);
      }
    }
    return 0;
  } catch {
    // ネットワーク/CSP等で失敗 → 可用性優先で null（通す）
    return null;
  }
}
