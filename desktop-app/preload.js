'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('supermanApi', {
    state: {
        load: () => ipcRenderer.invoke('state:load'),
        save: patch => ipcRenderer.invoke('state:save', patch),
    },
    workspace: {
        pick: () => ipcRenderer.invoke('workspace:pick'),
        configure: payload => ipcRenderer.invoke('workspace:configure', payload),
        detectRecent: () => ipcRenderer.invoke('workspace:detectRecent'),
    },
    messages: {
        send: payload => ipcRenderer.invoke('messages:send', payload),
        onCursorReply: handler => {
            const listener = (_e, data) => {
                try { handler(data); } catch { /* ignore */ }
            };
            ipcRenderer.on('cursor-reply', listener);
            return () => ipcRenderer.removeListener('cursor-reply', listener);
        },
    },
    clipboard: {
        copyPhrase: sessionId => ipcRenderer.invoke('clipboard:copyPhrase', sessionId),
    },
    shell: {
        openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
    },
});
