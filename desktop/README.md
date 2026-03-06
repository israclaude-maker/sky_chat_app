# SkyChat Desktop Application

Desktop wrapper for SkyChat using Electron.

## Prerequisites

1. **Node.js**: Download and install from https://nodejs.org/ (LTS version recommended)
2. **Django Server**: Make sure your Django chat server is running on `http://127.0.0.1:8000`

## Installation

```bash
# Navigate to desktop folder
cd desktop

# Install dependencies
npm install
```

## Running the Desktop App

### Step 1: Start Django Server (in a separate terminal)
```bash
cd d:\Desktop\chat_app
.\venv\Scripts\activate
daphne -b 127.0.0.1 -p 8000 chat_app.asgi:application
```

### Step 2: Run Desktop App
```bash
cd desktop
npm start
```

## Building Executable

To create a standalone .exe file:

```bash
# Build for Windows
npm run build:win
```

The executable will be created in `desktop/dist/` folder.

## Features

- **System Tray**: App minimizes to system tray when closed
- **Single Instance**: Only one instance of the app can run at a time
- **Desktop Notifications**: Receives notifications from the web app
- **Native Window**: Full desktop experience

## Adding Custom Icon

Replace `icon.png` (256x256 recommended) in the desktop folder.
For Windows build, also add `icon.ico` file.

## Configuration

To change the server URL, edit `main.js`:
```javascript
const SERVER_URL = 'http://127.0.0.1:8000';
```

## Troubleshooting

1. **"Cannot connect to server"**: Make sure Django server is running
2. **White screen**: Check if port 8000 is correct
3. **Build fails**: Make sure you have proper build tools installed:
   ```bash
   npm install --global windows-build-tools
   ```
