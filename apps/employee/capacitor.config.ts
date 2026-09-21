import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps this exact codebase into a real, installable Android
 * application — the same screens, the same API client, compiled into an
 * APK/AAB with native camera, push notification and secure-storage access.
 *
 * See docs/09-deployment.md for the full build procedure.
 */
const config: CapacitorConfig = {
  appId: 'com.adisystech.fieldops',
  appName: 'ADISYS FieldOps',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    // In development, point the device at the machine running the dev server:
    //   url: 'http://192.168.1.10:5174', cleartext: true
  },

  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#12161C',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#12161C',
      androidSpinnerStyle: 'small',
      spinnerColor: '#E3131B',
      showSpinner: true,
    },
    Camera: {
      // Receipts only ever need to be legible, not high resolution. Smaller
      // files upload far more reliably on a weak field connection.
      quality: 80,
      allowEditing: false,
      saveToGallery: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
