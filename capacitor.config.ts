import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.daryledwin.bus',
  appName: 'MyBus SG',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#e6f6ffff',
      showSpinner: false,
      fadeOutDuration: 180
    }
  }
};

export default config;
