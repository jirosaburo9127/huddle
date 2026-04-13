// パスワード強度検証（サインアップ・設定画面で使い回す）
// 要件: 12文字以上、大小英字・数字・記号をそれぞれ1文字以上、一般的な弱いパスワードを拒否

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
