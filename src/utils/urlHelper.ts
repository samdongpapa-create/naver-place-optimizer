/**
 * 네이버 플레이스 URL을 모바일 버전으로 변환
 */
export function convertToMobileUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // 이미 모바일 URL인 경우
    if (urlObj.hostname === 'm.place.naver.com') {
      return url;
    }
    
    // 데스크톱 URL인 경우 (place.naver.com)
    if (urlObj.hostname === 'place.naver.com') {
      // /restaurant/1234567 형식에서 ID 추출
      const pathMatch = urlObj.pathname.match(/\/[^/]+\/(\d+)/);
      if (pathMatch && pathMatch[1]) {
        return `https://m.place.naver.com/restaurant/${pathMatch[1]}`;
      }
    }
    
    // map.naver.com URL인 경우
    if (urlObj.hostname === 'map.naver.com' || urlObj.hostname === 'naver.me') {
      // 쿼리 파라미터에서 place ID 추출 시도
      const placeIdMatch = url.match(/place[/=](\d+)/);
      if (placeIdMatch && placeIdMatch[1]) {
        return `https://m.place.naver.com/place/${placeIdMatch[1]}`;
      }
    }
    
    return url;
  } catch (error) {
    return url;
  }
}

/**
 * 네이버 플레이스 URL 검증
 */
export function isValidPlaceUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    
    // 허용되는 호스트
    const validHosts = [
      'm.place.naver.com',
      'place.naver.com',
      'map.naver.com',
      'naver.me'
    ];
    
    if (!validHosts.includes(urlObj.hostname)) {
      return false;
    }
    
    // place ID가 포함되어 있는지 확인
    return /\d{5,}/.test(url);
  } catch (error) {
    return false;
  }
}

/**
 * URL에서 Place ID 추출
 */
export function extractPlaceId(url: string): string | null {
  const match = url.match(/place[/=](\d+)/);
  return match ? match[1] : null;
}
