'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zhiyuDesktop', {
  platform: process.platform,
  nativeMaterial: process.argv.includes('--zhiyu-native-material'),
  taskCalendarWindowControl: 'reveal-v1',
  revealTaskCalendarWindow: expectedURL => ipcRenderer.invoke('zhiyu:task-calendar-reveal', expectedURL),
  requestMicrophoneAccess: () => ipcRenderer.invoke('zhiyu:microphone-request'),
  openMicrophoneSettings: () => ipcRenderer.invoke('zhiyu:microphone-settings'),
  requestCameraAccess: () => ipcRenderer.invoke('zhiyu:camera-request'),
  openCameraSettings: () => ipcRenderer.invoke('zhiyu:camera-settings'),
  openImageViewer: payload => ipcRenderer.invoke('zhiyu:image-open', payload),
  updateImageViewer: payload => ipcRenderer.invoke('zhiyu:image-update', payload),
  getImageViewer: () => ipcRenderer.invoke('zhiyu:image-get'),
  fitImageViewer: payload => ipcRenderer.invoke('zhiyu:image-fit', payload),
  selectViewerImage: index => ipcRenderer.invoke('zhiyu:image-select', index),
  setImageHistory: visible => ipcRenderer.invoke('zhiyu:image-history', visible),
  toggleImagePin: () => ipcRenderer.invoke('zhiyu:image-pin'),
  imageWindowControl: action => ipcRenderer.invoke('zhiyu:image-control', action),
  copyViewerImage: bytes => ipcRenderer.invoke('zhiyu:image-copy', bytes),
  saveViewerImage: id => ipcRenderer.invoke('zhiyu:image-save', id),
  onImageViewerState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('zhiyu:image-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:image-state', handler);
  },
  openCharacterWindow: (personId) => ipcRenderer.invoke('zhiyu:character-open', personId),
  closeCharacterWindow: () => ipcRenderer.invoke('zhiyu:character-close'),
  setCharacterChromeHeight: (height) => ipcRenderer.invoke('zhiyu:character-chrome-height', height),
  getCharacterFullScreen: () => ipcRenderer.invoke('zhiyu:character-fullscreen-get'),
  setCharacterFullScreen: (fullscreen) => ipcRenderer.invoke('zhiyu:character-fullscreen-set', fullscreen),
  onCharacterFullScreenChange: (listener) => {
    const handler = (_event, fullscreen) => listener(fullscreen);
    ipcRenderer.on('zhiyu:character-fullscreen-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:character-fullscreen-state', handler);
  },
  onCharacterWindowState: (listener) => {
    const handler = (_event, personId) => listener(personId);
    ipcRenderer.on('zhiyu:character-window-state', handler);
    return () => ipcRenderer.removeListener('zhiyu:character-window-state', handler);
  },
});
