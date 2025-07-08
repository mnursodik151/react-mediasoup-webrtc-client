# Running FCM with Local SSL

To get Firebase Cloud Messaging working properly in development, you need to serve your app with valid SSL certificates.

## Option 1: Use the existing certificates

This project already has certificates in the `certs` folder, which you can use with Vite's HTTPS option:

```bash
npm run dev -- --https --cert ./certs/server.cert --key ./certs/server.key
```

If Chrome shows a certificate warning, type "thisisunsafe" anywhere on the page to bypass it.

## Option 2: Generate new certificates

If the existing certificates don't work, you can generate new ones:

### For Windows:

```powershell
# Install mkcert
choco install mkcert

# Create a locally trusted CA
mkcert -install

# Generate certificates
mkcert -key-file ./certs/server.key -cert-file ./certs/server.cert localhost 127.0.0.1
```

### For Mac:

```bash
# Install mkcert
brew install mkcert
brew install nss  # if you use Firefox

# Create a locally trusted CA
mkcert -install

# Generate certificates
mkcert -key-file ./certs/server.key -cert-file ./certs/server.cert localhost 127.0.0.1
```

## Option 3: Use Foreground-only mode

If you can't use valid SSL certificates, the app has been modified to work in foreground-only mode on localhost. This means:

- You can still get an FCM token
- You can still send and receive messages when the tab is open
- Background notifications will NOT work
- This is sufficient for most testing purposes
