import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.daryledwin.bus',
  appName: 'MyBus SG',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#f5f5f2ff',
      showSpinner: false,
      fadeOutDuration: 180
    }
  }
};

export default config;
