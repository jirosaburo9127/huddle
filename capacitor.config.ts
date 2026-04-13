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
    SplashScreen: {
      // アプリ起動時のスプラッシュを WebView の読み込み完了までキープする。
      // デフォルトだと 500ms で自動で消えて真っ白画面が出るので、
      // autoHide: false にして JS 側で window の onload / React マウント時に
      // SplashScreen.hide() を呼ぶ。
      launchAutoHide: false,
      // フォールバックとして最大10秒で強制的に非表示に
      launchShowDuration: 10000,
      backgroundColor: '#0f0f1a',
      showSpinner: false,
    },
  },
};

export default config;
