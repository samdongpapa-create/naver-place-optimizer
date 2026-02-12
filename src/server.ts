import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { NaverPlaceCrawler } from './services/enrichPlace';
import { PlaceDiagnosisService } from './services/diagnosis';
import { convertToMobileUrl, isValidPlaceUrl } from './utils/urlHelper';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Services
const crawler = new NaverPlaceCrawler();
const diagnosisService = new PlaceDiagnosisService();

// 서버 시작 시 브라우저 초기화
(async () => {
  try {
    await crawler.initialize();
    console.log('✅ Playwright 브라우저 초기화 완료');
  } catch (error) {
    console.error('❌ 브라우저 초기화 실패:', error);
  }
})();

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// 무료 진단 API
app.post('/api/diagnose/free', async (req: Request, res: Response) => {
  try {
    let { placeUrl } = req.body;

    if (!placeUrl) {
      return res.status(400).json({ error: '플레이스 URL을 입력해주세요' });
    }

    console.log('📥 원본 URL:', placeUrl);

    // URL 검증
    if (!isValidPlaceUrl(placeUrl)) {
      return res.status(400).json({ 
        error: '올바른 네이버 플레이스 URL을 입력해주세요',
        message: '예시: https://map.naver.com/p/entry/place/1234567890'
      });
    }

    // 모바일 URL로 변환
    placeUrl = convertToMobileUrl(placeUrl);
    console.log('🔄 변환된 URL:', placeUrl);

    // 플레이스 정보 크롤링
    console.log('🔍 플레이스 정보 수집 시작...');
    const placeData = await crawler.enrichPlace(placeUrl);
    
    console.log('✅ 수집 완료:');
    console.log('  - 이름:', placeData.name);
    console.log('  - 주소:', placeData.address);
    console.log('  - 리뷰:', placeData.reviewCount);
    console.log('  - 사진:', placeData.photoCount);
    console.log('  - 설명 길이:', placeData.description.length);
    console.log('  - 오시는길 길이:', placeData.directions.length);
    console.log('  - 키워드:', placeData.keywords);

    // 진단 실행
    console.log('📊 진단 시작...');
    const diagnosis = diagnosisService.generateDiagnosis(placeData, false);
    console.log('✅ 진단 완료');

    res.json({
      success: true,
      data: diagnosis
    });

  } catch (error: any) {
    console.error('❌ 진단 오류:', error);
    
    let errorMessage = '진단 중 오류가 발생했습니다.';
    
    if (error.message.includes('iframe')) {
      errorMessage = '페이지 로딩에 실패했습니다. URL을 다시 확인해주세요.';
    } else if (error.message.includes('Timeout')) {
      errorMessage = '페이지 로딩 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';
    } else if (error.message.includes('navigation')) {
      errorMessage = '네이버 플레이스 페이지에 접근할 수 없습니다. URL을 확인해주세요.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 유료 진단 API (경쟁사 분석 포함)
app.post('/api/diagnose/paid', async (req: Request, res: Response) => {
  try {
    let { placeUrl, searchQuery } = req.body;

    if (!placeUrl) {
      return res.status(400).json({ error: '플레이스 URL을 입력해주세요' });
    }

    // URL 검증
    if (!isValidPlaceUrl(placeUrl)) {
      return res.status(400).json({ 
        error: '올바른 네이버 플레이스 URL을 입력해주세요',
        message: '예시: https://m.place.naver.com/restaurant/1234567890'
      });
    }

    // 모바일 URL로 변환
    placeUrl = convertToMobileUrl(placeUrl);
    console.log('변환된 URL:', placeUrl);

    // 플레이스 정보 크롤링
    console.log('🔍 플레이스 정보 수집 중:', placeUrl);
    const placeData = await crawler.enrichPlace(placeUrl);

    // 진단 실행 (유료)
    console.log('📊 진단 중...');
    const diagnosis = diagnosisService.generateDiagnosis(placeData, true);

    // 경쟁사 분석
    if (searchQuery) {
      console.log('🔎 경쟁사 분석 중:', searchQuery);
      try {
        const competitors = await crawler.searchCompetitors(searchQuery, 5);
        diagnosis.competitors = competitors.map(c => ({
          name: c.name,
          address: c.address,
          keywords: c.keywords,
          reviewCount: c.reviewCount,
          photoCount: c.photoCount
        }));
      } catch (error) {
        console.error('경쟁사 분석 오류:', error);
        // 경쟁사 분석 실패해도 기본 진단은 반환
      }
    }

    res.json({
      success: true,
      data: diagnosis
    });

  } catch (error: any) {
    console.error('진단 오류:', error);
    res.status(500).json({ 
      error: '진단 중 오류가 발생했습니다',
      message: error.message 
    });
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM 신호 수신, 서버 종료 중...');
  await crawler.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT 신호 수신, 서버 종료 중...');
  await crawler.close();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`🚀 서버 실행 중: http://localhost:${port}`);
  console.log(`📊 환경: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
