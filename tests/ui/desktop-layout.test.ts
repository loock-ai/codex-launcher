import {describe,it,expect} from 'vitest';
import {isDesktopEnvironment} from '../../src/ui/desktop-layout';
describe('桌面环境识别',()=>{
 it('按桌面UA判断而非窗口宽度',()=>{for(const userAgent of ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/155','Mozilla/5.0 (Windows NT 10.0; Win64; x64)','Mozilla/5.0 (X11; Linux x86_64)'])expect(isDesktopEnvironment({userAgent,platform:'',maxTouchPoints:0})).toBe(true);});
 it('手机和平板即使屏幕很宽仍使用抽屉',()=>{for(const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile','Mozilla/5.0 (Linux; Android 15; Pixel) Mobile','Mozilla/5.0 (Linux; Android 15; Tablet)','Mozilla/5.0 (iPad; CPU OS 18)'])expect(isDesktopEnvironment({userAgent,platform:'',maxTouchPoints:1})).toBe(false);});
 it('识别以桌面UA访问的iPad，但不误判Windows触屏电脑',()=>{expect(isDesktopEnvironment({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',platform:'MacIntel',maxTouchPoints:5})).toBe(false);expect(isDesktopEnvironment({userAgent:'Mozilla/5.0 (Windows NT 10.0)',platform:'Win32',maxTouchPoints:5})).toBe(true);});
});
