# FCM Notification Testing Guide

This application allows you to test Firebase Cloud Messaging (FCM) notifications. Here's how to set it up and use it effectively.

## Running in Development

### Option 1: HTTP Mode (Easiest, foreground-only)

For the simplest setup, run the app in regular HTTP mode:

```bash
npm run dev
```

This will:
- Generate FCM tokens
- Allow sending/receiving messages when the tab is open
- **NOT support background notifications**

### Option 2: HTTPS Mode (Full functionality)

For complete functionality including background notifications:

```bash
# Using the included certificates
npm run dev -- --https --cert ./certs/server.cert --key ./certs/server.key
```

When Chrome shows a certificate warning, type `thisisunsafe` anywhere on the page to bypass it.

## Using the FCM Tester

1. **Initialize Firebase**:
   - Fill in the Firebase configuration (pre-filled by default)
   - Click "Initialize Firebase"
   - Grant notification permissions when prompted

2. **Get Your FCM Token**:
   - After initialization, your FCM token will be displayed
   - Use "Copy to Clipboard" button to copy it

3. **Subscribe to Topics**:
   - Click "Subscribe to 'alarm' Topic"
   - This will attempt to subscribe via REST API (likely blocked by CORS)
   - The token will be copied to clipboard for use with backend or Postman

4. **Testing Notifications**:
   - Use "Test Local Notification" for browser notifications
   - For FCM notifications, send a message to your token via:
     - Firebase Console
     - Your backend API
     - Postman/curl (see below)

## Sending Test Notifications

### Via Postman/curl:

```bash
curl -X POST https://fcm.googleapis.com/fcm/send \
  -H "Authorization: key=YOUR_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "YOUR_FCM_TOKEN",
    "notification": {
      "title": "Test Notification",
      "body": "This is a test notification"
    },
    "data": {
      "type": "test",
      "id": "123"
    }
  }'
```

### To a Topic:

```bash
curl -X POST https://fcm.googleapis.com/fcm/send \
  -H "Authorization: key=YOUR_SERVER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "/topics/alarm",
    "notification": {
      "title": "Alarm Notification",
      "body": "This is an alarm notification"
    }
  }'
```

## Troubleshooting

### Notification Permissions
If notifications are blocked:
1. Click the lock/info icon in the browser address bar
2. Set "Notifications" to "Allow"
3. Refresh the page

### SSL Certificate Issues
If you get SSL certificate errors:
1. Try running in HTTP mode instead (see Option 1)
2. Generate new certificates with mkcert (see SSL-README.md)
3. Use Chrome and type `thisisunsafe` on the page

### Service Worker Issues
If service worker registration fails:
1. The app will automatically switch to foreground-only mode
2. You'll still be able to get tokens and receive foreground notifications
3. To get background notifications working, use proper HTTPS with valid certificates
