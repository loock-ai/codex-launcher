import {createRoot} from 'react-dom/client';
import {LauncherPanel,type LauncherApi} from './Panel';
import './styles.css';
import {isTauri} from '@tauri-apps/api/core';
import {createTauriApi,reportTauriError} from './tauri-api';
if(isTauri()){window.addEventListener('error',event=>reportTauriError(event.error??event.message));window.addEventListener('unhandledrejection',event=>reportTauriError(event.reason));}
declare global {interface Window {launcher:LauncherApi}}
createRoot(document.getElementById('root')!).render(<LauncherPanel api={isTauri()?createTauriApi():window.launcher}/>);
