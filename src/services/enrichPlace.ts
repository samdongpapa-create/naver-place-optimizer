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
  // Utils
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

  // JSON을 재귀로 훑어서 keywordList/review/photo/address/desc/directions 후보를 잡는다
  private scanJsonForSignals(
    node: any,
    acc: {
      keywords: string[];
      reviewCount: number;
      photoCount: number;
      address: string;
      description: string;
      directions: string;
    }
  ) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const v of node) this.scanJsonForSignals(v, acc);
      return;
    }

    if (typeof node === 'object') {
      // keywordList: [{text:"..."}, ...]
      if (Array.isArray((node as any).keywordList) && acc.keywords.length === 0) {
        const rawList: any[] = (node as any).keywordList;
        const list: string[] = rawList
          .map((k: any) => String(k?.text ?? k?.name ?? '').trim())
          .filter((x: string) => x.length > 0);
        if (list.length) acc.keywords = Array.from(new Set<string>(list)).slice(0, 5);
      }

      // review count 후보들
      const reviewCandidates: any[] = [
        (node as any).reviewCount,
        (node as any).totalReviewCount,
        (node as any).visitorReviewCount,
        (node as any).visitorReviewsCount,
        (node as any).blogReviewCount,
        (node as any).blogReviewsCount,
        (node as any).reviewsCount,
        (node as any).totalReviewsCount
      ];
      for (const c of reviewCandidates) {
        if (typeof c === 'number' && c > acc.reviewCount) acc.reviewCount = c;
        if (typeof c === 'string') {
          const n = this.parseKoreanNumber(c);
          if (n > acc.reviewCount) acc.reviewCount = n;
        }
      }

      // photo count 후보들
      const photoCandidates: any[] = [
        (node as any).photoCount,
        (node as any).totalPhotoCount,
        (node as any).photosCount,
        (node as any).imageCount,
        (node as any).totalImageCount
      ];
      for (const c of photoCandidates) {
        if (typeof c === 'number' && c > acc.photoCount) acc.photoCount = c;
        if (typeof c === 'string') {
          const n = this.parseKoreanNumber(c);
          if (n > acc.photoCount) acc.photoCount = n;
        }
      }

      // address 후보들(네이버 응답이 정말 다양함)
      const addrCandidates: any[] = [
        (node as any).roadAddress,
        (node as any).address,
        (node as any).fullAddress,
        (node as any).detailAddress,
        (node as any).jibunAddress
      ];
      if (!acc.address) {
        for (const a of addrCandidates) {
          const s = typeof a === 'string' ? a.trim() : '';
          if (s && s.length >= 5) { acc.address = s; break; }
        }
      }

      // description/intro 후보
      const descCandidates: any[] = [
        (node as any).description,
        (node as any).introduction,
        (node as any).intro,
        (node as any).businessDescription,
        (node as any).summary
      ];
      if (!acc.description) {
        for (const d of descCandidates) {
          const s = typeof d === 'string' ? d.trim() : '';
          if (s && s.length >= 20) { acc.description = s; break; }
        }
      }

      // directions/way 후보
      const dirCandidates: any[] = [
        (node as any).directions,
        (node as any).way,
        (node as any).wayDescription,
        (node as any).directionDescription
      ];
      if (!acc.directions) {
        for (const d of dirCandidates) {
          const s = typeof d === 'string' ? d.trim() : '';
          if (s && s.length >= 20) { acc.directions = s; break; }
        }
      }

      for (const key of Object.keys(node)) {
        this.scanJsonForSignals((node as any)[key], acc);
      }
    }
  }

  // frame 안의 __NEXT_DATA__ 파싱(가장 안정적)
  private async harvestFromNextData(frame: FrameLike) {
    const acc = {
      keywords: [] as string[],
      reviewCount: 0,
      photoCount: 0,
      address: '',
      description: '',
      directions: ''
    };

    try {
      // __NEXT_DATA__가 있으면 그걸 1순위로 파싱
      const nextDataText = await frame.$eval(
        'script#__NEXT_DATA__',
        (el) => (el as any).textContent || ''
      ).catch(() => '');

      if (nextDataText) {
        const json = JSON.parse(nextDataText);
        this.scanJsonForSignals(json, acc);
      }
    } catch {
      // ignore
    }

    return acc;
  }

  private async extractKeywordsFallback(page: Page, frame: FrameLike): Promise<string[]> {
    const tryHtml = async (html: string) => {
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
      return [];
    };

    try {
      const html = await frame.content();
      const k = await tryHtml(html);
      if (k.length) return k;
    } catch {}

    try {
      const html = await page.content();
      const k = await tryHtml(html);
      if (k.length) return k;
    } catch {}

    return [];
  }

  private async extractCountsFallback(frame: FrameLike): Promise<{ reviewCount: number; photoCount: number }> {
    let reviewCount = 0;
    let photoCount = 0;

    try {
      const html = await frame.content();

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
  // Main
  // -----------------------------
  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) await this.initialize();
    const page = await this.browser!.newPage();

    const placeId = extractPlaceId(placeUrl);

    // ✅ API 응답 가로채기 (필터 완화 버전)
    const harvested = {
      keywords: [] as string[],
      reviewCount: 0,
      photoCount: 0
    };

    const responseHandler = async (res: Response) => {
      try {
        if (!res.ok()) return;

        const url = res.url();
        // ✅ 너무 빡세게 거르지 말고 네이버 관련 + json 가능성만 잡기
        const isNaver = url.includes('naver.com') || url.includes('naver.net');
        if (!isNaver) return;

        // ✅ placeId가 URL에 없을 수 있어서 matchesPlace 제거 (중요!)
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        const looksJson =
          ct.includes('application/json') ||
          ct.includes('application/ld+json') ||
          ct.includes('text/plain'); // 가끔 json이 text/plain으로 옴

        // json 아니면 skip (단, 일부는 ct가 비어있기도 해서 url로 한 번 더 완화)
        const maybeJsonByUrl =
          url.includes('graphql') || url.includes('api') || url.includes('place') || url.includes('entry') || url.includes('pcmap');
        if (!looksJson && !maybeJsonByUrl) return;

        // 응답 파싱
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          const txt = await res.text().catch(() => '');
          if (!txt) return;
          try { data = JSON.parse(txt); } catch { return; }
        }
        if (!data) return;

        // 키워드/리뷰/사진만 빠르게 스캔
        const acc = {
          keywords: harvested.keywords,
          reviewCount: harvested.reviewCount,
          photoCount: harvested.photoCount,
          address: '',
          description: '',
          directions: ''
        };
        this.scanJsonForSignals(data, acc);

        harvested.keywords = acc.keywords;
        harvested.reviewCount = acc.reviewCount;
        harvested.photoCount = acc.photoCount;

      } catch {
        // ignore
      }
    };

    page.on('response', responseHandler);

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(4500);

      // iframe
      console.log('iframe 대기 중...');
      let frame: FrameLike = page;

      try {
        await page.waitForSelector('iframe#entryIframe', { timeout: 25000, state: 'attached' });
        const frameEl = await page.$('iframe#entryIframe');
        const cf = frameEl ? await frameEl.contentFrame() : null;
        if (cf) {
          frame = cf;
          console.log('entryIframe 로드 완료');
        }
      } catch {}

      await page.waitForTimeout(2000);

      // ✅ NEXT_DATA에서 먼저 큰 덩어리 수확 (주소/설명/오시는길/키워드/카운트 후보)
      const next = await this.harvestFromNextData(frame);

      // 이름 (DOM)
      let name = '';
      const nameSelectors = ['.Fc1rA', '.GHAhO', 'span.Fc1rA', 'div.Fc1rA', 'h1', '.place_detail_header h1'];
      for (const sel of nameSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) { name = t; break; }
      }

      // 주소 (NEXT_DATA 우선 → DOM fallback)
      let address = next.address || '';
      if (!address) {
        const addressSelectors = ['.LDgIH', '.IH3UA', 'span.LDgIH', '.place_detail_address'];
        for (const sel of addressSelectors) {
          const t = await this.safeText(frame, sel);
          if (t) { address = t; break; }
        }
      }

      // 상세설명/오시는길 (NEXT_DATA 우선)
      let description = next.description || '';
      let directions = next.directions || '';

      // DOM로 한 번 더 시도(있을 때만)
      if (!description) {
        console.log('상세정보 찾는 중...');
        try {
          const homeTabs = ['a:has-text("홈")', 'button:has-text("홈")', 'a:has-text("상세정보")', 'span:has-text("홈")'];
          for (const sel of homeTabs) {
            const tab = await frame.$(sel);
            if (tab) { await tab.click().catch(() => {}); await page.waitForTimeout(1200); break; }
          }

          const moreSelectors = ['a:has-text("더보기")', 'button:has-text("더보기")', '.zuyEj'];
          for (const sel of moreSelectors) {
            const btns = await frame.$$(sel);
            for (const b of btns) {
              const txt = ((await b.textContent()) || '').trim();
              if (txt.includes('더보기')) { await b.click().catch(() => {}); await page.waitForTimeout(700); }
            }
          }

          const descSelectors = ['.zPfVt', '.vV_z_', '.place_detail_introduction', 'div[class*="introduction"]'];
          for (const sel of descSelectors) {
            const t = await this.safeText(frame, sel);
            if (t && t.length > 10) { description = t; break; }
          }
        } catch {}
      }

      if (!directions) {
        console.log('오시는길 찾는 중...');
        try {
          const wayTabs = ['a:has-text("오시는길")', 'button:has-text("오시는길")', 'span:has-text("오시는길")'];
          for (const sel of wayTabs) {
            const tab = await frame.$(sel);
            if (tab) { await tab.click().catch(() => {}); await page.waitForTimeout(1200); break; }
          }

          const moreSelectors = ['a:has-text("더보기")', 'button:has-text("더보기")', '.zuyEj'];
          for (const sel of moreSelectors) {
            const btns = await frame.$$(sel);
            for (const b of btns) {
              const txt = ((await b.textContent()) || '').trim();
              if (txt.includes('더보기')) { await b.click().catch(() => {}); await page.waitForTimeout(700); }
            }
          }

          const dirSelectors = ['.vV_z_', '.way_description', 'div[class*="way"]', 'div[class*="direction"]'];
          for (const sel of dirSelectors) {
            const t = await this.safeText(frame, sel);
            if (t && t.length > 10) { directions = t; break; }
          }
        } catch {}
      }

      // ✅ 키워드/리뷰/사진: (1) API 수집 (2) NEXT_DATA (3) fallback
      console.log('API 수집값:', harvested);

      let keywords = harvested.keywords;
      if (!keywords.length && next.keywords.length) keywords = next.keywords;
      if (!keywords.length) {
        console.log('대표키워드 fallback 추출 중...');
        keywords = await this.extractKeywordsFallback(page, frame);
      }

      let reviewCount = harvested.reviewCount || next.reviewCount || 0;
      let photoCount = harvested.photoCount || next.photoCount || 0;

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
