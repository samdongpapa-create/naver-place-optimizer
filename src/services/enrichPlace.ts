import { chromium, Browser, Page } from 'playwright';
import { CompetitorData, PlaceData } from '../types';
import { convertToMobileUrl, extractPlaceId } from '../utils/urlHelper';

export type Plan = 'free' | 'pro';

export interface ResolveResult {
  placeId: string;
  mobileUrl: string;
  originalUrl: string;
}

export interface CrawlDebug {
  resolved: ResolveResult;
  staticHits: Record<string, number>;
  dynamicHits: Record<string, number>;
  notes: string[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 균형 괄호로 JSON 덩어리 추출 */
function extractBalancedJson(text: string, startIndex: number): string | null {
  const startChar = text[startIndex];
  if (startChar !== '{' && startChar !== '[') return null;

  const stack: string[] = [startChar];
  let inStr = false;
  let esc = false;

  for (let i = startIndex + 1; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }

    if (c === '"') {
      inStr = true;
      continue;
    }

    if (c === '{' || c === '[') stack.push(c);
    if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) return text.slice(startIndex, i + 1);
    }
  }

  return null;
}

function extractScriptTextById(html: string, id: string): string {
  const re = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const m = html.match(re);
  return (m?.[1] || '').trim();
}

function extractJsonAfterMarker(html: string, marker: string): any | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const brace = html.indexOf('{', idx);
  const bracket = html.indexOf('[', idx);
  const start =
    brace >= 0 && bracket >= 0 ? Math.min(brace, bracket) : brace >= 0 ? brace : bracket >= 0 ? bracket : -1;
  if (start < 0) return null;
  const chunk = extractBalancedJson(html, start);
  if (!chunk) return null;
  return safeJsonParse(chunk);
}

function parseNumber(v: any): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/[^\d]/g, '');
  return cleaned ? Number(cleaned) : 0;
}

function scanJson(
  node: any,
  acc: {
    name: string;
    address: string;
    description: string;
    directions: string;
    keywords: string[];
    reviewCount: number;
    photoCount: number;
    hit: Record<string, number>;
  }
) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) scanJson(v, acc);
    return;
  }
  if (typeof node !== 'object') return;

  const obj: any = node;

  // name
  if (!acc.name) {
    const candidates = [obj.placeName, obj.bizName, obj.name];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0 && !c.includes('네이버')) {
        acc.name = c.trim();
        acc.hit.name++;
        break;
      }
    }
  }

  // address
  if (!acc.address) {
    const candidates = [obj.roadAddress, obj.jibunAddress, obj.address, obj.fullAddress];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length >= 5) {
        acc.address = c.trim();
        acc.hit.address++;
        break;
      }
    }
  }

  // description
  if (!acc.description) {
    const candidates = [obj.introduction, obj.description, obj.summary, obj.businessDescription, obj.intro];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length >= 15 && !c.includes('네이버페이')) {
        acc.description = c.trim();
        acc.hit.description++;
        break;
      }
    }
  }

  // directions
  if (!acc.directions) {
    const candidates = [obj.directions, obj.way, obj.wayDescription, obj.directionDescription];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length >= 15) {
        acc.directions = c.trim();
        acc.hit.directions++;
        break;
      }
    }
  }

  // keywordList
  if (Array.isArray(obj.keywordList) && acc.keywords.length === 0) {
    const list: string[] = obj.keywordList
      .map((k: any) => String(k?.text ?? k?.name ?? '').trim())
      .filter((x: string) => x.length > 0);
    if (list.length) {
      acc.keywords = Array.from(new Set(list)).slice(0, 5);
      acc.hit.keywords++;
    }
  }

  // review/photo counts
  const reviewCandidates = [
    obj.reviewCount,
    obj.totalReviewCount,
    obj.visitorReviewCount,
    obj.blogReviewCount,
    obj.reviewsCount,
    obj.totalReviewsCount
  ];
  for (const c of reviewCandidates) {
    const n = parseNumber(c);
    if (n > acc.reviewCount) {
      acc.reviewCount = n;
      acc.hit.reviewCount++;
    }
  }

  const photoCandidates = [obj.photoCount, obj.totalPhotoCount, obj.photosCount, obj.imageCount, obj.totalImageCount];
  for (const c of photoCandidates) {
    const n = parseNumber(c);
    if (n > acc.photoCount) {
      acc.photoCount = n;
      acc.hit.photoCount++;
    }
  }

  for (const k of Object.keys(obj)) {
    scanJson(obj[k], acc);
  }
}

