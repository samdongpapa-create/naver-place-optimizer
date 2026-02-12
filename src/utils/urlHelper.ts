/**
 * 네이버 플레이스 URL을 "map.naver.com 엔트리(entry) URL"로 변환
 * (iframe#entryIframe + 내부 API 수집이 가장 안정적으로 동작)
 */
export function convertToMobileUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // 이미 map 엔트리면 그대로
    if (urlObj.hostname === 'map.naver.com' && url.includes('/entry/place/')) {
      return url;
    }

    let placeId: string | null = null;

    // 1) map.naver.com/p/entry/place/1234567
    const entryMatch = url.match(/\/entry\/place\/(\d+)/);
    if (entryMatch?.[1]) placeId = entryMatch[1];

    // 2) place.naver.com/업종/1234567
    if (!placeId) {
      const placeMatch = url.match(/place\.naver\.com\/[^/]+\/(\d+)/);
      if (placeMatch?.[1]) placeId = placeMatch[1];
    }

    // 3) m.place.naver.com/업종/1234567 or m.place.naver.com/place/1234567
    if (!placeId) {
      const mPlaceMatch = url.match(/m\.place\.naver\.com\/(?:place|[^/]+)\/(\d+)/);
      if (mPlaceMatch?.[1]) placeId = mPlaceMatch[1];
    }

    // 4) map.naver.com?place=1234567
    if (!placeId) {
      const paramMatch = url.match(/[?&]place=(\d+)/);
      if (paramMatch?.[1]) placeId = paramMatch[1];
    }

    // 5) fallback: 7자리 이상 숫자
    if (!placeId) {
      const numberMatch = url.match(/(\d{7,})/);
      if (numberMatch?.[1]) placeId = numberMatch[1];
    }

    if (placeId) {
      return `https://map.naver.com/p/entry/place/${placeId}`;
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * 네이버 플레이스 URL 검증
 */
export function isValidPlaceUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    const validHosts = [
      'm.place.naver.com',
      'place.naver.com',
      'map.naver.com',
      'naver.me'
    ];

    if (!validHosts.includes(urlObj.hostname)) return false;

    return /\d{7,}/.test(url);
  } catch {
    return false;
  }
}

/**
 * URL에서 Place ID 추출
 */
export function extractPlaceId(url: string): string | null {
  const patterns = [
    /\/entry\/place\/(\d+)/,
    /place\.naver\.com\/[^/]+\/(\d+)/,
    /m\.place\.naver\.com\/(?:place|[^/]+)\/(\d+)/,
    /[?&]place=(\d+)/,
    /(\d{7,})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
