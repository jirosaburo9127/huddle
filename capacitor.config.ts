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
};

export default config;
