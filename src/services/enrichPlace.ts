import { chromium, Browser, Page, Frame } from 'playwright';
import { PlaceData } from '../types';

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

  private parseKoreanNumber(input: string): number {
    // "1,927" / "  12 " 같은 문자열을 숫자로
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

  private async extractCounts(frame: FrameLike): Promise<{ reviewCount: number; photoCount: number }> {
    // 1) 화면에 보이는 탭/라벨에서 먼저 시도
    // (네이버가 자주 바꾸므로 여러 패턴을 넓게 잡음)
    const trySelectors = [
      // "방문자리뷰 1,927"
      'a:has-text("방문자리뷰")',
      'button:has-text("방문자리뷰")',
      'span:has-text("방문자리뷰")',
      // "리뷰 1,927"
      'a:has-text("리뷰")',
      'button:has-text("리뷰")',
      'span:has-text("리뷰")',
      // "사진 1,234"
      'a:has-text("사진")',
      'button:has-text("사진")',
      'span:has-text("사진")'
    ];

    let reviewCount = 0;
    let photoCount = 0;

    for (const sel of trySelectors) {
      try {
        const nodes = await frame.$$(sel);
        for (const n of nodes) {
          const t = ((await n.textContent()) || '').trim();
          if (!t) continue;

          if (/방문자리뷰|리뷰/.test(t) && reviewCount === 0) {
            // "방문자리뷰 1,927" / "리뷰 23"
            const m = t.match(/(?:방문자리뷰|리뷰)\s*([0-9,]+)/);
            if (m?.[1]) reviewCount = this.parseKoreanNumber(m[1]);
          }

          if (/사진/.test(t) && photoCount === 0) {
            const m = t.match(/사진\s*([0-9,]+)/);
            if (m?.[1]) photoCount = this.parseKoreanNumber(m[1]);
          }
        }
      } catch {
        // ignore
      }
    }

    // 2) 그래도 0이면 프레임 HTML에서 정규식으로 2차 시도 (콤마 허용)
    if (reviewCount === 0 || photoCount === 0) {
      try {
        const html = await frame.content();

        if (reviewCount === 0) {
          const m =
            html.match(/방문자리뷰\s*([0-9,]+)/i) ||
            html.match(/리뷰\s*([0-9,]+)/i) ||
            html.match(/"reviewCount"\s*:\s*([0-9]+)/i);
          if (m?.[1]) reviewCount = this.parseKoreanNumber(m[1]);
        }

        if (photoCount === 0) {
          const m =
            html.match(/사진\s*([0-9,]+)/i) ||
            html.match(/"photoCount"\s*:\s*([0-9]+)/i);
          if (m?.[1]) photoCount = this.parseKoreanNumber(m[1]);
        }
      } catch {
        // ignore
      }
    }

    return { reviewCount, photoCount };
  }

  private async extractKeywordsFromContent(content: string): Promise<string[]> {
    if (!content) return [];

    // 1) "keywordList":[{...}] 형태
    const keywordListMatch = content.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
    if (keywordListMatch?.[1]) {
      const raw = keywordListMatch[1];
      const items = raw.match(/"text"\s*:\s*"([^"]+)"/g);
      if (items?.length) {
        const list = items
          .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
          .map(x => x.trim())
          .filter(Boolean);
        return Array.from(new Set(list)).slice(0, 5);
      }
    }

    // 2) 혹시 "keywords":["..."] 같은 다른 구조가 있으면 대비
    const alt = content.match(/"keywords"\s*:\s*\[(.*?)\]/s);
    if (alt?.[1]) {
      const items = alt[1].match(/"([^"]+)"/g);
      if (items?.length) {
        const list = items.map(x => x.replace(/"/g, '').trim()).filter(Boolean);
        return Array.from(new Set(list)).slice(0, 5);
      }
    }

    return [];
  }

  private async extractKeywords(frame: FrameLike, page: Page): Promise<string[]> {
    // ✅ 포인트: page가 아니라 "프레임/페이지 둘 다"에서 찾는다
    try {
      const frameHtml = await frame.content();
      const fromFrame = await this.extractKeywordsFromContent(frameHtml);
      if (fromFrame.length) return fromFrame;
    } catch {
      // ignore
    }

    try {
      const pageHtml = await page.content();
      const fromPage = await this.extractKeywordsFromContent(pageHtml);
      if (fromPage.length) return fromPage;
    } catch {
      // ignore
    }

    // 3) 혹시 script 태그에서 JSON 문자열이 더 크게 들어가는 경우 대비(프레임 포함)
    try {
      const scripts = await page.$$eval('script', els => els.map(e => (e.textContent || '')));
      for (const s of scripts) {
        const kw = await this.extractKeywordsFromContent(s);
        if (kw.length) return kw;
      }
    } catch {
      // ignore
    }

    return [];
  }

  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) await this.initialize();
    const page = await this.browser!.newPage();

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(4000);

      // ✅ iframe 없으면 pag
