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
      // 네이버 플레이스 페이지 로드 (타임아웃 증가)
      await page.goto(placeUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });

      // 페이지 로딩 대기
      await page.waitForTimeout(3000);

      // iframe 대기 및 접근
      await page.waitForSelector('iframe#entryIframe', { timeout: 10000 });
      const frameElement = await page.$('iframe#entryIframe');
      
      if (!frameElement) {
        throw new Error('iframe을 찾을 수 없습니다');
      }

      const frame = await frameElement.contentFrame();
      
      if (!frame) {
        throw new Error('iframe 콘텐츠에 접근할 수 없습니다');
      }

      // 추가 로딩 대기
      await frame.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // 플레이스명 추출 (여러 셀렉터 시도)
      let name = '';
      const nameSelectors = ['.GHAhO', '.Fc1rA', 'span.Fc1rA', 'div.Fc1rA'];
      for (const selector of nameSelectors) {
        try {
          const element = await frame.$(selector);
          if (element) {
            name = (await element.textContent()) || '';
            if (name) break;
          }
        } catch (e) {
          continue;
        }
      }

      // 주소 추출 (여러 셀렉터 시도)
      let address = '';
      const addressSelectors = ['.LDgIH', '.IH3UA', 'span.LDgIH'];
      for (const selector of addressSelectors) {
        try {
          const element = await frame.$(selector);
          if (element) {
            address = (await element.textContent()) || '';
            if (address) break;
          }
        } catch (e) {
          continue;
        }
      }

      // 리뷰 수 추출
      let reviewCount = 0;
      try {
        const reviewSelectors = [
          '.place_section_content .PXMot.LXIwF em',
          'em.PXMot',
          '.veBoZ em'
        ];
        
        for (const selector of reviewSelectors) {
          try {
            const element = await frame.$(selector);
            if (element) {
              const reviewText = await element.textContent();
              if (reviewText) {
                reviewCount = parseInt(reviewText.replace(/,/g, '').replace(/[^0-9]/g, '')) || 0;
                if (reviewCount > 0) break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.log('리뷰 수 추출 실패:', e);
      }

      // 사진 수 추출
      let photoCount = 0;
      try {
        const photoSelectors = [
          '.place_section_content .PXMot.YPrKL em',
          'a[href*="photo"] em',
          '.K0PDV em'
        ];
        
        for (const selector of photoSelectors) {
          try {
            const element = await frame.$(selector);
            if (element) {
              const photoText = await element.textContent();
              if (photoText) {
                photoCount = parseInt(photoText.replace(/,/g, '').replace(/[^0-9]/g, '')) || 0;
                if (photoCount > 0) break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.log('사진 수 추출 실패:', e);
      }

      // 상세설명 추출
      let description = '';
      try {
        const descSelectors = ['.zPfVt', '.vV_z_', '.contact'];
        
        for (const selector of descSelectors) {
          try {
            const element = await frame.$(selector);
            if (element) {
              description = (await element.textContent()) || '';
              if (description) break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (e) {
        console.log('상세설명 추출 실패:', e);
      }

      // 오시는길 추출
      let directions = '';
      try {
        // 오시는길 탭 클릭 시도
        const directionsBtnSelectors = [
          'a:has-text("오시는길")',
          'button:has-text("오시는길")',
          '[data-nclicks*="way"]'
        ];
        
        for (const selector of directionsBtnSelectors) {
          try {
            const btn = await frame.$(selector);
            if (btn) {
              await btn.click();
              await page.waitForTimeout(2000);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        // 오시는길 텍스트 추출
        const directionsSelectors = ['.vV_z_', '.way_description', 'p'];
        for (const selector of directionsSelectors) {
          try {
            const element = await frame.$(selector);
            if (element) {
              const text = await element.textContent();
              if (text && text.length > 10) {
                directions = text;
                break;
              }
            }
          } catch (e) {
            continue;
          }
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
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });

      // 페이지 로딩 대기
      await page.waitForTimeout(3000);

      // 검색 결과에서 상위 업체 추출
      const placeLinks = await page.$$('a[href*="/place/"]');
      
      console.log(`검색 결과: ${placeLinks.length}개 발견`);
      
      for (let i = 0; i < Math.min(count, placeLinks.length); i++) {
        try {
          const href = await placeLinks[i].getAttribute('href');
          if (href) {
            const fullUrl = href.startsWith('http') ? href : `https://m.place.naver.com${href}`;
            console.log(`경쟁사 ${i + 1} 크롤링 중: ${fullUrl}`);
            const placeData = await this.enrichPlace(fullUrl);
            competitors.push(placeData);
            
            // 과도한 요청 방지
            await page.waitForTimeout(1000);
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
