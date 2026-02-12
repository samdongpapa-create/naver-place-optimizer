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

      // ✅ iframe 없으면 page로 fallback
      console.log('iframe 대기 중...');
      let frame: FrameLike = page;

      try {
        await page.waitForSelector('iframe#entryIframe', { timeout: 25000, state: 'attached' });
        const frameElement = await page.$('iframe#entryIframe');
        const contentFrame = frameElement ? await frameElement.contentFrame() : null;
        if (contentFrame) {
          frame = contentFrame;
          console.log('entryIframe 로드 완료');
        } else {
          console.warn('⚠️ entryIframe contentFrame 실패 → page fallback');
        }
      } catch {
        console.warn('⚠️ entryIframe 없음 → page fallback');
      }

      await page.waitForTimeout(2000);

      // 이름/주소
      let name = '';
      const nameSelectors = ['.Fc1rA', '.GHAhO', 'h1', '.place_detail_header h1'];
      for (const sel of nameSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) {
          name = t;
          break;
        }
      }

      let address = '';
      const addressSelectors = ['.LDgIH', '.IH3UA', 'span.LDgIH', '.place_detail_address'];
      for (const sel of addressSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) {
          address = t;
          break;
        }
      }

      // 리뷰/사진 수 (콤마 대응 + selector/HTML 이중 시도)
      const { reviewCount, photoCount } = await this.extractCounts(frame);

      // 상세설명
      let description = '';
      try {
        // 홈 탭 클릭 시도(있으면)
        const homeTabs = ['a:has-text("홈")', 'button:has-text("홈")', 'a:has-text("상세정보")'];
        for (const sel of homeTabs) {
          const tab = await frame.$(sel);
          if (tab) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(1500);
            break;
          }
        }

        // 더보기 누르기
        const moreBtns = ['a:has-text("더보기")', 'button:has-text("더보기")', '.zuyEj'];
        for (const sel of moreBtns) {
          const btns = await frame.$$(sel);
          for (const b of btns) {
            const txt = ((await b.textContent()) || '').trim();
            if (txt.includes('더보기')) {
              await b.click().catch(() => {});
              await page.waitForTimeout(800);
            }
          }
        }

        const descSelectors = ['.zPfVt', '.vV_z_', '.place_detail_introduction', 'div[class*="introduction"]'];
        for (const sel of descSelectors) {
          const t = await this.safeText(frame, sel);
          if (t && t.length > 10) {
            description = t;
            break;
          }
        }
      } catch {
        // ignore
      }

      // 오시는길
      let directions = '';
      try {
        const wayTabs = ['a:has-text("오시는길")', 'button:has-text("오시는길")', 'span:has-text("오시는길")'];
        for (const sel of wayTabs) {
          const tab = await frame.$(sel);
          if (tab) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(1500);
            break;
          }
        }

        const moreBtns = ['a:has-text("더보기")', 'button:has-text("더보기")'];
        for (const sel of moreBtns) {
          const btns = await frame.$$(sel);
          for (const b of btns) {
            const txt = ((await b.textContent()) || '').trim();
            if (txt.includes('더보기')) {
              await b.click().catch(() => {});
              await page.waitForTimeout(800);
            }
          }
        }

        const dirSelectors = ['.vV_z_', '.way_description', 'div[class*="way"]', 'div[class*="direction"]'];
        for (const sel of dirSelectors) {
          const t = await this.safeText(frame, sel);
          if (t && t.length > 10) {
            directions = t;
            break;
          }
        }
      } catch {
        // ignore
      }

      // ✅ 대표키워드 (프레임/페이지/script까지 순회)
      console.log('대표키워드 추출 중...');
      const keywords = await this.extractKeywords(frame, page);
      console.log('추출된 키워드:', keywords);

      await page.close();

      const result: PlaceData = {
        name: name || '',
        address: address || '',
        reviewCount: reviewCount || 0,
        photoCount: photoCount || 0,
        description: description || '',
        directions: directions || '',
        keywords: keywords || []
      };

      console.log('최종 결과:', result);
      return result;
    } catch (error) {
      await page.close();
      console.error('크롤링 오류:', error);
      throw new Error(`플레이스 정보 추출 실패: ${error}`);
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
    } catch (error) {
      await page.close();
      throw new Error(`경쟁사 검색 실패: ${error}`);
    }
  }
}
