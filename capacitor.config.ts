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
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
    // ステータスバー領域（時計・Wi-Fi）の親ビュー背景を黒に統一する
    backgroundColor: '#000000',
  },
  plugins: {
    PushNotifications: {
      // フォアグラウンド時もバナー・サウンド・バッジを表示する
      // （別ワークスペースの新着を見落とさないため）
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 10000,
      backgroundColor: '#0f0f1a',
      showSpinner: false,
    },
  },
};

export default config;
