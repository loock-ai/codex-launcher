type Environment = Pick<Navigator,'userAgent'|'platform'|'maxTouchPoints'>;
/** 设备类型由 UA 决定；窗口宽度只影响桌面两栏的尺寸。 */
export function isDesktopEnvironment({userAgent,platform,maxTouchPoints}:Environment):boolean {
 if(/Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|Tablet|Silk/i.test(userAgent))return false;
 if((platform==='MacIntel'||/Macintosh/i.test(userAgent))&&maxTouchPoints>1)return false;
 return /Windows|Macintosh|X11|Linux|CrOS/i.test(userAgent);
}
