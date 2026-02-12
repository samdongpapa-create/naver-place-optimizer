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

  private parseNumber(input: string): number {
    const cleaned = (input || '').replace(/[^\d]/g, '');
    return cleaned ? Number(cleaned) : 0;
  }

  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) {
      await this.initialize();
    }

    // ✅ 여기서 browser를 고정해서 TS null 에러 방지
    const browser = this.browser;
    if (!browser) {
      throw new Error('브라우저 초기화 실패');
    }

    const page = await browser.newPage();

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(4000);

      console.log('iframe 대기 중...');
      await page.waitForSelector('iframe#entryIframe', { timeout: 30000 });

      const frameEl = await page.$('iframe#entryIframe');
      const frame = frameEl ? await frameEl.contentFrame() : null;

      if (!frame) throw new Error('iframe 로드 실패');

      await page.waitForTimeout(2000);

      const html = await frame.content();

      // -------------------------
      // 이름
      // -------------------------
      let name = '';
      const nameMatch = html.match(/<title>(.*?)<\/title>/);
      if (nameMatch?.[1]) {
        name = nameMatch[1].replace(' : 네이버', '').trim();
      }

      // -------------------------
      // 주소
      // -------------------------
      let address = '';
      const addrMatch =
        html.match(/"roadAddress"\s*:\s*"([^"]+)"/) ||
        html.match(/"address"\s*:\s*"([^"]+)"/);
      if (addrMatch?.[1]) address = addrMatch[1];

      // -------------------------
      // 리뷰 수
      // -------------------------
      let reviewCount = 0;
      const reviewMatch =
        html.match(/"reviewCount"\s*:\s*(\d+)/) ||
        html.match(/방문자리뷰\s*([0-9,]+)/);
      if (reviewMatch?.[1]) reviewCount = this.parseNumber(reviewMatch[1]);

      // -------------------------
      // 사진 수
      // -------------------------
      let photoCount = 0;
      const photoMatch =
        html.match(/"photoCount"\s*:\s*(\d+)/) ||
        html.match(/사진\s*([0-9,]+)/);
      if (photoMatch?.[1]) photoCount = this.parseNumber(photoMatch[1]);

      // -------------------------
      // 상세설명
      // -------------------------
      let description = '';
      const descMatch =
        html.match(/"introduction"\s*:\s*"([^"]+)"/) ||
        html.match(/"description"\s*:\s*"([^"]+)"/);
      if (descMatch?.[1]) description = descMatch[1];

      // -------------------------
      // 오시는길
      // -------------------------
      let directions = '';
      const dirMatch =
        html.match(/"directions"\s*:\s*"([^"]+)"/) ||
        html.match(/"way"\s*:\s*"([^"]+)"/);
      if (dirMatch?.[1]) directions = dirMatch[1];

      // -------------------------
      // 대표키워드
      // -------------------------
      let keywords: string[] = [];
      const keywordMatch = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
      if (keywordMatch?.[1]) {
        const items = keywordMatch[1].match(/"text"\s*:\s*"([^"]+)"/g);
        if (items) {
          keywords = items
            .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
            .filter(Boolean)
            .slice(0, 5);
        }
      }

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

      console.log('✅ 최종 결과:', result);
      return result;

    } catch (error: any) {
      try { await page.close(); } catch {}
      console.error('❌ 크롤링 오류:', error);
      throw new Error(`플레이스 정보 추출 실패: ${error.message}`);
    }
  }

  // 일단 MVP에서는 비워둬도 됨 (server.ts에서 사용하면 추후 구현)
  async searchCompetitors(_query: string, _count: number = 5): Promise<PlaceData[]> {
    return [];
  }
}
