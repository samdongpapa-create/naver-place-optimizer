import { chromium, Browser, Frame } from 'playwright';
import { PlaceData } from '../types';

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

  private parseNumber(input: any): number {
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'string') return 0;
    const cleaned = input.replace(/[^\d]/g, '');
    return cleaned ? Number(cleaned) : 0;
  }

  /** 균형 괄호로 JSON 객체/배열을 잘라내기 */
  private extractBalancedJson(text: string, startIndex: number): string | null {
    const startChar = text[startIndex];
    if (startChar !== '{' && startChar !== '[') return null;

    const stack: string[] = [startChar];
    let i = startIndex + 1;
    let inStr = false;
    let esc = false;

    for (; i < text.length; i++) {
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
        if (c === '"') {
          inStr = false;
        }
        continue;
      }

      if (c === '"') {
        inStr = true;
        continue;
      }

      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        const last = stack.pop();
        if (!last) return null;
        if (stack.length === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }
    return null;
  }

  /** script tag에서 특정 id의 JSON 텍스트를 가져오기 */
  private extractScriptTextById(html: string, id: string): string {
    const re = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`, 'i');
    const m = html.match(re);
    return (m?.[1] || '').trim();
  }

  /** html 안에서 marker 뒤에 나오는 JSON 객체/배열을 균형괄호로 추출 */
  private extractJsonAfterMarker(html: string, marker: string): any | null {
    const idx = html.indexOf(marker);
    if (idx < 0) return null;

    const braceIdx = html.indexOf('{', idx);
    const bracketIdx = html.indexOf('[', idx);
    const startIndex =
      braceIdx >= 0 && bracketIdx >= 0 ? Math.min(braceIdx, bracketIdx)
      : braceIdx >= 0 ? braceIdx
      : bracketIdx >= 0 ? bracketIdx
      : -1;

    if (startIndex < 0) return null;

    const chunk = this.extractBalancedJson(html, startIndex);
    if (!chunk) return null;

    try {
      return JSON.parse(chunk);
    } catch {
      return null;
    }
  }

  /** JSON을 재귀로 훑어서 필요한 시그널을 모은다 */
  private scanJson(node: any, acc: {
    keywords: string[];
    reviewCount: number;
    photoCount: number;
    address: string;
    description: string;
    directions: string;
    hit: Record<string, number>;
  }) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const v of node) this.scanJson(v, acc);
      return;
    }

    if (typeof node === 'object') {
      // keywordList
      if (Array.isArray((node as any).keywordList)) {
        const list = (node as any).keywordList
          .map((k: any) => String(k?.text ?? k?.name ?? '').trim())
          .filter((x: string) => x.length > 0);
        if (list.length && acc.keywords.length === 0) {
          acc.keywords = Array.from(new Set(list)).slice(0, 5);
          acc.hit.keywordList++;
        }
      }

      // reviewCount 후보
      const reviewFields = [
        (node as any).reviewCount,
        (node as any).totalReviewCount,
        (node as any).visitorReviewCount,
        (node as any).blogReviewCount,
        (node as any).reviewsCount
      ];
      for (const v of reviewFields) {
        const n = this.parseNumber(v);
        if (n > acc.reviewCount) {
          acc.reviewCount = n;
          acc.hit.reviewCount++;
        }
      }

      // photoCount 후보
      const photoFields = [
        (node as any).photoCount,
        (node as any).totalPhotoCount,
        (node as any).photosCount,
        (node as any).imageCount
      ];
      for (const v of photoFields) {
        const n = this.parseNumber(v);
        if (n > acc.photoCount) {
          acc.photoCount = n;
          acc.hit.photoCount++;
        }
      }

      // address 후보
      if (!acc.address) {
        const addrFields = [
          (node as any).roadAddress,
          (node as any).jibunAddress,
          (node as any).address,
          (node as any).fullAddress
        ];
        for (const v of addrFields) {
          if (typeof v === 'string' && v.trim().length >= 5) {
            acc.address = v.trim();
            acc.hit.address++;
            break;
          }
        }
      }

      // description 후보
      if (!acc.description) {
        const descFields = [
          (node as any).introduction,
          (node as any).description,
          (node as any).summary,
          (node as any).businessDescription
        ];
        for (const v of descFields) {
          if (typeof v === 'string' && v.trim().length >= 15) {
            acc.description = v.trim();
            acc.hit.description++;
            break;
          }
        }
      }

      // directions 후보
      if (!acc.directions) {
        const dirFields = [
          (node as any).directions,
          (node as any).way,
          (node as any).wayDescription,
          (node as any).directionDescription
        ];
        for (const v of dirFields) {
          if (typeof v === 'string' && v.trim().length >= 15) {
            acc.directions = v.trim();
            acc.hit.directions++;
            break;
          }
        }
      }

      for (const k of Object.keys(node)) {
        this.scanJson((node as any)[k], acc);
      }
    }
  }

  private async waitUntilDataReady(frame: Frame): Promise<void> {
    // TS DOM 타입 회피: globalThis 사용
    // keywordList 없는 업종 대비해서 roadAddress/reviewCount도 조건 포함
    await frame.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      const html = doc?.body?.innerHTML || '';
      return html.includes('roadAddress') || html.includes('reviewCount') || html.includes('keywordList');
    }, { timeout: 20000 }).catch(() => {});
  }

  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) await this.initialize();
    const browser = this.browser;
    if (!browser) throw new Error('브라우저 초기화 실패');

    const page = await browser.newPage();

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });

      console.log('iframe 대기 중...');
      await page.waitForSelector('iframe#entryIframe', { timeout: 30000 });

      const frameEl = await page.$('iframe#entryIframe');
      const frame = frameEl ? await frameEl.contentFrame() : null;
      if (!frame) throw new Error('entryIframe 로드 실패');

      await this.waitUntilDataReady(frame);

      // iframe 전체 HTML을 안전하게 가져오기(outerHTML)
      const iframeHtml: string = await frame.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (globalThis as any).document;
        return doc?.documentElement?.outerHTML || '';
      });

      // 1) __NEXT_DATA__ 우선
      const acc = {
        keywords: [] as string[],
        reviewCount: 0,
        photoCount: 0,
        address: '',
        description: '',
        directions: '',
        hit: { keywordList: 0, reviewCount: 0, photoCount: 0, address: 0, description: 0, directions: 0 }
      };

      const nextDataText = this.extractScriptTextById(iframeHtml, '__NEXT_DATA__');
      if (nextDataText) {
        try {
          const json = JSON.parse(nextDataText);
          this.scanJson(json, acc);
          console.log('DEBUG: __NEXT_DATA__ scan hit:', acc.hit);
        } catch {}
      }

      // 2) __APOLLO_STATE__ / GraphQL 캐시 형태 시도
      if (
        acc.keywords.length === 0 ||
        !acc.address ||
        acc.photoCount === 0 ||
        !acc.description ||
        !acc.directions
      ) {
        // window.__APOLLO_STATE__ = {...}
        const apolloJson = this.extractJsonAfterMarker(iframeHtml, '__APOLLO_STATE__');
        if (apolloJson) {
          this.scanJson(apolloJson, acc);
          console.log('DEBUG: __APOLLO_STATE__ scan hit:', acc.hit);
        }
      }

      // 3) 마지막 fallback: 문자열 정규식(정말 최후)
      const titleText = await frame.title().catch(() => '');
      let name = titleText.replace(' : 네이버', '').trim();

      // placeName/bizName 정규식
      if (!name || name.includes('네이버')) {
        const m =
          iframeHtml.match(/"placeName"\s*:\s*"([^"]+)"/) ||
          iframeHtml.match(/"bizName"\s*:\s*"([^"]+)"/);
        if (m?.[1]) name = m[1].trim();
      }

      if (!acc.address) {
        const m =
          iframeHtml.match(/"roadAddress"\s*:\s*"([^"]+)"/) ||
          iframeHtml.match(/"jibunAddress"\s*:\s*"([^"]+)"/);
        if (m?.[1]) acc.address = m[1].trim();
      }

      if (!acc.description) {
        const m =
          iframeHtml.match(/"introduction"\s*:\s*"([^"]+)"/) ||
          iframeHtml.match(/"description"\s*:\s*"([^"]+)"/);
        if (m?.[1]) acc.description = m[1].trim();
      }

      if (!acc.directions) {
        const m =
          iframeHtml.match(/"directions"\s*:\s*"([^"]+)"/) ||
          iframeHtml.match(/"wayDescription"\s*:\s*"([^"]+)"/);
        if (m?.[1]) acc.directions = m[1].trim();
      }

      if (acc.keywords.length === 0) {
        const km = iframeHtml.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
        if (km?.[1]) {
          const items = km[1].match(/"text"\s*:\s*"([^"]+)"/g) || [];
          const list = items
            .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
            .map(s => s.trim())
            .filter(Boolean);
          if (list.length) acc.keywords = Array.from(new Set(list)).slice(0, 5);
        }
      }

      // 리뷰/사진 fallback
      if (acc.reviewCount === 0) {
        const m = iframeHtml.match(/방문자리뷰\s*([0-9,]+)/);
        if (m?.[1]) acc.reviewCount = this.parseNumber(m[1]);
      }
      if (acc.photoCount === 0) {
        const m = iframeHtml.match(/사진\s*([0-9,]+)/);
        if (m?.[1]) acc.photoCount = this.parseNumber(m[1]);
      }

      await page.close();

      console.log('DEBUG: FINAL hit:', acc.hit);

      const result: PlaceData = {
        name: name || '',
        address: acc.address || '',
        reviewCount: acc.reviewCount || 0,
        photoCount: acc.photoCount || 0,
        description: acc.description || '',
        directions: acc.directions || '',
        keywords: acc.keywords || []
      };

      console.log('✅ 최종 결과:', result);
      return result;

    } catch (error: any) {
      try { await page.close(); } catch {}
      console.error('❌ 크롤링 오류:', error);
      throw new Error(`플레이스 정보 추출 실패: ${error?.message || error}`);
    }
  }

  // MVP 단계: 일단 빈 배열
  async searchCompetitors(_query: string, _count: number = 5): Promise<PlaceData[]> {
    return [];
  }
}