export function resolvePlace(inputUrl: string): ResolveResult {
  const placeId = extractPlaceId(inputUrl);
  if (!placeId) throw new Error('placeId를 URL에서 찾을 수 없습니다. URL을 확인해주세요.');
  const mobileUrl = convertToMobileUrl(inputUrl);
  return { placeId, mobileUrl, originalUrl: inputUrl };
}

export async function fetchPlaceHtml(mobileUrl: string): Promise<string> {
  const res = await fetch(mobileUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`HTML fetch 실패: ${res.status}`);
  return await res.text();
}

export function parsePlaceFromHtml(html: string): { place: Partial<PlaceData>; hit: Record<string, number>; notes: string[] } {
  const acc = {
    name: '',
    address: '',
    description: '',
    directions: '',
    keywords: [] as string[],
    reviewCount: 0,
    photoCount: 0,
    hit: {
      name: 0,
      address: 0,
      description: 0,
      directions: 0,
      keywords: 0,
      reviewCount: 0,
      photoCount: 0
    },
    notes: [] as string[]
  };

  // 1) __NEXT_DATA__
  const nextText = extractScriptTextById(html, '__NEXT_DATA__');
  if (nextText) {
    const json = safeJsonParse(nextText);
    if (json) scanJson(json, acc);
    else acc.notes.push('__NEXT_DATA__ JSON 파싱 실패');
  } else {
    acc.notes.push('__NEXT_DATA__ 없음');
  }

  // 2) __APOLLO_STATE__
  if (acc.keywords.length === 0 || !acc.address || !acc.description || acc.photoCount === 0) {
    const apollo = extractJsonAfterMarker(html, '__APOLLO_STATE__');
    if (apollo) scanJson(apollo, acc);
    else acc.notes.push('__APOLLO_STATE__ 없음/파싱 실패');
  }

  // 3) regex fallback
  if (!acc.address) {
    const m = html.match(/"roadAddress"\s*:\s*"([^"]+)"/) || html.match(/"jibunAddress"\s*:\s*"([^"]+)"/);
    if (m?.[1]) {
      acc.address = m[1].trim();
      acc.hit.address++;
    }
  }
  if (!acc.description) {
    const m =
      html.match(/"introduction"\s*:\s*"([^"]+)"/) ||
      html.match(/"description"\s*:\s*"([^"]+)"/) ||
      html.match(/"summary"\s*:\s*"([^"]+)"/);
    if (m?.[1]) {
      const s = m[1].trim();
      if (!s.includes('네이버페이')) {
        acc.description = s;
        acc.hit.description++;
      }
    }
  }
  if (!acc.directions) {
    const m =
      html.match(/"directions"\s*:\s*"([^"]+)"/) ||
      html.match(/"wayDescription"\s*:\s*"([^"]+)"/) ||
      html.match(/"way"\s*:\s*"([^"]+)"/);
    if (m?.[1]) {
      acc.directions = m[1].trim();
      acc.hit.directions++;
    }
  }
  if (acc.keywords.length === 0) {
    const km = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
    if (km?.[1]) {
      const items = km[1].match(/"text"\s*:\s*"([^"]+)"/g) || [];
      const list = items
        .map((x) => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
        .map((x) => x.trim())
        .filter(Boolean);
      if (list.length) {
        acc.keywords = Array.from(new Set(list)).slice(0, 5);
        acc.hit.keywords++;
      }
    }
  }

  const place: Partial<PlaceData> = {
    name: acc.name,
    address: acc.address,
    description: acc.description,
    directions: acc.directions,
    keywords: acc.keywords,
    reviewCount: acc.reviewCount,
    photoCount: acc.photoCount
  };

  return { place, hit: acc.hit, notes: acc.notes };
}

