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

  /**
   * iframe 내부에서 "실제 플레이스 데이터가 들어온 상태"가 될 때까지 기다림
   * (wrapper HTML/네이버페이 문구를 긁는 문제 해결)
   */
  private async waitUntilPlaceDataReady(frame: Frame): Promise<void> {
    // keywordList가 없는 업종도 있으니, 주소/리뷰카운트도 조건에 포함
    await frame
      .waitForFunction(
        () => {
          const html = (window as any)?.document?.body?.innerHTML || '';
          return (
            html.includes('"keywordList"') ||
            html.includes('"roadAddress"') ||
            html.includes('"reviewCount"')
          );
        },
        { timeout: 15000 }
      )
      .catch(() => {});
  }

  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) {
      await this.initialize();
    }

    const browser = this.browser;
    if (!browser) {
      throw new Error('브라우저 초기화 실패');
    }

    const page = await browser.newPage();

    try {
      console.log('페이지 로딩 중...');
      await page.goto(placeUrl, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(2000);

      console.log('iframe 대기 중...');
      await page.waitForSelector('iframe#entryIframe', { timeout: 30000 });

      const frameEl = await page.$('iframe#entryIframe');
      const frame = frameEl ? await frameEl.contentFrame() : null;

      if (!frame) throw new Error('entryIframe 로드 실패');

      // ✅ 핵심: 실제 데이터가 들어올 때까지 대기
      await this.waitUntilPlaceDataReady(frame);

      // iframe HTML
      const html = await frame.content();

      // -------------------------
      // 이름 (DOM 우선 → regex 보조)
      // -------------------------
      let name = '';
      const nameSelectors = ['.Fc1rA', '.GHAhO', 'span.Fc1rA', 'div.Fc1rA', 'h1'];
      for (const sel of nameSelectors) {
        const t = await this.safeText(frame, sel);
        if (t) {
          name = t;
          break;
        }
      }
      if (!name) {
        // JSON 안에 name이 여러개 있을 수 있으니 placeName/bizName도 같이 시도
        const m =
          html.match(/"placeName"\s*:\s*"([^"]+)"/) ||
          html.match(/"bizName"\s*:\s*"([^"]+)"/) ||
          html.match(/"name"\s*:\s*"([^"]+)"/);
        if (m?.[1]) name = m[1].trim();
      }

      // -------------------------
      // 주소 (JSON 우선)
      // -------------------------
      let address = '';
      const addrMatch =
        html.match(/"roadAddress"\s*:\s*"([^"]+)"/) ||
        html.match(/"jibunAddress"\s*:\s*"([^"]+)"/) ||
        html.match(/"address"\s*:\s*"([^"]+)"/);
      if (addrMatch?.[1]) address = addrMatch[1];

      // -------------------------
      // 리뷰 수
      // -------------------------
      let reviewCount = 0;
      const reviewMatch =
        html.match(/"reviewCount"\s*:\s*(\d+)/) ||
        html.match(/방문자리뷰\s*([0-9,]+)/) ||
        html.match(/리뷰\s*([0-9,]+)/);
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
        html.match(/"description"\s*:\s*"([^"]+)"/) ||
        html.match(/"summary"\s*:\s*"([^"]+)"/);
      if (descMatch?.[1]) description = descMatch[1];

      // -------------------------
      // 오시는길
      // -------------------------
      let directions = '';
      const dirMatch =
        html.match(/"directions"\s*:\s*"([^"]+)"/) ||
        html.match(/"way"\s*:\s*"([^"]+)"/) ||
        html.match(/"wayDescription"\s*:\s*"([^"]+)"/);
      if (dirMatch?.[1]) directions = dirMatch[1];

      // -------------------------
      // 대표키워드
      // -------------------------
      let keywords: string[] = [];
      const keywordMatch = html.match(/"keywordList"\s*:\s*\[(.*?)\]/s);
      if (keywordMatch?.[1]) {
        const items = keywordMatch[1].match(/"text"\s*:\s*"([^"]+)"/g);
        if (items?.length) {
          keywords = items
            .map(x => x.match(/"text"\s*:\s*"([^"]+)"/)?.[1] || '')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 5);
        }
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
      try {
        await page.close();
      } catch {}
      console.error('❌ 크롤링 오류:', error);
      throw new Error(`플레이스 정보 추출 실패: ${error?.message || error}`);
    }
  }

  // MVP 단계에서는 빈 배열로 두고, 필요하면 다음 단계에서 구현
  async searchCompetitors(_query: string, _count: number = 5): Promise<PlaceData[]> {
    return [];
  }
}
