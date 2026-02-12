import { chromium, Browser, Page, Frame, Response } from 'playwright';
import { PlaceData } from '../types';
import { extractPlaceId } from '../utils/urlHelper';

type FrameLike = Page | Frame;

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

  // -----------------------------
  // 유틸
  // -----------------------------
  private parseKoreanNumber(input: string): number {
    const cleaned = (input || '').replace(/[^\d]/g, '');
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  private async safeText(frame: FrameLike, selector: string): Promise<string> {
    try {
      const el = await frame.$(selector);
      if (!el) return '';
      const t = await el.textContent();
      return (t || '').trim();
    } catch {
      return '';
    }
  }

  // JSON에서 키워드/리뷰/사진 관련 필드를 “재귀적으로” 찾는다
  private scanJsonForSignals(
    node: any,
    acc: { keywords: string[]; reviewCount: number; photoCount: number }
  ) {
    if (!node) return;

    // 배열
    if (Array.isArray(node)) {
      for (const v of node) this.scanJsonForSignals(v, acc);
      return;
    }

    // 객체
    if (typeof node === 'object') {
      // ✅ keywordList: [{text:"..."}, ...]
      if (Array.isArray((node as any).keywordList) && acc.keywords.length === 0) {
  const rawList: any[] = (node as any).keywordList;

  const list: string[] = rawList
    .map((k: any) => {
      const v = k?.text ?? k?.name ?? '';
      return String(v).trim();
    })
    .filter((x: string) => x.length > 0);

  if (list.length) {
    acc.keywords = Array.from(new Set<string>(list)).slice(0, 5);
  }
}


      // ✅ 리뷰 카운트 후보들(네이버 응답 구조가 다양해서 넓게)
      const reviewCandidates: any[] = [
        node.reviewCount,
        node.totalReviewCount,
        node.visitorReviewCount,
        node.visitorReviewsCount,
        node.blogReviewCount,
        node.blogReviewsCount,
        node.reviewsCount,
        node.totalReviewsCount
      ];

      for (const c of reviewCandidates) {
        if (typeof c === 'number' && c > acc.reviewCount) acc.reviewCount = c;
        if (typeof c === 'string') {
          const n = this.parseKoreanNumber(c);
          if (n > acc.reviewCount) acc.reviewCount = n;
        }
      }

      // ✅ 사진 카운트 후보
      const photoCandidates: any[] = [
        node.photoCount,
        node.totalPhotoCount,
        node.photosCount,
        node.imageCount,
        node.totalImageCount
      ];

      for (const c of photoCandidates) {
        if (typeof c === 'number' && c > acc.photoCount) acc.photoCount = c;
        if (typeof c === 'string') {
          const n = this.parseKoreanNumber(c);
          if (n > acc.photoCount) acc.photoCount = n;
        }
      }

      // 더 깊게
      for (const key of Object.keys(node)) {
        this.scanJsonForSignals(node[key], acc);
      }
    }
  }

  // 대표키워드: (1) JSON에서 keywordList 찾기 (2) HTML에서 regex
  private async extractKeywordsFallback(page: Page, frame: FrameLike): Promise<string[]> {
    // 1) frame HTML에서 keywordList 찾기
    try {
      const html = await frame.content();
      const m = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
      if (m?.[1]) {
        const items = m[1].match(/"text"\s*:\s*"([^"]+)"/g);
        if (items?.length) {
          const list = items
            .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
            .map(x => x.trim())
            .filter(Boolean);
          return Array.from(new Set(list)).slice(0, 5);
        }
      }
    } catch {}

    // 2) page HTML에서 keywordList 찾기
    try {
      const html = await page.content();
      const m = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
      if (m?.[1]) {
        const items = m[1].match(/"text"\s*:\s*"([^"]+)"/g);
        if (items?.length) {
          const list = items
            .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
            .map(x => x.trim())
            .filter(Boolean);
          return Array.from(new Set(list)).slice(0, 5);
        }
      }
    } catch {}

    return [];
  }

  // DOM/HTML에서 리뷰/사진 수 fallback (콤마 지원)
  private async extractCountsFallback(frame: FrameLike): Promise<{ reviewCount: number; photoCount: number }> {
    let reviewCount = 0;
    let photoCount = 0;

    try {
      const html = await frame.content();

      // ✅ 콤마 지원
      const r =
        html.match(/방문자리뷰\s*([0-9,]+)/i) ||
        html.match(/리뷰\s*([0-9,]+)/i) ||
        html.match(/"reviewCount"\s*:\s*([0-9]+)/i);

      if (r?.[1]) reviewCount = this.parseKoreanNumber(r[1]);

      const p =
        html.match(/사진\s*([0-9,]+)/i) ||
        html.match(/"photoCount"\s*:\s*([0-9]+)/i);

      if (p?.[1]) photoCount = this.parseKoreanNumber(p[1]);
    } catch {}

    return { reviewCount, photoCount };
  }

  // -----------------------------
  // 핵심: enrichPlace (API 가로채기)
  // -----------------------------
  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) await this.initialize();

    const page = await this.browser!.newPage();

    // placeId를 알고 있으면 필터링에 도움
    const placeId = extractPlaceId(placeUrl);

    // ✅ 여기서 API 응답 가로채서 값 수집
    const harvested = {
      keywords: [] as string[],
      reviewCount: 0,
      photoCount: 0
    };

    const responseHandler = async (res: Response) => {
      try {
        const url = res.url();

        // 너무 광범위하게 잡으면 느려짐 → JSON일 확률 높은 것만
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const looksJson = ct.includes('application/json') || ct.includes('application/ld+json');

        // 네이버 내부 데이터는 json + place/entry/graphQL류에 자주 담김
        const looksRelevant =
          url.includes('naver.com') &&
          (url.includes('graphql') || url.includes('api') || url.includes('place') || url.includes('entry'));

        // placeId가 있으면 URL에 포함되는 응답만 우선
        const matchesPlace = placeId ? url.includes(placeId) : true;

        if (!looksJson || !looksRelevant || !matchesPlace) return;

        // 응답 바디 JSON 파싱 (실패하면 무시)
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          // 어떤 경우 text로 내려오는 json이 있을 수 있음
          const txt = await res.text().catch(() => '');
          if (!txt) return;
          try {
            data = JSON.parse(txt);
          } catch {
            return;
          }
        }

        if (!data) return;

        // ✅ 재귀 탐색해서 keywordList/review/photo 잡기
        this.scanJsonForSignals(data, harvested);
      } catch {
        // ignore
      }
    };

    page.on('response', responseHandler);

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });

      // 네트워크/API 응답 더 받기 위한 대기
      await page.waitForTimeout(4500);

      // ✅ iframe 없으면 page로 fallback
      console.log('iframe 대기 중...');
      let frame: FrameLike = page;

      try {
        await page.waitForSelector('iframe#entryIframe', { timeout: 25000, state: 'attached' });
        const frameEl = await page.$('iframe#entryIframe');
        const contentFrame = frameEl ? await frameEl.contentFrame() : null;
        if (contentFrame) {
          frame = contentFrame;
          console.log('entryIframe 로드 완료');
        } else {
          console.warn('⚠️ entryIframe contentFrame 실패 → page fallback');
        }
      } catch {
        console.warn('⚠️ entryIframe 없음 → page fallback');
      }

      // iframe 전환 후에도 API가 추가로 올 수 있어 약간 더 대기
      await page.waitForTimeout(2000);

      // -----------------------------
      // 기본 텍스트 추출 (이건 DOM 기반)
      // -----------------------------
      let name = '';
      const nameSelectors = ['.Fc1rA', '.GHAhO', 'span.Fc1rA', 'div.Fc1rA', 'h1', '.place_detail_header h1'];
      for (const sel of nameSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) { name = t; break; }
      }

      let address = '';
      const addressSelectors = ['.LDgIH', '.IH3UA', 'span.LDgIH', '.place_detail_address'];
      for (const sel of addressSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) { address = t; break; }
      }

      // -----------------------------
      // 상세설명
      // -----------------------------
      console.log('상세정보 찾는 중...');
      let description = '';

      try {
        const homeTabs = ['a:has-text("홈")', 'button:has-text("홈")', 'a:has-text("상세정보")', 'span:has-text("홈")'];
        for (const sel of homeTabs) {
          const tab = await frame.$(sel);
          if (tab) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(1200);
            break;
          }
        }

        const moreSelectors = ['a:has-text("더보기")', 'button:has-text("더보기")', '.zuyEj'];
        for (const sel of moreSelectors) {
          const btns = await frame.$$(sel);
          for (const b of btns) {
            const txt = ((await b.textContent()) || '').trim();
            if (txt.includes('더보기')) {
              await b.click().catch(() => {});
              await page.waitForTimeout(700);
            }
          }
        }

        const descSelectors = ['.zPfVt', '.vV_z_', '.place_detail_introduction', 'div[class*="introduction"]'];
        for (const sel of descSelectors) {
          const t = await this.safeText(frame, sel);
          if (t && t.length > 10) { description = t; break; }
        }
      } catch {}

      // -----------------------------
      // 오시는길
      // -----------------------------
      console.log('오시는길 찾는 중...');
      let directions = '';

      try {
        const wayTabs = ['a:has-text("오시는길")', 'button:has-text("오시는길")', 'span:has-text("오시는길")'];
        for (const sel of wayTabs) {
          const tab = await frame.$(sel);
          if (tab) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(1200);
            break;
          }
        }

        const moreSelectors = ['a:has-text("더보기")', 'button:has-text("더보기")', '.zuyEj'];
        for (const sel of moreSelectors) {
          const btns = await frame.$$(sel);
          for (const b of btns) {
            const txt = ((await b.textContent()) || '').trim();
            if (txt.includes('더보기')) {
              await b.click().catch(() => {});
              await page.waitForTimeout(700);
            }
          }
        }

        const dirSelectors = ['.vV_z_', '.way_description', 'div[class*="way"]', 'div[class*="direction"]'];
        for (const sel of dirSelectors) {
          const t = await this.safeText(frame, sel);
          if (t && t.length > 10) { directions = t; break; }
        }
      } catch {}

      // -----------------------------
      // ✅ 키워드/리뷰/사진: API 우선 → fallback
      // -----------------------------
      console.log('API 수집값:', harvested);

      // keywords
      let keywords = harvested.keywords;
      if (!keywords || keywords.length === 0) {
        console.log('대표키워드 fallback 추출 중...');
        keywords = await this.extractKeywordsFallback(page, frame);
      }

      // counts
      let reviewCount = harvested.reviewCount || 0;
      let photoCount = harvested.photoCount || 0;

      if (reviewCount === 0 || photoCount === 0) {
        console.log('리뷰/사진 fallback 추출 중...');
        const fb = await this.extractCountsFallback(frame);
        if (reviewCount === 0) reviewCount = fb.reviewCount;
        if (photoCount === 0) photoCount = fb.photoCount;
      }

      await page.close();

      const result: PlaceData = {
        name: (name || '').trim(),
        address: (address || '').trim(),
        reviewCount: reviewCount || 0,
        photoCount: photoCount || 0,
        description: (description || '').trim(),
        directions: (directions || '').trim(),
        keywords: keywords || []
      };

      console.log('✅ 최종 결과:', result);
      return result;

    } catch (error: any) {
      try { await page.close(); } catch {}
      console.error('❌ 크롤링 오류:', error);
      throw new Error(`플레이스 정보 추출 실패: ${error?.message || error}`);
    } finally {
      // 이벤트 핸들러 제거(누수 방지)
      try { page.off('response', responseHandler); } catch {}
    }
  }

  async searchCompetitors(query: string, count: number = 5): Promise<PlaceData[]> {
    if (!this.browser) await this.initialize();

    const page = await this.browser!.newPage();
    const competitors: PlaceData[] = [];

    try {
      const searchUrl = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);

      const placeLinks = await page.$$('a[href*="/place/"]');
      console.log(`검색 결과: ${placeLinks.length}개 발견`);

      for (let i = 0; i < Math.min(count, placeLinks.length); i++) {
        try {
          const href = await placeLinks[i].getAttribute('href');
          if (!href) continue;

          const fullUrl = href.startsWith('http') ? href : `https://m.place.naver.com${href}`;
          console.log(`경쟁사 ${i + 1} 크롤링 중: ${fullUrl}`);

          const placeData = await this.enrichPlace(fullUrl);
          competitors.push(placeData);

          await page.waitForTimeout(800);
        } catch (e) {
          console.log(`경쟁사 ${i + 1} 추출 실패:`, e);
        }
      }

      await page.close();
      return competitors;
    } catch (error: any) {
      try { await page.close(); } catch {}
      throw new Error(`경쟁사 검색 실패: ${error?.message || error}`);
    }
  }
}
