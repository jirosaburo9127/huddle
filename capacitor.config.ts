import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jirosaburo.huddle',
  appName: 'Huddle',
  webDir: 'public',
  server: {
    url: 'https://huddle-sigma-flax.vercel.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'Huddle',
  },
  plugins: {
    PushNotifications: {
      // フォアグラウンド時もバナー・サウンド・バッジを表示する
      // （別ワークスペースの新着を見落とさないため）
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
