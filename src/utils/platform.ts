/**
 * Platform detection and utility functions to handle differences between
 * React Native and Web environments.
 */

// Detect React Native environment
export const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

// Detect platform
export const Platform = {
  OS: isReactNative 
    ? (global as any).Platform?.OS || 'unknown' 
    : navigator.platform.includes('Win') ? 'windows' : 
      navigator.platform.includes('Mac') ? 'macos' : 
      navigator.platform.includes('Linux') ? 'linux' : 'web',
  
  // Helper function for platform-specific code
  select: (options: { web?: any; native?: any; ios?: any; android?: any; default?: any }) => {
    if (!isReactNative && options.web !== undefined) {
      return options.web;
    }
    
    if (isReactNative) {
      // React Native specific platform selection
      const os = (global as any).Platform?.OS;
      
      if (os === 'ios' && options.ios !== undefined) {
        return options.ios;
      }
      
      if (os === 'android' && options.android !== undefined) {
        return options.android;
      }
      
      if (options.native !== undefined) {
        return options.native;
      }
    }
    
    return options.default;
  }
};

// Media device handling for both platforms
export const MediaDevices = {
  /**
   * Request user media in a platform-agnostic way
   */
  getUserMedia: async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (isReactNative) {
      try {
        // In React Native, we would use the react-native-webrtc library
        const { mediaDevices } = require('react-native-webrtc');
        return await mediaDevices.getUserMedia(constraints);
      } catch (error) {
        console.error('Error accessing media in React Native:', error);
        throw error;
      }
    } else {
      // Web browser implementation
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        console.error('Error accessing media in web browser:', error);
        throw error;
      }
    }
  },
  
  /**
   * Enumerate devices in a platform-agnostic way
   */
  enumerateDevices: async (): Promise<MediaDeviceInfo[]> => {
    if (isReactNative) {
      try {
        // In React Native, we would use the react-native-webrtc library
        const { mediaDevices } = require('react-native-webrtc');
        return await mediaDevices.enumerateDevices();
      } catch (error) {
        console.error('Error enumerating devices in React Native:', error);
        return [];
      }
    } else {
      // Web browser implementation
      try {
        return await navigator.mediaDevices.enumerateDevices();
      } catch (error) {
        console.error('Error enumerating devices in web browser:', error);
        return [];
      }
    }
  }
};

// Storage handling for both platforms
export const Storage = {
  /**
   * Get item from storage
   */
  getItem: async (key: string): Promise<string | null> => {
    if (isReactNative) {
      try {
        // In React Native, we would use AsyncStorage
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        return await AsyncStorage.getItem(key);
      } catch (error) {
        console.error('Error getting item from AsyncStorage:', error);
        return null;
      }
    } else {
      // Web browser implementation
      return localStorage.getItem(key);
    }
  },
  
  /**
   * Set item in storage
   */
  setItem: async (key: string, value: string): Promise<void> => {
    if (isReactNative) {
      try {
        // In React Native, we would use AsyncStorage
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.setItem(key, value);
      } catch (error) {
        console.error('Error setting item in AsyncStorage:', error);
      }
    } else {
      // Web browser implementation
      localStorage.setItem(key, value);
    }
  }
};
