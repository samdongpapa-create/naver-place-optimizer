import { chromium, Browser, Page } from 'playwright';
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

  async enrichPlace(placeUrl: string): Promise<PlaceData> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();
    
    try {
      // 네이버 플레이스 페이지 로드
      await page.goto(placeUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // iframe으로 전환 (네이버 플레이스는 iframe 구조)
      const frame = page.frameLocator('iframe#entryIframe');

      // 플레이스명 추출
      const name = await frame.locator('.GHAhO').first().textContent() || '';

      // 주소 추출
      const address = await frame.locator('.LDgIH').first().textContent() || '';

      // 리뷰 수 추출
      let reviewCount = 0;
      try {
        const reviewText = await frame.locator('.place_section_content .PXMot.LXIwF em').first().textContent();
        reviewCount = parseInt(reviewText?.replace(/,/g, '') || '0');
      } catch (e) {
        console.log('리뷰 수 추출 실패:', e);
      }

      // 사진 수 추출
      let photoCount = 0;
      try {
        const photoText = await frame.locator('.place_section_content .PXMot.YPrKL em').first().textContent();
        photoCount = parseInt(photoText?.replace(/,/g, '') || '0');
      } catch (e) {
        console.log('사진 수 추출 실패:', e);
      }

      // 상세설명 추출
      let description = '';
      try {
        description = await frame.locator('.zPfVt').first().textContent() || '';
      } catch (e) {
        console.log('상세설명 추출 실패:', e);
      }

      // 오시는길 추출
      let directions = '';
      try {
        const directionsBtn = frame.locator('a:has-text("오시는길")').first();
        if (await directionsBtn.count() > 0) {
          await directionsBtn.click();
          await page.waitForTimeout(1000);
          directions = await frame.locator('.vV_z_').first().textContent() || '';
        }
      } catch (e) {
        console.log('오시는길 추출 실패:', e);
      }

      // 대표키워드 추출 (프레임 소스에서)
      const keywords = await this.extractKeywords(page);

      await page.close();

      return {
        name: name.trim(),
        address: address.trim(),
        reviewCount,
        photoCount,
        description: description.trim(),
        directions: directions.trim(),
        keywords
      };

    } catch (error) {
      await page.close();
      throw new Error(`플레이스 정보 추출 실패: ${error}`);
    }
  }

  private async extractKeywords(page: Page): Promise<string[]> {
    try {
      // 페이지 소스에서 keywordList 찾기
      const content = await page.content();
      
      // keywordList 패턴 찾기
      const keywordMatch = content.match(/"keywordList":\[(.*?)\]/);
      
      if (keywordMatch && keywordMatch[1]) {
        // JSON 문자열에서 키워드 추출
        const keywordsJson = keywordMatch[1];
        const keywords = keywordsJson.match(/"text":"([^"]+)"/g);
        
        if (keywords) {
          return keywords
            .map(k => k.match(/"text":"([^"]+)"/)?.[1] || '')
            .filter(k => k.length > 0)
            .slice(0, 5); // 상위 5개만
        }
      }

      return [];
    } catch (error) {
      console.error('키워드 추출 실패:', error);
      return [];
    }
  }

  async searchCompetitors(query: string, count: number = 5): Promise<PlaceData[]> {
    if (!this.browser) {
      await this.initialize();
    }

    const page = await this.browser!.newPage();
    const competitors: PlaceData[] = [];

    try {
      // 네이버 플레이스 검색
      const searchUrl = `https://m.place.naver.com/search?query=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // 검색 결과에서 상위 업체 추출
      const placeLinks = await page.locator('a[href*="/place/"]').all();
      
      for (let i = 0; i < Math.min(count, placeLinks.length); i++) {
        try {
          const href = await placeLinks[i].getAttribute('href');
          if (href) {
            const fullUrl = `https://m.place.naver.com${href}`;
            const placeData = await this.enrichPlace(fullUrl);
            competitors.push(placeData);
          }
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
