import React, { useState, useEffect } from 'react';
import './FCMNotificationPage.css';

// Firebase imports
// Note: You'll need to run: npm install firebase

const FCMNotificationPage: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [firebaseConfig, setFirebaseConfig] = useState({
    apiKey: 'AIzaSyBP9uiRZVn8AJIsPLphhS6k7oPPDx9p0Bw', // You need to get this from Firebase Console > Project Settings > General tab
    authDomain: 'io3-vsight-firebase.firebaseapp.com',
    projectId: 'io3-vsight-firebase',
    messagingSenderId: '981602755865', // You need to get this from Firebase Console > Project Settings > Cloud Messaging tab
    appId: '1:981602755865:web:3972da54f85a465bd45188' // You need to get this from Firebase Console > Project Settings > General tab
  });

  // Utility function to detect dev environment
  const isDevEnvironment = () => {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1';
  };

  // Initialize Firebase with dynamic config
  const initializeFirebase = async () => {
    try {
      setErrorMessage(null);
      
      // Import Firebase dynamically
      const { initializeApp } = await import('firebase/app');
      const { getMessaging, getToken, onMessage, isSupported } = await import('firebase/messaging');
      
      // Initialize Firebase
      const app = initializeApp(firebaseConfig);
      
      // Check if messaging is supported in this browser
      if (!(await isSupported())) {
        setErrorMessage('Firebase Cloud Messaging is not supported in this browser');
        return;
      }
      
      const messaging = getMessaging(app);
      
      // Request permission first and check result
      const hasPermission = await requestNotificationPermission();
      
      if (!hasPermission) {
        setErrorMessage('Notification permission is required to get FCM token. Please enable notifications in your browser settings and try again.');
        return;
      }

      // Options for getting token - for development environments with SSL issues
      const tokenOptions: any = {
        vapidKey: 'BDI_K1riiqrFaDWHmWQ9uknVPPY0A2beCDNnJsYIqnfCRBAPQieWhU97kJlNYtoqipf1tFTs2_oothRJCkgyyJQ'
      };
      
      // Handle different service worker scenarios
      const isDev = isDevEnvironment();
      
      if (isDev) {
        console.log('🚀 Running in development mode');
        
        if (window.location.protocol === 'http:') {
          // For HTTP in development, use getToken WITHOUT service worker registration
          // This forces the SDK to use a "WindowController" instead of a "ServiceWorkerController"
          console.log('🔔 Using foreground-only mode (no background notifications)');
          // Don't set serviceWorkerRegistration at all - leave it undefined
        } else {
          // For HTTPS in dev, try to register the service worker but don't fail if it doesn't work
          try {
            const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            console.log('✅ Service worker registered - background notifications should work');
            tokenOptions.serviceWorkerRegistration = swRegistration;
          } catch (swError) {
            console.warn('⚠️ Service worker registration failed, using foreground-only mode');
            // Skip service worker registration - this will use foreground-only mode
          }
        }
      } else {
        // In production, let Firebase handle the service worker registration normally
        console.log('💼 Running in production mode');
      }
      
      // Get FCM token
      const token = await getToken(messaging, tokenOptions).catch(err => {
        console.error('Failed to get FCM token:', err);
        if (err.code === 'messaging/permission-blocked') {
          setErrorMessage('Notification permission is blocked. Please enable notifications in your browser settings and refresh the page.');
        } else if (err.code === 'messaging/failed-service-worker-registration') {
          setErrorMessage('Service worker registration failed. This is likely due to an SSL certificate issue in development. You can continue testing with foreground notifications only.');
        } else {
          setErrorMessage(`Failed to get FCM token: ${err.message}`);
        }
        return null;
      });
      
      if (token) {
        console.log('FCM Token:', token);
        setFcmToken(token);
        
        // Set up message listener
        onMessage(messaging, (payload) => {
          console.log('Message received:', payload);
          setNotifications(prev => [...prev, {
            id: Date.now(),
            title: payload.notification?.title || 'No title',
            body: payload.notification?.body || 'No body',
            data: payload.data || {},
            timestamp: new Date().toLocaleTimeString()
          }]);
        });
        
        setIsInitialized(true);
      }
    } catch (error) {
      console.error('Firebase initialization error:', error);
      setErrorMessage(`Firebase initialization error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Request notification permission
  const requestNotificationPermission = async () => {
    try {
      if (!('Notification' in window)) {
        setPermissionStatus('not-supported');
        setErrorMessage('This browser does not support desktop notifications');
        return false;
      }

      let permission = Notification.permission;
      
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
      }
      
      setPermissionStatus(permission);
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      setErrorMessage(`Permission error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFirebaseConfig(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    initializeFirebase();
  };

  const handleClearNotifications = () => {
    setNotifications([]);
  };

  const handleTestLocalNotification = () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      alert('Notifications not allowed');
      return;
    }

    new Notification('Test Local Notification', {
      body: 'This is a local notification (not from FCM)',
      icon: '/notification-icon.png'
    });

    setNotifications(prev => [...prev, {
      id: Date.now(),
      title: 'Test Local Notification',
      body: 'This is a local notification (not from FCM)',
      data: { local: true },
      timestamp: new Date().toLocaleTimeString()
    }]);
  };

  // Manual permission request
  const handleRequestPermission = async () => {
    await requestNotificationPermission();
  };

  // Copy FCM token to clipboard
  const copyTokenToClipboard = () => {
    if (fcmToken) {
      navigator.clipboard.writeText(fcmToken)
        .then(() => alert('FCM token copied to clipboard!'))
        .catch(err => console.error('Could not copy token:', err));
    }
  };

  // Subscribe to FCM topic using Firebase SDK (client-side)
  const subscribeToTopic = async (topic: string) => {
    try {
      if (!fcmToken) {
        alert('No FCM token available. Please initialize Firebase first.');
        return;
      }

      // Option 1: Use FCM REST API (may be blocked by CORS)
      // This is what you'd typically do from your backend
      const response = await fetch(
        `https://iid.googleapis.com/iid/v1/${fcmToken}/rel/topics/${topic}`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'key=YOUR_SERVER_KEY', // Replace with your actual server key
            'Content-Type': 'application/json',
          },
        }
      ).catch(() => {
        console.log('CORS blocked (expected). Token copied for backend use.');
        // Copy token to clipboard for backend testing
        navigator.clipboard.writeText(fcmToken);
        throw new Error('CORS_BLOCKED');
      });

      if (response.ok) {
        alert(`Successfully subscribed to topic: ${topic}`);
      } else {
        const error = await response.text();
        alert(`Failed to subscribe to topic: ${error}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage === 'CORS_BLOCKED') {
        alert(`CORS blocked the request (expected). 
        
Your FCM token has been copied to clipboard. 
        
To subscribe to "${topic}" topic, use this token with your backend API or test with a tool like Postman:

POST https://iid.googleapis.com/iid/v1/{token}/rel/topics/${topic}
Headers: 
- Authorization: key=YOUR_SERVER_KEY
- Content-Type: application/json`);
      } else {
        console.error('Error subscribing to topic:', err);
        alert(`Error subscribing to topic: ${err}`);
      }
    }
  };

  return (
    <div className="fcm-page">
      <header className="fcm-header">
        <h1>FCM Notification Tester</h1>
        <div className="status-indicator">
          <span className={`status-dot ${isInitialized ? 'connected' : 'disconnected'}`}></span>
          <span>{isInitialized ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <div className="fcm-content">
        {!isInitialized ? (
          <div className="config-section">
            <h2>Firebase Configuration</h2>
            <form onSubmit={handleConfigSubmit}>
              <div className="form-group">
                <label htmlFor="apiKey">API Key</label>
                <input
                  type="text"
                  id="apiKey"
                  name="apiKey"
                  value={firebaseConfig.apiKey}
                  onChange={handleConfigChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="authDomain">Auth Domain</label>
                <input
                  type="text"
                  id="authDomain"
                  name="authDomain"
                  value={firebaseConfig.authDomain}
                  onChange={handleConfigChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="projectId">Project ID</label>
                <input
                  type="text"
                  id="projectId"
                  name="projectId"
                  value={firebaseConfig.projectId}
                  onChange={handleConfigChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="messagingSenderId">Messaging Sender ID</label>
                <input
                  type="text"
                  id="messagingSenderId"
                  name="messagingSenderId"
                  value={firebaseConfig.messagingSenderId}
                  onChange={handleConfigChange}
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="appId">App ID</label>
                <input
                  type="text"
                  id="appId"
                  name="appId"
                  value={firebaseConfig.appId}
                  onChange={handleConfigChange}
                  required
                />
              </div>
              
              <button type="submit" className="primary-button">Initialize Firebase</button>
              {permissionStatus === 'denied' && (
                <div className="permission-help">
                  <p>⚠️ Notifications are blocked. To enable:</p>
                  <ol>
                    <li>Click the lock/info icon in your browser's address bar</li>
                    <li>Set "Notifications" to "Allow"</li>
                    <li>Refresh the page</li>
                  </ol>
                  <button 
                    type="button" 
                    onClick={handleRequestPermission}
                    className="secondary-button"
                  >
                    Try Request Permission Again
                  </button>
                </div>
              )}
            </form>
          </div>
        ) : (
          <>
            <div className="token-section">
              <h2>FCM Token</h2>
              <div className="token-display">
                <textarea readOnly value={fcmToken || 'No token generated'} />
                <button onClick={copyTokenToClipboard} className="copy-button">
                  Copy to Clipboard
                </button>
                <button 
                  onClick={() => subscribeToTopic('alarm')}
                  className="secondary-button"
                  disabled={!fcmToken}
                >
                  Subscribe to "alarm" Topic
                </button>
              </div>
              <p className="help-text">
                Use this token to target this device when sending notifications
              </p>
            </div>
            
            <div className="controls-section">
              <h2>Testing Controls</h2>
              <div className="button-group">
                <button 
                  onClick={handleTestLocalNotification}
                  className="primary-button"
                  disabled={permissionStatus !== 'granted'}
                >
                  Test Local Notification
                </button>
                <button 
                  onClick={handleClearNotifications}
                  className="secondary-button"
                >
                  Clear Notifications
                </button>
              </div>
              <div className="permission-status">
                <span>Notification Permission: </span>
                <strong className={`status-${permissionStatus}`}>{permissionStatus}</strong>
              </div>
            </div>
          </>
        )}

        {errorMessage && (
          <div className="error-message">
            <p>Error: {errorMessage}</p>
          </div>
        )}

        <div className="notifications-section">
          <h2>Received Notifications ({notifications.length})</h2>
          {notifications.length === 0 ? (
            <div className="empty-state">No notifications received yet</div>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => (
                <div key={notification.id} className="notification-item">
                  <div className="notification-header">
                    <h3>{notification.title}</h3>
                    <span className="timestamp">{notification.timestamp}</span>
                  </div>
                  <p className="notification-body">{notification.body}</p>
                  {Object.keys(notification.data).length > 0 && (
                    <div className="notification-data">
                      <strong>Data:</strong>
                      <pre>{JSON.stringify(notification.data, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FCMNotificationPage;
