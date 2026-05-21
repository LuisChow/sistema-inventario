const { app, BrowserWindow } = require('electron');
const path = require('path');

// 1. Encendemos tu servidor (Base de datos y Frontend)
require('./server.js'); 

let mainWindow;

function createWindow() {
  // 2. Configuramos la ventana de tu programa
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    autoHideMenuBar: true, // Oculta el menú superior
    
    // === CONFIGURACIÓN DEL ICONO ===
    // Asegúrate de que el archivo InventarioChow.ico esté dentro de una carpeta llamada 'build'
    icon: path.join(__dirname, 'build', 'InventarioChow.ico'), 

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // Importante para que el frontend pueda hablar con el backend
    }
  });

  // 3. Cargamos la aplicación
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// 4. Cuando Electron esté listo, abrimos la ventana
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});