function mergePlace(base: Partial<PlaceData>, dynamic: Partial<PlaceData>): PlaceData {
  const name = (dynamic.name || base.name || '').trim();
  const address = (dynamic.address || base.address || '').trim();
  const description =
    (dynamic.description && dynamic.description.length >= (base.description?.length || 0)
      ? dynamic.description
      : base.description) || '';
  const directions =
    (dynamic.directions && dynamic.directions.length >= (base.directions?.length || 0) ? dynamic.directions : base.directions) ||
    '';
  const keywords = (dynamic.keywords && dynamic.keywords.length ? dynamic.keywords : base.keywords) || [];
  const reviewCount = Math.max(dynamic.reviewCount || 0, base.reviewCount || 0);
  const photoCount = Math.max(dynamic.photoCount || 0, base.photoCount || 0);

  return {
    name,
    address,
    reviewCount,
    photoCount,
    description: stripHtml(description),
    directions: stripHtml(directions),
    keywords
  };
}

export class NaverPlaceCrawler {
  private browser: Browser | null = null;

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async newMobilePage(): Promise<Page> {
    if (!this.browser) await this.initialize();
    const browser = this.browser;
    if (!browser) throw new Error('브라우저 초기화 실패');

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
      locale: 'ko-KR'
    });

    const page = await context.newPage();

    // 속도 최적화: 이미지/폰트/미디어 차단
    await page.route('**/*', async (route: any) => {
      const r = route.request();
      const type = r.resourceType();
      if (type === 'image' || type === 'media' || type === 'font') return route.abort();
      return route.continue();
    });

    return page;
  }

  private async clickIfExists(page: Page, selectors: string[]): Promise<boolean> {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await el.click({ timeout: 1500 }).catch(() => {});
        await sleep(600);
        return true;
      }
    }
    return false;
  }

  private async clickMoreButtons(page: Page, maxClicks: number = 6) {
    for (let i = 0; i < maxClicks; i++) {
      const btn =
        (await page.$('button:has-text("더보기")').catch(() => null)) || (await page.$('a:has-text("더보기")').catch(() => null));
      if (!btn) break;
      await btn.click().catch(() => {});
      await sleep(500);
    }
  }

  /**
   * 동적 보강: 소개/오시는길/대표키워드/사진수 보강
   */
  private async enrichDynamic(
    mobileUrl: string
  ): Promise<{ place: Partial<PlaceData>; hit: Record<string, number> }> {
    const page = await this.newMobilePage();
    const hit = { description: 0, directions: 0, keywords: 0, photoCount: 0, address: 0, name: 0, reviewCount: 0 };

    try {
      await page.goto(mobileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1200);

      // 스크롤 몇 번
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 900).catch(() => {});
        await sleep(500);
      }

      // 정보 탭 클릭
      await this.clickIfExists(page, ['a:has-text("정보")', 'button:has-text("정보")', 'a:has-text("홈")']);

      // 더보기 연타
      await this.clickMoreButtons(page, 8);

      // 이름
      const name =
        (await page.textContent('h1').catch(() => ''))?.trim() ||
        (await page.textContent('.Fc1rA').catch(() => ''))?.trim() ||
        '';
      if (name) hit.name++;

      // 주소(보이는 텍스트로 한번)
      let address = ((await page.textContent('.LDgIH').catch(() => '')) || '').trim();
      if (address) hit.address++;

      // 소개/상세설명(긴 텍스트 블럭)
      const descCandidates =
        ((await page
          .$$eval('div, p, span', (els: any[]) => {
            const out: string[] = [];
            for (const el of els as any[]) {
              const t = (el?.textContent || '').trim();
              if (t.length >= 40) out.push(t);
            }
            return out.slice(0, 200);
          })
          .catch(() => [])) as string[]) || [];
      const description = descCandidates.sort((a: string, b: string) => b.length - a.length)[0] || '';
      if (description) hit.description++;

      // 오시는길 탭 클릭 후 텍스트 수집
      await this.clickIfExists(page, ['a:has-text("오시는길")', 'button:has-text("오시는길")', 'a:has-text("길찾기")']);
      await this.clickMoreButtons(page, 4);

      const dirCandidates =
        ((await page
          .$$eval('div, p, span', (els: any[]) => {
            const out: string[] = [];
            for (const el of els as any[]) {
              const t = (el?.textContent || '').trim();
              if (
                t.length >= 20 &&
                (t.includes('주차') || t.includes('출구') || t.includes('도보') || t.includes('버스') || t.includes('지하철'))
              ) {
                out.push(t);
              }
            }
            return out.slice(0, 200);
          })
          .catch(() => [])) as string[]) || [];
      const directions = dirCandidates.sort((a: string, b: string) => b.length - a.length)[0] || '';
      if (directions) hit.directions++;

      // 대표키워드: HTML에 keywordList가 있으면 regex 파싱
      const html = await page.content();
      let keywords: string[] = [];
      const km = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
      if (km?.[1]) {
        const items = km[1].match(/"text"\s*:\s*"([^"]+)"/g) || [];
        const list = items
          .map((x) => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
          .map((x) => x.trim())
          .filter(Boolean);
        keywords = Array.from(new Set(list)).slice(0, 5);
      }
      if (keywords.length) hit.keywords++;

      // 리뷰/사진: HTML에서 숫자 파싱
      let reviewCount = 0;
      let photoCount = 0;
      const rm = html.match(/"reviewCount"\s*:\s*(\d+)/) || html.match(/방문자리뷰\s*([0-9,]+)/);
      if (rm?.[1]) reviewCount = parseNumber(rm[1]);
      const pm = html.match(/"photoCount"\s*:\s*(\d+)/) || html.match(/사진\s*([0-9,]+)/);
      if (pm?.[1]) photoCount = parseNumber(pm[1]);
      if (reviewCount) hit.reviewCount++;
      if (photoCount) hit.photoCount++;

      await page.context().close();

      return {
        place: {
          name,
          address,
          description,
          directions,
          keywords,
          reviewCount,
          photoCount
        },
        hit
      };
    } catch {
      await page.context().close().catch(() => {});
      return { place: {}, hit };
    }
  }

  async enrichPlace(inputUrlOrMobileUrl: string): Promise<{ place: PlaceData; debug: CrawlDebug }> {
    const resolved = resolvePlace(inputUrlOrMobileUrl);
    const debug: CrawlDebug = {
      resolved,
      staticHits: { name: 0, address: 0, description: 0, directions: 0, keywords: 0, reviewCount: 0, photoCount: 0 },
      dynamicHits: { name: 0, address: 0, description: 0, directions: 0, keywords: 0, reviewCount: 0, photoCount: 0 },
      notes: []
    };

    // 1) static
    const html = await fetchPlaceHtml(resolved.mobileUrl);
    const parsed = parsePlaceFromHtml(html);
    debug.staticHits = parsed.hit;
    debug.notes.push(...parsed.notes);

    // 2) dynamic 보강
    const dyn = await this.enrichDynamic(resolved.mobileUrl);
    debug.dynamicHits = dyn.hit;

    // merge
    const place = mergePlace(parsed.place, dyn.place);
    return { place, debug };
  }

  /**
   * 경쟁사: 검색 페이지에서 place 링크만 뽑아 competitor 키워드/리뷰를 빠르게 추출
   * (MVP: 안정성 우선, 실패 시 빈 배열)
   */
  async searchCompetitors(searchQuery: string, limit: number = 5): Promise<CompetitorData[]> {
    const page = await this.newMobilePage();
    try {
      const url = `https://m.place.naver.com/search?query=${encodeURIComponent(searchQuery)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(1500);

      const links =
        ((await page
          .$$eval('a[href*="/place/"]', (as: any[]) => {
            const out: string[] = [];
            for (const a of as as any[]) {
              const href = a.getAttribute('href') || '';
              if (!href) continue;
              if (!href.includes('/place/')) continue;
              out.push(href.startsWith('http') ? href : `https://m.place.naver.com${href}`);
            }
            return Array.from(new Set(out)).slice(0, 30);
          })
          .catch(() => [])) as string[]) || [];

      const picked = links.slice(0, limit);
      await page.context().close();

      const out: CompetitorData[] = [];
      for (const l of picked) {
        try {
          const html = await fetchPlaceHtml(l);
          const parsed = parsePlaceFromHtml(html).place;
          out.push({
            name: parsed.name || '',
            address: parsed.address || '',
            keywords: parsed.keywords || [],
            reviewCount: parsed.reviewCount || 0,
            photoCount: parsed.photoCount || 0
          });
        } catch {
          // skip
        }
      }
      return out;
    } catch {
      await page.context().close().catch(() => {});
      return [];
    }
  }
}
