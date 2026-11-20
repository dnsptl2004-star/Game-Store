import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gamevault.app',
  appName: 'GameVault',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    allowNavigation: [
      'indian-garment-1.onrender.com',
      'localhost:5000'
    ]
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
