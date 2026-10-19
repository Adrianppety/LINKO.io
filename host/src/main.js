const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const io = require('socket.io-client');
const robot = require('robotjs');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Signaling server URL (for development)
const SIGNALING_SERVER = 'http://localhost:3000';

// Create the browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Load the host UI
  mainWindow.loadURL(SIGNALING_SERVER);

  // Open DevTools for development
  mainWindow.webContents.openDevTools();

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when Electron is ready
app.on('ready', createWindow);

// Quit when all windows are closed (macOS exception)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handler for starting screen share
ipcMain.handle('start-screen-share', async (event, roomId, userId) => {
  return new Promise((resolve, reject) => {
    try {
      // Initialize socket connection
      const socket = io(SIGNALING_SERVER, {
        transports: ['websocket']
      });

      socket.on('connect', () => {
        console.log('Connected to signaling server');
        socket.emit('join-room', roomId, userId);
      });

      // We'll handle WebRTC in the renderer process via preload
      // For now, we just return the socket and let renderer handle it
      resolve({ socket });
    } catch (error) {
      reject(error);
    }
  });
});

// IPC handler for capturing screen
ipcMain.handle('capture-screen', async (event) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window']
    });

    // Return the first screen source (you can let user choose in UI)
    return sources[0].thumbnail.toDataURL();
  } catch (error) {
    throw error;
  }
});

// IPC handler for injecting input
ipcMain.on('inject-input', (event, inputData) => {
  try {
    switch (inputData.type) {
      case 'mouse-move':
        robot.moveMouse(inputData.x, inputData.y);
        break;
      case 'mouse-click':
        robot.mouseClick(inputData.button || 'left');
        break;
      case 'mouse-down':
        robot.mouseToggle('down', inputData.button || 'left');
        break;
      case 'mouse-up':
        robot.mouseToggle('up', inputData.button || 'left');
        break;
      case 'key-tap':
        robot.keyTap(inputData.key);
        break;
      case 'key-toggle':
        robot.keyToggle(inputData.key, inputData.state);
        break;
      default:
        console.warn('Unknown input type:', inputData.type);
    }
  } catch (error) {
    console.error('Error injecting input:', error);
    mainWindow.webContents.send('input-error', error.message);
  }
});

// IPC handler for stopping screen share
ipcMain.handle('stop-screen-share', async (event) => {
  // Cleanup would go here
  return true;
});