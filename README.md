# SFU Web Client (React + TypeScript + Vite)

This project is a modern web client for real-time video conferencing and chat, built with React, TypeScript, and Vite. It connects to a mediasoup-based SFU backend and a chat backend via WebSocket.

## Features

- **Video Conference**: Join or create video meetings, invite users, select video quality and codec, and view real-time connection stats.
- **Chat**: Join chat rooms linked to meetings, send and receive messages, and see online users.
- **Connection Configuration**: Easily configure WebSocket server address and user ID via a modal dialog.
- **Debugging Tools**: View advanced WebRTC and connection statistics, including ICE/TURN info and media resolutions.
- **Responsive UI**: Google Meet-inspired layout with participant strip, main video, and control bar.

## Getting Started

### Prerequisites

- Node.js (v16+ recommended)
- A running backend with mediasoup SFU and chat namespaces (see backend documentation)

### Installation

```bash
npm install
```

### Running the App

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

### Video Conference

1. Go to the **Video Conference** page (`/video` or `/`).
2. Configure your WebSocket server and user ID if prompted.
3. Enter a meeting code and click **Join Meeting**.
4. Allow camera/microphone access when prompted.
5. Use the control bar to mute/unmute, toggle video, invite users, or disconnect.
6. Change video quality and codec in the settings panel after joining.
7. View connection stats and debug info using the provided overlays.

### Chat

1. Go to the **Chat** page (`/chat`).
2. Configure your WebSocket server and user ID if prompted.
3. Select a chat meeting from the sidebar to join its chat room.
4. Send and receive messages in real time.

### Configuration

- Click the **Settings** button (gear icon) on any page to change the WebSocket server or user ID.
- The app stores your configuration in local storage for convenience.

## Project Structure

- `src/pages/`: Main pages (`WebRTCPage.tsx`, `ChatPage.tsx`)
- `src/components/Meeting/`: UI components for meetings and modals
- `src/hooks/`: Custom React hooks for socket, WebRTC, and media management
- `src/App.tsx`: Main app and routing
- `src/index.css`, `src/pages/*.css`: Styling

## Development

- Hot Module Replacement (HMR) is enabled via Vite.
- Edit any source file and the app will reload automatically.
- Use the debug overlays for troubleshooting WebRTC and connection issues.

## Notes

- This client expects a compatible backend with `/mediasoup` and `/chat` namespaces.
- TURN/STUN server configuration is handled by the backend and reported in the connection stats.
- For best results, use a modern browser (Chrome, Firefox, Edge).

---

Built with [Vite](https://vitejs.dev/), [React](https://react.dev/), and [mediasoup-client](https://mediasoup.org/).
